export interface UsageTokenTotals {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export interface UsagePeriodSummary {
  events: number
  userMessages: number
  toolCalls: number
  total: UsageTokenTotals
  apiEstimateUsd: number
}

export interface UsageProjectSummary extends UsageTokenTotals {
  name: string
  path: string
  sessions: number
  lastActive: string
}

export interface UsageToolSummary {
  name: string
  calls: number
  outputChars: number
}

export interface UsageSkillSummary {
  name: string
  hits: number
}

export interface UsageTaskItem {
  title: string
  source: string
  updatedAt: string
  kind: 'thread' | 'automation'
}

export interface UsageAutomationInput {
  id: string
  name: string
  status: string
  rrule?: string
}

export interface UsageAnalysisEvent {
  file: string
  type: string
  timestamp?: string
  payload?: unknown
}

export interface UsageAnalysisOptions {
  now?: Date
  automations?: UsageAutomationInput[]
}

export interface CodexUsageSummary {
  generatedAt: string
  priceModel: {
    name: string
    inputPerMillionUsd: number
    cachedInputPerMillionUsd: number
    outputPerMillionUsd: number
  }
  periods: {
    today: UsagePeriodSummary
    sevenDays: UsagePeriodSummary
    month: UsagePeriodSummary
  }
  projects: UsageProjectSummary[]
  tools: UsageToolSummary[]
  skills: UsageSkillSummary[]
  tasks: UsageTaskItem[]
  boundaryNote: string
}

const dayMs = 24 * 60 * 60 * 1000
const shanghaiOffsetMs = 8 * 60 * 60 * 1000
const priceModel = {
  name: 'Codex API equivalent rough estimate',
  inputPerMillionUsd: 1.75,
  cachedInputPerMillionUsd: 0.175,
  outputPerMillionUsd: 14
}

const emptyTotals = (): UsageTokenTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0
})

const emptyPeriod = (): UsagePeriodSummary => ({
  events: 0,
  userMessages: 0,
  toolCalls: 0,
  total: emptyTotals(),
  apiEstimateUsd: 0
})

