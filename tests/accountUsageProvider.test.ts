import { describe, expect, it } from 'vitest'
import { parseOfficialAccountUsage } from '../src/shared/accountUsage'
import { analyzeCodexUsageEvents, attachOfficialUsage } from '../src/shared/usageAnalytics'

describe('official account usage reconciliation', () => {
  it('parses profile daily buckets without retaining profile details', () => {
    const usage = parseOfficialAccountUsage({
      profile: { display_name: 'private' },
      stats: {
        lifetime_tokens: 1_000_000,
        peak_daily_tokens: 600_000,
        daily_usage_buckets: [
          { start_date: '2026-07-11', tokens: 600_000 },
          { start_date: 'invalid', tokens: 10 }
        ]
      }
    }, '2026-07-12T00:00:00.000Z')

    expect(usage).toEqual({
      available: true,
      fetchedAt: '2026-07-12T00:00:00.000Z',
      lifetimeTokens: 1_000_000,
      peakDailyTokens: 600_000,
      dailyUsage: [{ date: '2026-07-11', tokens: 600_000 }]
    })
    expect(usage).not.toHaveProperty('profile')
  })

  it('compares official account totals with local daily totals', () => {
    const now = new Date('2026-07-12T04:00:00.000Z')
    const local = analyzeCodexUsageEvents([{
      file: 'session.jsonl',
      type: 'event_msg',
      timestamp: '2026-07-11T04:00:00.000Z',
      payload: {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 390, output_tokens: 10, total_tokens: 400 } }
      }
    }], { now })

    const result = attachOfficialUsage(local, {
      available: true,
      fetchedAt: now.toISOString(),
      dailyUsage: [{ date: '2026-07-11', tokens: 1_000 }]
    })
    const day = result.reconciliation.find((item) => item.date === '2026-07-11')

    expect(day).toMatchObject({
      localTokens: 400,
      officialTokens: 1_000,
      differenceTokens: 600,
      contributionPercent: 40,
      status: 'different'
    })
  })
})
