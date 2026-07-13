import { randomBytes, randomInt } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import { authenticate, hash } from './_shared/auth.js'

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'cache-control': 'no-store'
}
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export default async function pair(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  const store = getStore({ name: 'codexmeter-usage', consistency: 'strong' })

  if (req.method === 'POST') {
    const auth = await authenticate(req, store)
    if (!auth) return json({ error: '同步凭据无效' }, 401)
    const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('')
    const token = `cm_device_${randomBytes(32).toString('base64url')}`
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
    await store.setJSON(`auth/pair-codes/${hash(code)}.json`, { namespace: auth.namespace, token, expiresAt })
    return json({ code, expiresAt })
  }

  if (req.method === 'GET') {
    const code = new URL(req.url).searchParams.get('code')?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? ''
    if (!/^[A-Z2-9]{8}$/.test(code)) return json({ error: '配对码格式不正确' }, 422)
    const key = `auth/pair-codes/${hash(code)}.json`
    const record = await store.get(key, { type: 'json' }) as { namespace?: string; token?: string; expiresAt?: string } | null
    if (!record?.namespace || !record.token || !record.expiresAt || Date.parse(record.expiresAt) < Date.now()) {
      if (record) await store.delete(key)
      return json({ error: '配对码无效或已过期' }, 404)
    }
    await store.setJSON(`auth/device-tokens/${hash(record.token)}.json`, { namespace: record.namespace, createdAt: new Date().toISOString() })
    await store.delete(key)
    return json({ token: record.token })
  }

  return json({ error: 'Method not allowed' }, 405)
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers })
}

export const config: Config = { path: '/api/pair' }
