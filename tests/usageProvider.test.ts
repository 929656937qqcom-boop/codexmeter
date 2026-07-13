import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCodexUsageSummaryFromCodexHome } from '../src/main/usageProvider'

describe('Codex usage provider', () => {
  it('reads local session jsonl files and automation metadata', () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), 'codexmeter-usage-'))
    const sessionDir = path.join(codexHome, 'sessions', '2026', '07', '08')
    const automationDir = path.join(codexHome, 'automations', 'codex-token')
    mkdirSync(sessionDir, { recursive: true })
    mkdirSync(automationDir, { recursive: true })
    writeFileSync(
      path.join(sessionDir, 'rollout-test.jsonl'),
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-07-08T02:00:00.000Z',
          payload: { id: 'thread-x', cwd: 'C:\\Work\\CodexMeter' }
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-07-08T02:01:00.000Z',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 120,
                cached_input_tokens: 20,
                output_tokens: 10,
                reasoning_output_tokens: 2,
                total_tokens: 130
              }
            }
          }
        })
      ].join('\n'),
      'utf8'
    )
    writeFileSync(
      path.join(automationDir, 'automation.toml'),
      [
        'id = "codex-token"',
        'name = "每日 Codex 对话 token 用量分析"',
        'status = "ACTIVE"',
        'rrule = "FREQ=WEEKLY;BYHOUR=12,15,18"'
      ].join('\n'),
      'utf8'
    )

    const summary = readCodexUsageSummaryFromCodexHome(codexHome, new Date('2026-07-08T04:00:00.000Z'))

    expect(summary.periods.today.total.totalTokens).toBe(130)
    expect(summary.dailyUsage.at(-1)).toMatchObject({
      date: '2026-07-08',
      total: { totalTokens: 130 },
      projects: [{ name: 'CodexMeter', totalTokens: 130 }]
    })
    expect(summary.projects[0]).toMatchObject({ name: 'CodexMeter', totalTokens: 130 })
    expect(summary.tasks.some((task) => task.source === 'codex-token')).toBe(true)
  })
})
