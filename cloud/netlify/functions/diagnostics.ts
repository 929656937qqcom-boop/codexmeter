import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import { authenticate } from './_shared/auth.js'

const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'cache-control': 'no-store'
}

interface StoredDiagnostic {
  createdAt: string
  kind: string
  message: string
  operation?: string
  device: { id: string; name: string; platform: string; arch: string; appVersion: string }
}

export default async function diagnostics(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  const store = getStore({ name: 'codexmeter-usage', consistency: 'strong' })
  const auth = await authenticate(req, store)
  if (!auth) return json({ error: '同步凭据无效' }, 401)
  const prefix = `${auth.namespace}/diagnostics/`

  if (req.method === 'POST') {
    const contentLength = Number(req.headers.get('content-length') ?? 0)
    if (contentLength > 20_000) return json({ error: '诊断数据过大' }, 413)
    const event = parseDiagnostic(await req.json())
    if (!event) return json({ error: '诊断数据格式无效' }, 422)
    const key = `${prefix}${event.createdAt.replace(/[^0-9]/g, '')}-${randomUUID()}.json`
    await store.setJSON(key, event)
    return json({ ok: true, receivedAt: new Date().toISOString() })
  }

  if (req.method === 'GET') {
    const { blobs } = await store.list({ prefix })
    const events = (await Promise.all(blobs.slice(-200).map((blob) => store.get(blob.key, { type: 'json' }))))
      .map(parseDiagnostic)
      .filter((event): event is StoredDiagnostic => Boolean(event))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    const now = Date.now()
    const recent24h = events.filter((event) => now - Date.parse(event.createdAt) <= 86_400_000)
    const recent7d = events.filter((event) => now - Date.parse(event.createdAt) <= 7 * 86_400_000)
    const byKind = recent7d.reduce<Record<string, number>>((result, event) => {
      result[event.kind] = (result[event.kind] ?? 0) + 1
      return result
    }, {})
    return json({
      last24Hours: recent24h.length,
      last7Days: recent7d.length,
      byKind,
      recent: events.slice(0, 12).map(({ createdAt, kind, message, operation, device }) => ({
        createdAt,
        kind,
        message,
        operation,
        device
      }))
    })
  }

  if (req.method === 'DELETE') {
    if (auth.credentialType !== 'master') return json({ error: '仅账号凭证可清除诊断数据' }, 403)
    const { blobs } = await store.list({ prefix })
    await Promise.all(blobs.map((blob) => store.delete(blob.key)))
    return json({ ok: true, deleted: blobs.length })
  }

  return json({ error: 'Method not allowed' }, 405)
}

function parseDiagnostic(value: unknown): StoredDiagnostic | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const device = item.device && typeof item.device === 'object' ? item.device as Record<string, unknown> : null
  if (!device || !isIsoDate(item.createdAt) || !safeText(item.kind, 40) || !safeText(item.message, 500)) return null
  if (!safeText(device.id, 80) || !safeText(device.name, 120) || !safeText(device.platform, 32) || !safeText(device.arch, 32) || !safeText(device.appVersion, 32)) return null
  return {
    createdAt: String(item.createdAt),
    kind: String(item.kind),
    message: sanitize(String(item.message), 500),
    operation: safeText(item.operation, 80) ? sanitize(String(item.operation), 80) : undefined,
    device: {
      id: String(device.id),
      name: String(device.name),
      platform: String(device.platform),
      arch: String(device.arch),
      appVersion: String(device.appVersion)
    }
  }
}

function sanitize(value: string, limit: number): string {
  return value
    .replace(/cm_(?:sync|device)_[A-Za-z0-9_-]{16,}/g, '<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer <redacted>')
    .replace(/https?:\/\/[^\s]+/g, '<url>')
    .slice(0, limit)
}

function safeText(value: unknown, limit: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
}

function isIsoDate(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers })
}

export const config: Config = { path: '/api/diagnostics' }
