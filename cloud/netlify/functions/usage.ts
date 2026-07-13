import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import { authenticate } from './_shared/auth.js'
import { aggregateDevices, parseDeviceUsage, type StoredDeviceUsage } from './_shared/schema.js'

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'cache-control': 'no-store'
}

export default async function usage(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  const store = getStore({ name: 'codexmeter-usage', consistency: 'strong' })
  const auth = await authenticate(req, store)
  if (!auth) return json({ error: '同步凭据无效' }, 401)
  const namespace = auth.namespace
  const prefix = `${namespace}/devices/`
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
    await store.setJSON(`${prefix}${item.device.id}.json`, item)
    if (auth.credentialType === 'device') {
      await store.setJSON(`auth/device-tokens/${auth.credentialHash}.json`, { namespace, deviceId: item.device.id, updatedAt: item.receivedAt })
    }
    return json({ ok: true, deviceId: item.device.id, receivedAt: item.receivedAt })
  }

  if (req.method === 'GET') {
    const { blobs } = await store.list({ prefix })
    const devices = (await Promise.all(blobs.map((blob) => store.get(blob.key, { type: 'json' }))))
      .filter((item): item is StoredDeviceUsage => Boolean(item))
    return json(aggregateDevices(devices))
  }

  if (req.method === 'DELETE') {
    const deviceId = new URL(req.url).searchParams.get('deviceId') ?? ''
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(deviceId)) return json({ error: '设备 ID 无效' }, 422)
    await store.delete(`${prefix}${deviceId}.json`)
    return json({ ok: true })
  }

  return json({ error: 'Method not allowed' }, 405)
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers })
}

export const config: Config = {
  path: '/api/usage'
}
