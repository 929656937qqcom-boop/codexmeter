import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type {
  OfficialAccountUsage,
  OfficialUsageDailyBucket,
  OfficialUsageHistoryDay,
  OfficialUsageHistorySummary
} from '../shared/usageAnalytics.js'

interface StoredUsageSnapshot {
  capturedAt: string
  lifetimeTokens?: number
  dailyUsage: OfficialUsageDailyBucket[]
}

interface StoredUsageHistory {
  version: 1
  snapshots: StoredUsageSnapshot[]
}

const maxSnapshots = 500
export function recordOfficialUsageSnapshot(filePath: string, usage: OfficialAccountUsage): OfficialAccountUsage {
  if (!usage.available) return usage

  const history = readHistory(filePath)
  const snapshot: StoredUsageSnapshot = {
    capturedAt: usage.fetchedAt,
    lifetimeTokens: usage.lifetimeTokens,
    dailyUsage: usage.dailyUsage
  }
  const previous = history.snapshots.at(-1)
  if (!previous || snapshotFingerprint(previous) !== snapshotFingerprint(snapshot)) {
    history.snapshots.push(snapshot)
    history.snapshots = history.snapshots.slice(-maxSnapshots)
    writeHistory(filePath, history)
  }

  return { ...usage, history: summarizeHistory(history) }
}

export function readOfficialUsageHistory(filePath: string): OfficialUsageHistorySummary {
  return summarizeHistory(readHistory(filePath))
}

function summarizeHistory(history: StoredUsageHistory): OfficialUsageHistorySummary {
  const days = new Map<string, OfficialUsageHistoryDay & { lastTokens: number }>()
  const trackingStartedAt = history.snapshots[0]?.capturedAt
  for (const snapshot of history.snapshots) {
    for (const bucket of snapshot.dailyUsage) {
      const current = days.get(bucket.date)
      if (!current) {
        days.set(bucket.date, {
          date: bucket.date,
          firstSeenAt: snapshot.capturedAt,
          lastChangedAt: snapshot.capturedAt,
          revisions: 0,
          firstSeenLagMinutes: firstSeenLagMinutes(bucket.date, snapshot.capturedAt),
          lagReliable: Boolean(trackingStartedAt && Date.parse(trackingStartedAt) <= Date.parse(`${bucket.date}T00:00:00+08:00`)),
          lastTokens: bucket.tokens
        })
      } else if (current.lastTokens !== bucket.tokens) {
        current.lastTokens = bucket.tokens
        current.lastChangedAt = snapshot.capturedAt
        current.revisions += 1
      }
    }
  }

  return {
    snapshotCount: history.snapshots.length,
    trackingStartedAt,
    lastCapturedAt: history.snapshots.at(-1)?.capturedAt,
    days: [...days.values()]
      .map(({ lastTokens: _lastTokens, ...day }) => day)
      .sort((a, b) => a.date.localeCompare(b.date))
  }
}

function firstSeenLagMinutes(date: string, capturedAt: string): number {
  const startUtc = Date.parse(`${date}T00:00:00+08:00`)
  return Math.max(0, Math.round((Date.parse(capturedAt) - startUtc) / 60_000))
}

function snapshotFingerprint(snapshot: StoredUsageSnapshot): string {
  return JSON.stringify({ lifetimeTokens: snapshot.lifetimeTokens, dailyUsage: snapshot.dailyUsage })
}

function readHistory(filePath: string): StoredUsageHistory {
  if (!existsSync(filePath)) return { version: 1, snapshots: [] }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as StoredUsageHistory
    return parsed.version === 1 && Array.isArray(parsed.snapshots) ? parsed : { version: 1, snapshots: [] }
  } catch {
    return { version: 1, snapshots: [] }
  }
}

function writeHistory(filePath: string, history: StoredUsageHistory): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(history, null, 2), { encoding: 'utf8', mode: 0o600 })
}
