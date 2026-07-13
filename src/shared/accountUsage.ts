import type { OfficialAccountUsage, OfficialUsageDailyBucket } from './usageAnalytics.js'

export function parseOfficialAccountUsage(payload: unknown, fetchedAt = new Date().toISOString()): OfficialAccountUsage {
  const root = asRecord(payload)
  const stats = asRecord(root?.stats)
  const dailyUsage = Array.isArray(stats?.daily_usage_buckets)
    ? stats.daily_usage_buckets.map(parseDailyBucket).filter((item): item is OfficialUsageDailyBucket => Boolean(item))
    : []

  return {
    available: Boolean(stats),
    fetchedAt,
    lifetimeTokens: finiteNumber(stats?.lifetime_tokens),
    peakDailyTokens: finiteNumber(stats?.peak_daily_tokens),
    dailyUsage: dailyUsage.sort((a, b) => a.date.localeCompare(b.date))
  }
}

function parseDailyBucket(value: unknown): OfficialUsageDailyBucket | null {
  const bucket = asRecord(value)
  const date = typeof bucket?.start_date === 'string' ? bucket.start_date : ''
  const tokens = finiteNumber(bucket?.tokens)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || tokens === undefined) return null
  return { date, tokens }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}
