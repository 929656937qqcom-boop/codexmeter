import { describe, expect, it } from 'vitest'
import { aggregateDevices, parseDeviceUsage } from '../cloud/netlify/functions/_shared/schema'

function envelope(deviceId: string, name: string, totalTokens: number) {
  const total = {
    inputTokens: totalTokens - 30,
    cachedInputTokens: 10,
    outputTokens: 20,
    reasoningOutputTokens: 0,
    totalTokens
  }
  const period = { events: 1, userMessages: 1, toolCalls: 0, total, apiEstimateUsd: 0.01 }
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-12T08:00:00.000Z',
    device: { id: deviceId, name, platform: 'win32', createdAt: '2026-07-01T00:00:00.000Z' },
    periods: { today: period, sevenDays: period, month: period },
    dailyUsage: [{ date: '2026-07-12', events: 1, total, apiEstimateUsd: 0.01 }],
    dataQuality: { score: 96, level: 'good', files: 2, tokenEvents: 1 }
  }
}

describe('cloud usage schema', () => {
  it('accepts privacy-safe device summaries and aggregates daily contribution', () => {
    const first = parseDeviceUsage(envelope('device_0001', 'Office PC', 100), '2026-07-12T08:01:00.000Z')
    const second = parseDeviceUsage(envelope('device_0002', 'Laptop', 300), '2026-07-12T08:02:00.000Z')

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    const result = aggregateDevices([first!, second!])
    expect(result.deviceCount).toBe(2)
    expect(result.dailyUsage[0]).toMatchObject({
      date: '2026-07-12',
      totalTokens: 400,
      devices: { device_0001: 100, device_0002: 300 }
    })
  })

  it('rejects payloads that do not match the device envelope', () => {
    expect(parseDeviceUsage({ prompt: 'private content' }, new Date().toISOString())).toBeNull()
  })

  it('deduplicates cross-device events and keeps one official account bucket', () => {
    const firstPayload = {
      ...envelope('device_0001', 'Windows', 100),
      schemaVersion: 2,
      accountFingerprint: 'account_fingerprint_00000000000000000000',
      syncEvents: [{ id: 'event_fingerprint_000000000000000000000', date: '2026-07-12', total: envelope('x_device', 'x', 100).dailyUsage[0].total }],
      officialUsage: { available: true, fetchedAt: '2026-07-12T08:00:00.000Z', dailyUsage: [{ date: '2026-07-12', tokens: 150 }] }
    }
    const secondPayload = {
      ...envelope('device_0002', 'Mac', 100),
      schemaVersion: 2,
      accountFingerprint: 'account_fingerprint_00000000000000000000',
      syncEvents: firstPayload.syncEvents,
      officialUsage: { available: true, fetchedAt: '2026-07-12T09:00:00.000Z', dailyUsage: [{ date: '2026-07-12', tokens: 180 }] }
    }
    const first = parseDeviceUsage(firstPayload, '2026-07-12T08:01:00.000Z')
    const second = parseDeviceUsage(secondPayload, '2026-07-12T09:01:00.000Z')
    const result = aggregateDevices([first!, second!], new Date('2026-07-12T10:00:00.000Z'))

    expect(result.dailyUsage[0].totalTokens).toBe(100)
    expect(result.deduplication).toEqual({ uniqueEvents: 1, duplicateEvents: 1 })
    expect(result.officialDailyUsage[0].tokens).toBe(180)
    expect(result.accountVerified).toBe(true)
  })

  it('uses complete daily aggregates instead of truncating totals to the rolling event sample', () => {
    const payload = {
      ...envelope('device_0001', 'Windows', 600),
      schemaVersion: 3,
      dailyUsage: [{
        ...envelope('device_0001', 'Windows', 600).dailyUsage[0],
        projects: [{
          name: 'CodexMeter',
          events: 6,
          inputTokens: 500,
          cachedInputTokens: 50,
          outputTokens: 50,
          reasoningOutputTokens: 0,
          totalTokens: 600
        }]
      }],
      syncEvents: [{
        id: 'event_fingerprint_000000000000000000000',
        date: '2026-07-12',
        projectName: 'CodexMeter',
        total: envelope('x_device', 'x', 100).dailyUsage[0].total
      }],
      analytics: {
        projects: [{
          name: 'CodexMeter', sessions: 2, lastActive: '2026-07-12T08:00:00.000Z',
          inputTokens: 500, cachedInputTokens: 50, outputTokens: 50, reasoningOutputTokens: 0, totalTokens: 600
        }],
        tools: [{ name: 'shell_command', calls: 3, outputChars: 900 }],
        skills: [{ name: 'github-auto-sync', hits: 1 }]
      },
      quota: {
        available: true,
        refreshedAt: '2026-07-12T08:00:00.000Z',
        source: 'codex',
        windows: [{ code: '5h', percentUsed: 25, resetAt: '2026-07-12T10:00:00.000Z' }],
        resetCards: [{ expiresAt: '2026-08-01T00:00:00.000Z' }]
      }
    }
    const parsed = parseDeviceUsage(payload, '2026-07-12T08:01:00.000Z')
    const result = aggregateDevices([parsed!], new Date('2026-07-12T10:00:00.000Z'))

    expect(result.dailyUsage[0].totalTokens).toBe(600)
    expect(result.dailyUsage[0].projects[0]).toMatchObject({ name: 'CodexMeter', totalTokens: 600 })
    expect(result.projects[0]).toMatchObject({ name: 'CodexMeter', totalTokens: 600 })
    expect(result.tools[0]).toMatchObject({ name: 'shell_command', calls: 3 })
    expect(result.quota).toMatchObject({ available: true, windows: [{ code: '5h', percentUsed: 25 }] })
  })

  it('does not let a newer unavailable device snapshot hide valid account quota', () => {
    const validPayload = {
      ...envelope('device_0001', 'Windows', 100),
      schemaVersion: 3,
      quota: {
        available: true,
        refreshedAt: '2026-07-12T08:00:00.000Z',
        source: 'codex',
        windows: [
          { code: '5h', percentUsed: 35, resetAt: '2026-07-12T10:00:00.000Z' },
          { code: '7d', percentUsed: 70, resetAt: '2026-07-18T00:00:00.000Z' }
        ],
        resetCards: [{ expiresAt: '2026-08-01T00:00:00.000Z' }]
      }
    }
    const unavailablePayload = {
      ...envelope('device_0002', 'Laptop', 200),
      schemaVersion: 3,
      quota: {
        available: false,
        refreshedAt: '2026-07-12T09:00:00.000Z',
        source: 'unavailable',
        windows: [],
        resetCards: []
      }
    }
    const valid = parseDeviceUsage(validPayload, '2026-07-12T08:01:00.000Z')
    const unavailable = parseDeviceUsage(unavailablePayload, '2026-07-12T09:01:00.000Z')
    const result = aggregateDevices([valid!, unavailable!])

    expect(result.quota).toMatchObject({
      available: true,
      windows: [{ code: '5h', percentUsed: 35 }, { code: '7d', percentUsed: 70 }],
      resetCards: [{ expiresAt: '2026-08-01T00:00:00.000Z' }]
    })
  })
})
