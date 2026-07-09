import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  analyzeCodexUsageEvents,
  type CodexUsageSummary,
  type UsageAnalysisEvent,
  type UsageAutomationInput
} from '../shared/usageAnalytics.js'

export function readCodexUsageSummary(now = new Date()): CodexUsageSummary {
  return readCodexUsageSummaryFromCodexHome(path.join(homedir(), '.codex'), now)
}

export function readCodexUsageSummaryFromCodexHome(codexHome: string, now = new Date()): CodexUsageSummary {
  const events = readSessionEvents([
    path.join(codexHome, 'sessions'),
    path.join(codexHome, 'archived_sessions')
  ])
  const automations = readAutomations(path.join(codexHome, 'automations'))
  return analyzeCodexUsageEvents(events, { now, automations })
}

function readSessionEvents(roots: string[]): UsageAnalysisEvent[] {
  const events: UsageAnalysisEvent[] = []
  for (const root of roots) {
    for (const filePath of listJsonlFiles(root)) {
      const file = path.basename(filePath)
      const lines = safeReadText(filePath).split(/\r?\n/)
      for (const line of lines) {
        if (!line.trim()) {
          continue
        }
        try {
          const parsed = JSON.parse(line) as UsageAnalysisEvent
          events.push({
            file: filePath,
            type: parsed.type,
            timestamp: parsed.timestamp,
            payload: parsed.payload
          })
        } catch {
          events.push({ file, type: 'invalid' })
        }
      }
    }
  }
  return events
}

function readAutomations(root: string): UsageAutomationInput[] {
  if (!existsSync(root)) {
    return []
  }

  return listAutomationFiles(root)
    .map((filePath) => parseAutomationToml(safeReadText(filePath), path.basename(path.dirname(filePath))))
    .filter((item): item is UsageAutomationInput => Boolean(item))
}

export function parseAutomationToml(source: string, fallbackId: string): UsageAutomationInput | null {
  const id = readTomlString(source, 'id') ?? fallbackId
  const name = readTomlString(source, 'name') ?? id
  const status = readTomlString(source, 'status') ?? 'UNKNOWN'
  const rrule = readTomlString(source, 'rrule')
  if (!id) {
    return null
  }
  return { id, name, status, rrule }
}

function listJsonlFiles(root: string): string[] {
  return listFiles(root, (filePath) => filePath.toLowerCase().endsWith('.jsonl'))
}

function listAutomationFiles(root: string): string[] {
  return listFiles(root, (filePath) => path.basename(filePath).toLowerCase() === 'automation.toml')
}

function listFiles(root: string, predicate: (filePath: string) => boolean): string[] {
  if (!existsSync(root)) {
    return []
  }

  const output: string[] = []
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }

    for (const entry of entries) {
      const filePath = path.join(current, entry)
      let stats
      try {
        stats = statSync(filePath)
      } catch {
        continue
      }
      if (stats.isDirectory()) {
        stack.push(filePath)
      } else if (stats.isFile() && predicate(filePath)) {
        output.push(filePath)
      }
    }
  }

  return output
}

function safeReadText(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

function readTomlString(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))
  return match?.[1]
}
