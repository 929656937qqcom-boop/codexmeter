import { createHash, randomBytes } from 'node:crypto'
import { getCloudSyncKey } from './store.js'
import { getAccountFingerprint } from './accountIdentity.js'
import { buildDeviceUsageEnvelope, type CodexUsageSummary, type UsageSyncEvent } from '../shared/usageAnalytics.js'
import type { QuotaSnapshot } from '../shared/quota.js'

export interface CloudSyncResult {
  synced: boolean
  syncedAt?: string
  error?: string
}

const syncTimeoutMs = 20_000
const pairingTimeoutMs = 12_000

export function createCloudSyncKey(): string {
  return `cm_sync_${randomBytes(32).toString('base64url')}`
}

export async function syncDeviceUsage(endpoint: string, summary: CodexUsageSummary, quota?: QuotaSnapshot): Promise<CloudSyncResult> {
  const key = getCloudSyncKey()
  if (!key) return { synced: false, error: '尚未生成同步密钥' }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'CodexMeter/0.1'
      },
      signal: AbortSignal.timeout(syncTimeoutMs),
      body: JSON.stringify(buildDeviceUsageEnvelope(summary, {
        accountFingerprint: getAccountFingerprint(),
        syncEvents: buildSyncEvents(summary),
        quota
      }))
    })
    if (!response.ok) return { synced: false, error: `云端同步失败 (${response.status})` }
    return { synced: true, syncedAt: new Date().toISOString() }
  } catch (error) {
    return { synced: false, error: cloudErrorMessage(error, '云端同步失败') }
  }
}

export async function syncDeviceQuota(endpoint: string, deviceId: string, quota: QuotaSnapshot): Promise<CloudSyncResult> {
  const key = getCloudSyncKey()
  if (!key) return { synced: false, error: '尚未生成同步密钥' }
  try {
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'CodexMeter/0.1'
      },
      signal: AbortSignal.timeout(syncTimeoutMs),
      body: JSON.stringify({ deviceId, quota })
    })
    if (!response.ok) return { synced: false, error: `云端额度同步失败 (${response.status})` }
    return { synced: true, syncedAt: new Date().toISOString() }
  } catch (error) {
    return { synced: false, error: cloudErrorMessage(error, '云端额度同步失败') }
  }
}

export async function createPairingCode(endpoint: string): Promise<{ code: string; expiresAt: string }> {
  const key = getCloudSyncKey()
  if (!key) throw new Error('请先生成同步密钥')
  const response = await cloudFetch(apiUrl(endpoint, 'pair'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(pairingTimeoutMs)
  })
  const data = await response.json() as { code?: string; expiresAt?: string; error?: string }
  if (!response.ok || !data.code || !data.expiresAt) throw new Error(data.error ?? `生成配对码失败 (${response.status})`)
  return { code: data.code, expiresAt: data.expiresAt }
}

export async function redeemPairingCode(endpoint: string, code: string): Promise<string> {
  const url = apiUrl(endpoint, 'pair')
  url.searchParams.set('code', code.trim().toUpperCase())
  const response = await cloudFetch(url, { signal: AbortSignal.timeout(pairingTimeoutMs) })
  const data = await response.json() as { token?: string; error?: string }
  if (!response.ok || !data.token) throw new Error(data.error ?? `加入同步空间失败 (${response.status})`)
  return data.token
}

function apiUrl(endpoint: string, resource: string): URL {
  const url = new URL(endpoint)
  url.pathname = `/api/${resource}`
  url.search = ''
  url.hash = ''
  return url
}

function buildSyncEvents(summary: CodexUsageSummary): UsageSyncEvent[] {
  return (summary.syncEventSources ?? []).slice(-5000).map((event) => ({
    id: createHash('sha256').update(`codexmeter-event-v1:${event.source}`).digest('base64url'),
    date: event.date,
    projectName: event.projectName,
    total: event.total
  }))
}

function cloudErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return '云端请求超时，请检查网络后重试'
  }
  return error instanceof Error ? error.message : fallback
}

async function cloudFetch(input: string | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    throw new Error(cloudErrorMessage(error, '云端连接失败'))
  }
}