export function analyzeCodexUsageEvents(
  events: UsageAnalysisEvent[],
  options: UsageAnalysisOptions = {}
): CodexUsageSummary {
  const now = options.now ?? new Date()
  const todayStart = shanghaiDayStart(now)
  const sevenDaysStart = new Date(todayStart.getTime() - 6 * dayMs)
  const monthStart = shanghaiMonthStart(now)
  const periods = {
    today: emptyPeriod(),
    sevenDays: emptyPeriod(),
    month: emptyPeriod()
  }
  const sessions = new Map<string, { cwd: string; lastActive: string }>()
  const projects = new Map<string, UsageProjectSummary>()
  const projectSessionKeys = new Map<string, Set<string>>()
  const tools = new Map<string, UsageToolSummary>()
  const skills = new Map<string, UsageSkillSummary>()
  const pendingCalls = new Map<string, string>()
  const tasks: UsageTaskItem[] = []

  for (const event of events) {
    const timestamp = parseTimestamp(event.timestamp)
    const payload = asRecord(event.payload)
    const sessionKey = event.file

    if (event.type === 'session_meta') {
      const cwd = stringValue(payload?.cwd) ?? ''
      const lastActive = timestamp?.toISOString() ?? ''
      sessions.set(sessionKey, { cwd, lastActive })
      continue
    }

    if (!timestamp || timestamp < monthStart || timestamp > now) {
      continue
    }

    const session = sessions.get(sessionKey) ?? { cwd: '', lastActive: '' }
    session.lastActive = timestamp.toISOString()
    sessions.set(sessionKey, session)

    if (event.type === 'event_msg' && payload?.type === 'token_count') {
      const info = asRecord(payload.info)
      const usage = readTokenUsage(asRecord(info?.last_token_usage) ?? asRecord(info?.total_token_usage))
      addToPeriods(periods, timestamp, todayStart, sevenDaysStart, monthStart, usage, 'events')
      addProjectUsage(projects, projectSessionKeys, session.cwd, sessionKey, timestamp, usage)
      continue
    }

    if (event.type !== 'response_item') {
      continue
    }

    if (payload?.type === 'function_call') {
      const name = stringValue(payload.name) ?? 'function_call'
      const callId = stringValue(payload.call_id) ?? stringValue(payload.id) ?? `${sessionKey}:${timestamp.toISOString()}`
      pendingCalls.set(callId, name)
      incrementTool(tools, name, 1, 0)
      addToPeriodCounters(periods, timestamp, todayStart, sevenDaysStart, monthStart, 'toolCalls')
      continue
    }

    if (payload?.type === 'function_call_output') {
      const callId = stringValue(payload.call_id) ?? ''
      const name = pendingCalls.get(callId) ?? 'tool_output'
      incrementTool(tools, name, 0, String(payload.output ?? '').length)
      continue
    }

    if (payload?.type === 'message') {
      const text = extractMessageText(payload)
      countSkills(skills, text)
      if (payload.role === 'user') {
        addToPeriodCounters(periods, timestamp, todayStart, sevenDaysStart, monthStart, 'userMessages')
        if (isRealUserText(text)) {
          tasks.push({
            title: compactText(text),
            source: workspaceName(session.cwd || event.file),
            updatedAt: timestamp.toISOString(),
            kind: 'thread'
          })
        }
      }
    }
  }

  for (const period of Object.values(periods)) {
    period.apiEstimateUsd = estimateApiValue(period.total)
  }

  for (const automation of options.automations ?? []) {
    tasks.push({
      title: `${automation.name} (${automation.status})`,
      source: automation.id,
      updatedAt: now.toISOString(),
      kind: 'automation'
    })
  }

  return {
    generatedAt: now.toISOString(),
    priceModel,
    periods,
    projects: [...projects.values()]
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 8),
    tools: [...tools.values()]
      .sort((a, b) => toolCostScore(b) - toolCostScore(a) || b.calls - a.calls)
      .slice(0, 8),
    skills: [...skills.values()]
      .sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name))
      .slice(0, 8),
    tasks: tasks
      .sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === 'thread' ? -1 : 1
        }
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      })
      .slice(0, 8),
    boundaryNote: '本机日志粗估，不代表 OpenAI/Codex 账号全量用量或实际账单。'
  }
}

function addToPeriods(
  periods: CodexUsageSummary['periods'],
  timestamp: Date,
  todayStart: Date,
  sevenDaysStart: Date,
  monthStart: Date,
  usage: UsageTokenTotals,
  counter: 'events'
): void {
  if (timestamp >= todayStart) {
    periods.today[counter] += 1
    addTotals(periods.today.total, usage)
  }
  if (timestamp >= sevenDaysStart) {
    periods.sevenDays[counter] += 1
    addTotals(periods.sevenDays.total, usage)
  }
  if (timestamp >= monthStart) {
    periods.month[counter] += 1
    addTotals(periods.month.total, usage)
  }
}

function addToPeriodCounters(
  periods: CodexUsageSummary['periods'],
  timestamp: Date,
  todayStart: Date,
  sevenDaysStart: Date,
  monthStart: Date,
  counter: 'userMessages' | 'toolCalls'
): void {
  if (timestamp >= todayStart) periods.today[counter] += 1
  if (timestamp >= sevenDaysStart) periods.sevenDays[counter] += 1
  if (timestamp >= monthStart) periods.month[counter] += 1
}

function addProjectUsage(
  projects: Map<string, UsageProjectSummary>,
  projectSessionKeys: Map<string, Set<string>>,
  cwd: string,
  sessionKey: string,
  timestamp: Date,
  usage: UsageTokenTotals
): void {
  const path = cwd || sessionKey
  const current = projects.get(path) ?? {
    name: workspaceName(path),
    path,
    sessions: 0,
    lastActive: timestamp.toISOString(),
    ...emptyTotals()
  }
  const sessions = projectSessionKeys.get(path) ?? new Set<string>()
  if (!sessions.has(sessionKey)) {
    sessions.add(sessionKey)
    current.sessions += 1
    projectSessionKeys.set(path, sessions)
  }
  current.lastActive = timestamp.toISOString()
  addTotals(current, usage)
  projects.set(path, current)
}

