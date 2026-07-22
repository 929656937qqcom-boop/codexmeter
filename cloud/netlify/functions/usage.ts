import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import { authenticate } from './_shared/auth.js'
import { aggregateDevices, normalizeDeviceName, parseDeviceUsage, parseQuota, type StoredDeviceUsage } from './_shared/schema.js'

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'cache-control': 'no-store'
}

export default async function usage(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  const store = getStore({ name: 'codexmeter-usage', consistency: 'strong' })
  const auth = await authenticate(req, store)
  if (!auth) return json({ error: '同步凭据无效' }, 401)
  const namespace = auth.namespace
  const prefix = `${namespace}/devices/`
  const aliasPrefix = `${namespace}/device-aliases/`
  if (req.method === 'POST') {
    const contentLength = Number(req.headers.get('content-length') ?? 0)
    if (contentLength > 2_000_000) return json({ error: '请求数据过大' }, 413)
    const item = parseDeviceUsage(await req.json(), new Date().toISOString())
    if (!item) return json({ error: '设备汇总格式无效' }, 422)
    const accountKey = `${namespace}/account.json`
    const account = await store.get(accountKey, { type: 'json' }) as { fingerprint?: string } | null
    if (item.accountFingerprint && account?.fingerprint && account.fingerprint !== item.accountFingerprint) {
      return json({ error: '当前设备登录的 Codex 账号与同步空间不一致' }, 409)
    }
    if (item.accountFingerprint && !account?.fingerprint) {
      await store.setJSON(accountKey, { fingerprint: item.accountFingerprint, verifiedAt: item.receivedAt })
    }
    await removeSupersededDeviceSnapshots(store, prefix, aliasPrefix, item)
    await store.setJSON(`${prefix}${item.device.id}.json`, item)
    if (auth.credentialType === 'device') {
      await store.setJSON(`auth/device-tokens/${auth.credentialHash}.json`, { namespace, deviceId: item.device.id, updatedAt: item.receivedAt })
    }
    return json({ ok: true, deviceId: item.device.id, receivedAt: item.receivedAt })
  }

  if (req.method === 'PATCH') {
    const body = await req.json().catch(() => null) as { deviceId?: unknown; name?: unknown; quota?: unknown } | null
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : ''
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(deviceId)) return json({ error: '设备 ID 无效' }, 422)
    if (auth.credentialType === 'device') {
      if (!auth.deviceId) return json({ error: '请先完成本设备首次完整同步' }, 409)
      if (auth.deviceId !== deviceId) return json({ error: '设备凭据不能更新其他设备' }, 403)
    }
    const deviceKey = `${prefix}${deviceId}.json`
    const device = await store.get(deviceKey, { type: 'json' }) as StoredDeviceUsage | null
    if (!device) return json({ error: '设备不存在，请先完成一次完整同步' }, 404)

    if (body && Object.prototype.hasOwnProperty.call(body, 'quota')) {
      const quota = parseQuota(body.quota)
      if (!quota) return json({ error: '额度快照格式无效' }, 422)
      const receivedAt = new Date().toISOString()
      await store.setJSON(deviceKey, { ...device, quota, receivedAt })
      return json({ ok: true, deviceId, receivedAt, quotaRefreshedAt: quota.refreshedAt })
    }

    const name = normalizeDeviceName(body?.name)
    if (!name) return json({ error: '设备名称需为 1-32 个字符' }, 422)
    await store.setJSON(`${aliasPrefix}${deviceId}.json`, { name, updatedAt: new Date().toISOString() })
    return json({ ok: true, deviceId, name })
  }

  if (req.method === 'GET') {
    const [{ blobs }, { blobs: aliasBlobs }] = await Promise.all([
      store.list({ prefix }),
      store.list({ prefix: aliasPrefix })
    ])
    const [storedDevices, storedAliases] = await Promise.all([
      Promise.all(blobs.map((blob) => store.get(blob.key, { type: 'json' }))),
      Promise.all(aliasBlobs.map(async (blob) => ({
        deviceId: blob.key.slice(aliasPrefix.length).replace(/\.json$/, ''),
        value: await store.get(blob.key, { type: 'json' }) as { name?: unknown } | null
      })))
    ])
    const aliases = new Map(storedAliases.map((item) => [item.deviceId, normalizeDeviceName(item.value?.name)]))
    const devices = storedDevices
      .filter((item): item is StoredDeviceUsage => Boolean(item))
      .map((item) => {
        const name = aliases.get(item.device.id)
        return name ? { ...item, device: { ...item.device, name } } : item
      })
    return json(aggregateDevices(devices))
  }

  if (req.method === 'DELETE') {
    const deviceId = new URL(req.url).searchParams.get('deviceId') ?? ''
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(deviceId)) return json({ error: '设备 ID 无效' }, 422)
    await Promise.all([
      store.delete(`${prefix}${deviceId}.json`),
      store.delete(`${aliasPrefix}${deviceId}.json`)
    ])
    return json({ ok: true })
  }

  return json({ error: 'Method not allowed' }, 405)
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers })
}

async function removeSupersededDeviceSnapshots(
  store: ReturnType<typeof getStore>,
  prefix: string,
  aliasPrefix: string,
  item: StoredDeviceUsage
): Promise<void> {
  if (!item.device.stableKey) return
  const { blobs } = await store.list({ prefix })
  await Promise.all(blobs.map(async (blob) => {
    const deviceId = blob.key.slice(prefix.length).replace(/\.json$/, '')
    if (deviceId === item.device.id) return

    const existing = await store.get(blob.key, { type: 'json' }) as StoredDeviceUsage | null
    if (!existing || !isSupersededDeviceSnapshot(existing, item)) return

    const oldAliasKey = `${aliasPrefix}${deviceId}.json`
    const newAliasKey = `${aliasPrefix}${item.device.id}.json`
    const [oldAlias, newAlias] = await Promise.all([
      store.get(oldAliasKey, { type: 'json' }) as Promise<{ name?: unknown } | null>,
      store.get(newAliasKey, { type: 'json' }) as Promise<{ name?: unknown } | null>
    ])
    if (oldAlias && !newAlias) await store.setJSON(newAliasKey, oldAlias)
    await Promise.all([
      store.delete(blob.key),
      store.delete(oldAliasKey)
    ])
  }))
}

function isSupersededDeviceSnapshot(existing: StoredDeviceUsage, current: StoredDeviceUsage): boolean {
  if (existing.device.stableKey) return existing.device.stableKey === current.device.stableKey
  return existing.device.name.trim() === current.device.name.trim()
    && existing.device.platform === current.device.platform
    && (existing.device.arch ?? '') === (current.device.arch ?? '')
}

export const config: Config = {
  path: '/api/usage'
}
