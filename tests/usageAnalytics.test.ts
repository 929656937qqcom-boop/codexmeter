import { describe, expect, it } from 'vitest'
import { analyzeCodexUsageEvents } from '../src/shared/usageAnalytics'

describe('Codex local usage analytics', () => {
  it('aggregates token_count events by period, project, tool, task, and API estimate', () => {
    const now = new Date('2026-07-08T04:30:00.000Z')
    const events = [
      {
        file: 'rollout-a.jsonl',
        type: 'session_meta',
        timestamp: '2026-07-08T01:00:00.000Z',
        payload: {
          id: 'thread-a',
          cwd: 'C:\\Users\\Administrator\\Documents\\CodexMeter'
        }
      },
      {
        file: 'rollout-a.jsonl',
        type: 'response_item',
        timestamp: '2026-07-08T01:02:00.000Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '把 codexU 的本地 token 分析页搬到 CodexMeter' }]
        }
      },
      {
        file: 'rollout-a.jsonl',
        type: 'response_item',
        timestamp: '2026-07-08T01:03:00.000Z',
        payload: {
          type: 'function_call',
          call_id: 'call-a',
          name: 'shell_command'
        }
      },
      {
        file: 'rollout-a.jsonl',
        type: 'response_item',
        timestamp: '2026-07-08T01:03:05.000Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call-a',
          output: 'x'.repeat(120)
        }
      },
      {
        file: 'rollout-a.jsonl',
        type: 'event_msg',
        timestamp: '2026-07-08T01:04:00.000Z',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 400,
              output_tokens: 100,
              reasoning_output_tokens: 25,
              total_tokens: 1100
            },
            total_token_usage: {
              input_tokens: 2000,
              cached_input_tokens: 800,
              output_tokens: 200,
              reasoning_output_tokens: 50,
              total_tokens: 2200
            }
          }
        }
      },
      {
        file: 'rollout-b.jsonl',
        type: 'session_meta',
        timestamp: '2026-07-06T02:00:00.000Z',
        payload: {
          id: 'thread-b',
          cwd: 'C:\\Users\\Administrator\\Documents\\品线分析'
        }
      },
      {
        file: 'rollout-b.jsonl',
        type: 'response_item',
        timestamp: '2026-07-06T02:10:00.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '使用 product-design:get-context 和 superpowers:test-driven-development。' }]
        }
      },
      {
        file: 'rollout-b.jsonl',
        type: 'event_msg',
        timestamp: '2026-07-06T02:12:00.000Z',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 500,
              cached_input_tokens: 100,
              output_tokens: 80,
              reasoning_output_tokens: 10,
              total_tokens: 580
            }
          }
        }
      },
      {
        file: 'old.jsonl',
        type: 'event_msg',
        timestamp: '2026-06-01T02:12:00.000Z',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 9999,
              cached_input_tokens: 0,
              output_tokens: 9999,
              reasoning_output_tokens: 0,
              total_tokens: 19998
            }
          }
        }
      }
    ]

    const summary = analyzeCodexUsageEvents(events, {
      now,
      automations: [
        {
          id: 'codex-token',
          name: '每日 Codex 对话 token 用量分析',
          status: 'ACTIVE',
          rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=12,15,18;BYMINUTE=0;BYSECOND=0'
        }
      ]
    })

    expect(summary.periods.today.total.totalTokens).toBe(1100)
    expect(summary.periods.sevenDays.total.totalTokens).toBe(1680)
    expect(summary.periods.month.total.totalTokens).toBe(1680)
    expect(summary.periods.today.total.cachedInputTokens).toBe(400)
    expect(summary.periods.today.apiEstimateUsd).toBeCloseTo(0.0025, 4)
    expect(summary.projects[0]).toMatchObject({
      name: 'CodexMeter',
      totalTokens: 1100,
      sessions: 1
    })
    expect(summary.tools[0]).toMatchObject({
      name: 'shell_command',
      calls: 1,
      outputChars: 120
    })
    expect(summary.skills.map((skill) => skill.name)).toEqual([
      'product-design:get-context',
      'superpowers:test-driven-development'
    ])
    expect(summary.tasks[0].title).toContain('把 codexU')
    expect(summary.tasks.some((task) => task.title.includes('每日 Codex'))).toBe(true)
    expect(summary.boundaryNote).toContain('本机日志粗估')
  })
})
