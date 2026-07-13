import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getOrCreateDeviceProfile } from '../src/main/deviceIdentity'
import {
  analyzeCodexUsageEvents,
  attachDeviceProfile,
  buildDeviceUsageEnvelope
} from '../src/shared/usageAnalytics'

describe('usage device identity', () => {
  it('keeps a stable device id and builds a privacy-safe aggregate envelope', () => {
    const filePath = path.join(mkdtempSync(path.join(tmpdir(), 'codexmeter-device-')), 'device.json')
    const first = getOrCreateDeviceProfile(filePath, new Date('2026-07-12T00:00:00.000Z'))
    const second = getOrCreateDeviceProfile(filePath, new Date('2026-07-13T00:00:00.000Z'))
    const summary = attachDeviceProfile(analyzeCodexUsageEvents([], {
      now: new Date('2026-07-12T04:00:00.000Z')
    }), first)
    const envelope = buildDeviceUsageEnvelope(summary)

    expect(second.id).toBe(first.id)
    expect(envelope).toMatchObject({
      schemaVersion: 3,
      device: { id: first.id, name: first.name },
      dataQuality: { score: 0 }
    })
    expect(envelope).not.toHaveProperty('tasks')
    expect(envelope).not.toHaveProperty('threads')
    expect(envelope).toHaveProperty('analytics.projects')
    expect(envelope).not.toHaveProperty('analytics.threads')
    expect(envelope).toHaveProperty('syncEvents')
    expect(envelope).toHaveProperty('officialUsage')
  })
})
