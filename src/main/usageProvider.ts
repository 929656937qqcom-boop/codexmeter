import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
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
  ], now)
  const automations = readAutomations(path.join(codexHome, 'automations'))
  return analyzeCodexUsageEvents(events, { now, automations })
}

function* readSessionEvents(roots: string[], now: Date): Iterable<UsageAnalysisEvent> {
  const modifiedSince = shanghaiMonthStart(now)
  for (const root of roots) {
    for (const filePath of listJsonlFiles(root, modifiedSince)) {
      yield* readJsonlEvents(filePath)
    }
  }
}

function* readJsonlEvents(filePath: string): Iterable<UsageAnalysisEvent> {
  const file = path.basename(filePath)
  const buffer = Buffer.allocUnsafe(64 * 1024)
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let fileDescriptor: number | undefined

  try {
    fileDescriptor = openSync(filePath, 'r')
    let bytesRead = 0
    do {
      bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null)
      pending += decoder.write(buffer.subarray(0, bytesRead))
      let lineEnd = pending.indexOf('\n')
      while (lineEnd >= 0) {
        const line = pending.slice(0, lineEnd).replace(/\r$/, '')
        pending = pending.slice(lineEnd + 1)
        const event = parseJsonlEvent(line, filePath, file)
        if (event) yield event
        lineEnd = pending.indexOf('\n')
      }
    } while (bytesRead > 0)

    pending += decoder.end()
    const event = parseJsonlEvent(pending.replace(/\r$/, ''), filePath, file)
    if (event) yield event
  } catch {
    yield { file, type: 'invalid' }
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor)
  }
}

function parseJsonlEvent(line: string, filePath: string, file: string): UsageAnalysisEvent | undefined {
  if (!line.trim()) return undefined
  if (!isUsageRelevantLine(line)) return undefined
  if (line.includes('"type":"function_call_output"')) {
    return {
      file: filePath,
      type: 'response_item',
      timestamp: jsonStringField(line, 'timestamp'),
      payload: {
        type: 'function_call_output',
        call_id: jsonStringField(line, 'call_id') ?? '',
        output_chars: line.length
      }
    }
  }
  try {
    const parsed = JSON.parse(line) as UsageAnalysisEvent
    return {
      file: filePath,
      type: parsed.type,
      timestamp: parsed.timestamp,
      payload: parsed.payload
    }
  } catch {
    return { file, type: 'invalid' }
  }
}

function isUsageRelevantLine(line: string): boolean {
  if (line.includes('"type":"session_meta"')) return true
  if (line.includes('"type":"event_msg"')) return line.includes('"type":"token_count"')
  if (!line.includes('"type":"response_item"')) return false
  if (line.includes('"type":"function_call"') || line.includes('"type":"function_call_output"')) return true
  return line.includes('"type":"message"') && line.includes('"role":"user"')
}

function jsonStringField(line: string, key: string): string | undefined {
  const match = line.match(new RegExp(`"${key}":"((?:\\\\.|[^"\\\\])*)"`))
  if (!match) return undefined
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return match[1]
  }
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

function listJsonlFiles(root: string, modifiedSince: Date): string[] {
  return listFiles(root, (filePath) => filePath.toLowerCase().endsWith('.jsonl'))
    .filter((filePath) => {
      try {
        return statSync(filePath).mtime >= modifiedSince
      } catch {
        return false
      }
    })
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

function shanghaiMonthStart(now: Date): Date {
  const shanghaiOffsetMs = 8 * 60 * 60 * 1000
  const shifted = new Date(now.getTime() + shanghaiOffsetMs)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - shanghaiOffsetMs)
}