function incrementTool(tools: Map<string, UsageToolSummary>, name: string, calls: number, outputChars: number): void {
  const current = tools.get(name) ?? { name, calls: 0, outputChars: 0 }
  current.calls += calls
  current.outputChars += outputChars
  tools.set(name, current)
}

function toolCostScore(tool: UsageToolSummary): number {
  return tool.outputChars + tool.calls * 500
}

function countSkills(skills: Map<string, UsageSkillSummary>, text: string): void {
  const matches = text.match(/\b(?:product-design|superpowers|lark|github|gmail|netlify|browser|chrome|pdf|documents|spreadsheets|presentations):[\w-]+/g) ?? []
  for (const name of matches) {
    const current = skills.get(name) ?? { name, hits: 0 }
    current.hits += 1
    skills.set(name, current)
  }
}

function readTokenUsage(input: Record<string, unknown> | null): UsageTokenTotals {
  return {
    inputTokens: numberValue(input?.input_tokens),
    cachedInputTokens: numberValue(input?.cached_input_tokens),
    outputTokens: numberValue(input?.output_tokens),
    reasoningOutputTokens: numberValue(input?.reasoning_output_tokens),
    totalTokens: numberValue(input?.total_tokens)
  }
}

function estimateApiValue(total: UsageTokenTotals): number {
  const uncachedInput = Math.max(0, total.inputTokens - total.cachedInputTokens)
  const value =
    (uncachedInput * priceModel.inputPerMillionUsd
      + total.cachedInputTokens * priceModel.cachedInputPerMillionUsd
      + total.outputTokens * priceModel.outputPerMillionUsd)
    / 1_000_000
  return Math.round(value * 10_000) / 10_000
}

function addTotals(target: UsageTokenTotals, usage: UsageTokenTotals): void {
  target.inputTokens += usage.inputTokens
  target.cachedInputTokens += usage.cachedInputTokens
  target.outputTokens += usage.outputTokens
  target.reasoningOutputTokens += usage.reasoningOutputTokens
  target.totalTokens += usage.totalTokens
}

function shanghaiDayStart(date: Date): Date {
  const shifted = new Date(date.getTime() + shanghaiOffsetMs)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - shanghaiOffsetMs)
}

function shanghaiMonthStart(date: Date): Date {
  const shifted = new Date(date.getTime() + shanghaiOffsetMs)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - shanghaiOffsetMs)
}

function parseTimestamp(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberValue(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function extractMessageText(payload: Record<string, unknown>): string {
  const content = Array.isArray(payload.content) ? payload.content : []
  return content
    .map((item) => {
      const record = asRecord(item)
      return stringValue(record?.text) ?? stringValue(record?.input_text) ?? stringValue(record?.output_text) ?? ''
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isRealUserText(text: string): boolean {
  const cleaned = stripUserContextNoise(text)
  if (!cleaned) {
    return false
  }

  const internalPrefixes = [
    '<heartbeat>',
    '<environment_context>',
    '<recommended_plugins>',
    '<apps_instructions>',
    '<plugins_instructions>',
    '<personality_spec>',
    '# AGENTS.md instructions'
  ]
  const acknowledgements = new Set(['好', '好的', '可以', '嗯', '嗯嗯', '行', 'OK', 'ok'])

  return !internalPrefixes.some((prefix) => cleaned.startsWith(prefix))
    && !acknowledgements.has(cleaned)
}

function compactText(text: string): string {
  const cleaned = stripUserContextNoise(text)
  return cleaned.length > 72 ? `${cleaned.slice(0, 72)}...` : cleaned
}

function stripUserContextNoise(text: string): string {
  const requestMatch = text.match(/#+\s*My request for Codex:\s*([\s\S]*)$/i)
  const source = requestMatch?.[1] ?? text
  return source.replace(/\s+/g, ' ').trim()
    .replace(/<image\b[^>]*>/gi, '')
    .replace(/<\/image>/gi, '')
    .replace(/<file\b[^>]*>/gi, '')
    .replace(/<\/file>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function workspaceName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? 'Unknown'
}
