import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { recordOfficialUsageSnapshot } from '../src/main/accountUsageHistory'

describe('official usage history', () => {
  it('deduplicates unchanged snapshots and tracks bucket revisions', () => {
    const filePath = path.join(mkdtempSync(path.join(tmpdir(), 'codexmeter-history-')), 'history.json')
    const first = recordOfficialUsageSnapshot(filePath, {
      available: true,
      fetchedAt: '2026-07-12T00:30:00.000Z',
      lifetimeTokens: 1_000,
      dailyUsage: [{ date: '2026-07-12', tokens: 400 }]
    })
    const duplicate = recordOfficialUsageSnapshot(filePath, {
      available: true,
      fetchedAt: '2026-07-12T01:00:00.000Z',
      lifetimeTokens: 1_000,
      dailyUsage: [{ date: '2026-07-12', tokens: 400 }]
    })
    const revised = recordOfficialUsageSnapshot(filePath, {
      available: true,
      fetchedAt: '2026-07-12T02:00:00.000Z',
      lifetimeTokens: 1_200,
      dailyUsage: [{ date: '2026-07-12', tokens: 600 }]
    })

    expect(first.history?.snapshotCount).toBe(1)
    expect(duplicate.history?.snapshotCount).toBe(1)
    expect(revised.history).toMatchObject({
      snapshotCount: 2,
      lastCapturedAt: '2026-07-12T02:00:00.000Z',
      days: [{
        date: '2026-07-12',
        firstSeenAt: '2026-07-12T00:30:00.000Z',
        lastChangedAt: '2026-07-12T02:00:00.000Z',
        revisions: 1,
        firstSeenLagMinutes: 510,
        lagReliable: false
      }]
    })
  })
})
