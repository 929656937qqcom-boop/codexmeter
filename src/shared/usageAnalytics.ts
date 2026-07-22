import type { QuotaSnapshot } from './quota.js'

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

export interface UsageThreadSummary extends UsageTokenTotals {
  id: string
  title: string
  workspace: string
  path: string
  events: number
  userMessages: number
  lastActive: string
}

export interface UsageDataQuality {
  score: number
  level: 'high' | 'medium' | 'low'
  files: number
  tokenEvents: number
  incrementalEvents: number
  fallbackEvents: number
  invalidEvents: number
  notes: string[]
}

export interface UsageDeviceProfile {
  id: string
  stableKey?: string
  name: string
  platform: string
  arch?: string
  appVersion?: string
  createdAt: string
}

export interface UsageSyncEventSource {
  source: string
  date: string
  projectName: string
  total: UsageTokenTotals
}

export interface UsageSyncEvent {
  id: string
  date: string
  projectName?: string
  total: UsageTokenTotals
}

export interface UsageCloudProjectSummary extends UsageTokenTotals {
  name: string
  sessions: number
  lastActive: string
}

export interface UsageCloudDailyProjectSummary extends UsageTokenTotals {
  name: string
  events: number
}

export interface UsageDeviceEnvelope {
  schemaVersion: 3
  generatedAt: string
  device: UsageDeviceProfile
  accountFingerprint?: string
  periods: CodexUsageSummary['periods']
  dailyUsage: Array<Pick<UsageDailySummary, 'date' | 'events' | 'total' | 'apiEstimateUsd'> & {
    projects: UsageCloudDailyProjectSummary[]
  }>
  officialUsage: Pick<OfficialAccountUsage, 'available' | 'fetchedAt' | 'dailyUsage'>
  syncEvents: UsageSyncEvent[]
  analytics: {
    projects: UsageCloudProjectSummary[]
    tools: UsageToolSummary[]
    skills: UsageSkillSummary[]
  }
  quota?: QuotaSnapshot
  dataQuality: UsageDataQuality
}

export interface UsageDailyProjectSummary extends UsageTokenTotals {
  name: string
  path: string
  events: number
}

export interface UsageDailySummary {
  date: string
  events: number
  total: UsageTokenTotals
  apiEstimateUsd: number
  projects: UsageDailyProjectSummary[]
}

export interface OfficialUsageDailyBucket {
  date: string
  tokens: number
}

export interface OfficialAccountUsage {
  available: boolean
  fetchedAt: string
  lifetimeTokens?: number
  peakDailyTokens?: number
  dailyUsage: OfficialUsageDailyBucket[]
  history?: OfficialUsageHistorySummary
  error?: string
}

export interface OfficialUsageHistoryDay {
  date: string
  firstSeenAt: string
  lastChangedAt: string
  revisions: number
  firstSeenLagMinutes: number
  lagReliable: boolean
}

export interface OfficialUsageHistorySummary {
  snapshotCount: number
  trackingStartedAt?: string
  lastCapturedAt?: string
  days: OfficialUsageHistoryDay[]
}

export interface UsageReconciliationDay {
  date: string
  localTokens: number
  officialTokens?: number
  differenceTokens?: number
  contributionPercent?: number
  status: 'close' | 'different' | 'official-behind' | 'pending'
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
  device?: UsageDeviceProfile
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
  dailyUsage: UsageDailySummary[]
  officialUsage: OfficialAccountUsage
  reconciliation: UsageReconciliationDay[]
  projects: UsageProjectSummary[]
  threads: UsageThreadSummary[]
  tools: UsageToolSummary[]
  skills: UsageSkillSummary[]
  tasks: UsageTaskItem[]
  dataQuality: UsageDataQuality
  boundaryNote: string
  syncEventSources?: UsageSyncEventSource[]
}

export function attachDeviceProfile(summary: CodexUsageSummary, device: UsageDeviceProfile): CodexUsageSummary {
  return { ...summary, device }
}

export function buildDeviceUsageEnvelope(
  summary: CodexUsageSummary,
  options: { accountFingerprint?: string; syncEvents?: UsageSyncEvent[]; quota?: QuotaSnapshot } = {}
): UsageDeviceEnvelope {
  if (!summary.device) throw new Error('Missing device profile')
  return {
    schemaVersion: 3,
    generatedAt: summary.generatedAt,
    device: summary.device,
    accountFingerprint: options.accountFingerprint,
    periods: summary.periods,
    dailyUsage: summary.dailyUsage.map(({ date, events, total, apiEstimateUsd, projects }) => ({
      date,
      events,
      total,
      apiEstimateUsd,
      projects: projects.slice(0, 8).map(({ name, events, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens }) => ({
        name,
        events,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens
      }))
    })),
    officialUsage: {
      available: summary.officialUsage.available,
      fetchedAt: summary.officialUsage.fetchedAt,
      dailyUsage: summary.officialUsage.dailyUsage
    },
    syncEvents: options.syncEvents ?? [],
    analytics: {
      projects: summary.projects.slice(0, 8).map(({ name, sessions, lastActive, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens }) => ({
        name,
        sessions,
        lastActive,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens
      })),
      tools: summary.tools.slice(0, 8),
      skills: summary.skills.slice(0, 8)
    },
    quota: options.quota,
    dataQuality: summary.dataQuality
  }
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
  events: Iterable<UsageAnalysisEvent>,
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
  const sessions = new Map<string, { id: string; cwd: string; lastActive: string; title: string; userMessages: number }>()
  const projects = new Map<string, UsageProjectSummary>()
  const projectSessionKeys = new Map<string, Set<string>>()
  const threads = new Map<string, UsageThreadSummary>()
  const threadKeysBySession = new Map<string, string>()
  const dailyUsage = createDailyUsageMap(todayStart)
  const dailyProjects = new Map<string, Map<string, UsageDailyProjectSummary>>()
  const tools = new Map<string, UsageToolSummary>()
  const skills = new Map<string, UsageSkillSummary>()
  const pendingCalls = new Map<string, string>()
  const tasks: UsageTaskItem[] = []
  const syncEventSources: UsageSyncEventSource[] = []
  const sourceFiles = new Set<string>()
  let invalidEvents = 0
  let tokenEvents = 0
  let incrementalEvents = 0
  let fallbackEvents = 0

  for (const event of events) {
    sourceFiles.add(event.file)
    if (event.type === 'invalid') {
      invalidEvents += 1
      continue
    }
    const timestamp = parseTimestamp(event.timestamp)
    const payload = asRecord(event.payload)
    const sessionKey = event.file

    if (event.type === 'session_meta') {
      const cwd = stringValue(payload?.cwd) ?? ''
      const id = stringValue(payload?.id) ?? sessionKey
      const lastActive = timestamp?.toISOString() ?? ''
      sessions.set(sessionKey, { id, cwd, lastActive, title: '', userMessages: 0 })
      continue
    }

    if (!timestamp || timestamp < monthStart || timestamp > now) {
      continue
    }

    const session = sessions.get(sessionKey) ?? { id: sessionKey, cwd: '', lastActive: '', title: '', userMessages: 0 }
    session.lastActive = timestamp.toISOString()
    sessions.set(sessionKey, session)

    if (event.type === 'event_msg' && payload?.type === 'token_count') {
      const info = asRecord(payload.info)
      const lastUsage = asRecord(info?.last_token_usage)
      const totalUsage = asRecord(info?.total_token_usage)
      const usage = readTokenUsage(lastUsage ?? totalUsage)
      tokenEvents += 1
      if (lastUsage) incrementalEvents += 1
      else if (totalUsage) fallbackEvents += 1
      addToPeriods(periods, timestamp, todayStart, sevenDaysStart, monthStart, usage, 'events')
      addProjectUsage(projects, projectSessionKeys, session.cwd, sessionKey, timestamp, usage)
      addThreadUsage(threads, threadKeysBySession, session, sessionKey, timestamp, usage)
      addDailyUsage(dailyUsage, dailyProjects, timestamp, session.cwd, sessionKey, usage)
      syncEventSources.push({
        source: [session.id || sessionKey, timestamp.toISOString(), usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, usage.totalTokens].join('|'),
        date: shanghaiDateKey(timestamp),
        projectName: workspaceName(session.cwd || sessionKey),
        total: { ...usage }
      })
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
      incrementTool(tools, name, 0, numberValue(payload.output_chars) || String(payload.output ?? '').length)
      continue
    }

    if (payload?.type === 'message') {
      const text = extractMessageText(payload)
      countSkills(skills, text)
      if (payload.role === 'user') {
        addToPeriodCounters(periods, timestamp, todayStart, sevenDaysStart, monthStart, 'userMessages')
        if (isRealUserText(text)) {
          session.title = compactText(text)
          session.userMessages += 1
          const threadKey = threadKeysBySession.get(sessionKey)
          const thread = threadKey ? threads.get(threadKey) : undefined
          if (thread) {
            thread.title = session.title
            thread.userMessages = session.userMessages
          }
          tasks.push({
            title: session.title,
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

  const dailyUsageSummaries = [...dailyUsage.values()].map((day) => {
    day.apiEstimateUsd = estimateApiValue(day.total)
    day.projects = [...(dailyProjects.get(day.date)?.values() ?? [])]
      .sort((a, b) => b.totalTokens - a.totalTokens || a.name.localeCompare(b.name))
    return day
  })

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
    dailyUsage: dailyUsageSummaries,
    officialUsage: unavailableOfficialUsage(now),
    reconciliation: dailyUsageSummaries.map((day) => ({
      date: day.date,
      localTokens: day.total.totalTokens,
      status: 'pending'
    })),
    projects: [...projects.values()]
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 8),
    threads: [...threads.values()]
      .sort((a, b) => b.totalTokens - a.totalTokens || Date.parse(b.lastActive) - Date.parse(a.lastActive))
      .slice(0, 12),
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
    dataQuality: buildDataQuality(sourceFiles.size, tokenEvents, incrementalEvents, fallbackEvents, invalidEvents),
    boundaryNote: '本机日志粗估，不代表 OpenAI/Codex 账号全量用量或实际账单。',
    syncEventSources
  }
}

function addThreadUsage(
  threads: Map<string, UsageThreadSummary>,
  threadKeysBySession: Map<string, string>,
  session: { id: string; cwd: string; lastActive: string; title: string; userMessages: number },
  sessionKey: string,
  timestamp: Date,
  usage: UsageTokenTotals
): void {
  const key = session.id || sessionKey
  const current = threads.get(key) ?? {
    id: key,
    title: session.title || '未命名线程',
    workspace: workspaceName(session.cwd || sessionKey),
    path: session.cwd,
    events: 0,
    userMessages: session.userMessages,
    lastActive: timestamp.toISOString(),
    ...emptyTotals()
  }
  current.events += 1
  current.userMessages = session.userMessages
  current.lastActive = timestamp.toISOString()
  if (session.title) current.title = session.title
  addTotals(current, usage)
  threads.set(key, current)
  threadKeysBySession.set(sessionKey, key)
}

function buildDataQuality(
  files: number,
  tokenEvents: number,
  incrementalEvents: number,
  fallbackEvents: number,
  invalidEvents: number
): UsageDataQuality {
  if (!tokenEvents) {
    return {
      score: 0,
      level: 'low',
      files,
      tokenEvents,
      incrementalEvents,
      fallbackEvents,
      invalidEvents,
      notes: ['未找到 token_count 记录']
    }
  }

  const fallbackPenalty = (fallbackEvents / tokenEvents) * 40
  const invalidPenalty = Math.min(20, invalidEvents * 2)
  const score = Math.max(0, Math.round(100 - fallbackPenalty - invalidPenalty))
  const notes = ['临时线程、云端任务和未落盘调用不在本机日志内']
  if (fallbackEvents) notes.push(`${fallbackEvents} 条记录使用累计值回退，可能产生偏差`)
  if (invalidEvents) notes.push(`${invalidEvents} 条日志无法解析`)

  return {
    score,
    level: score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low',
    files,
    tokenEvents,
    incrementalEvents,
    fallbackEvents,
    invalidEvents,
    notes
  }
}

export function attachOfficialUsage(
  summary: CodexUsageSummary,
  officialUsage: OfficialAccountUsage
): CodexUsageSummary {
  const officialByDate = new Map(officialUsage.dailyUsage.map((day) => [day.date, day.tokens]))
  const reconciliation = summary.dailyUsage.map<UsageReconciliationDay>((day) => {
    const localTokens = day.total.totalTokens
    const officialTokens = officialByDate.get(day.date)
    if (officialTokens === undefined) {
      return { date: day.date, localTokens, status: 'pending' }
    }

    const differenceTokens = officialTokens - localTokens
    const contributionPercent = officialTokens > 0 ? (localTokens / officialTokens) * 100 : undefined
    if (officialTokens < localTokens) {
      return {
        date: day.date,
        localTokens,
        officialTokens,
        differenceTokens,
        contributionPercent,
        status: 'official-behind'
      }
    }

    const differenceRatio = officialTokens > 0 ? Math.abs(differenceTokens) / officialTokens : 0
    return {
      date: day.date,
      localTokens,
      officialTokens,
      differenceTokens,
      contributionPercent,
      status: differenceRatio <= 0.05 ? 'close' : 'different'
    }
  })

  return { ...summary, officialUsage, reconciliation }
}

function unavailableOfficialUsage(now: Date): OfficialAccountUsage {
  return {
    available: false,
    fetchedAt: now.toISOString(),
    dailyUsage: []
  }
}

function createDailyUsageMap(todayStart: Date): Map<string, UsageDailySummary> {
  const days = new Map<string, UsageDailySummary>()
  for (let offset = 6; offset >= 0; offset -= 1) {
    const start = new Date(todayStart.getTime() - offset * dayMs)
    const date = shanghaiDateKey(start)
    days.set(date, {
      date,
      events: 0,
      total: emptyTotals(),
      apiEstimateUsd: 0,
      projects: []
    })
  }
  return days
}

function addDailyUsage(
  days: Map<string, UsageDailySummary>,
  dailyProjects: Map<string, Map<string, UsageDailyProjectSummary>>,
  timestamp: Date,
  cwd: string,
  sessionKey: string,
  usage: UsageTokenTotals
): void {
  const date = shanghaiDateKey(timestamp)
  const day = days.get(date)
  if (!day) {
    return
  }

  day.events += 1
  addTotals(day.total, usage)

  const path = cwd || sessionKey
  const projects = dailyProjects.get(date) ?? new Map<string, UsageDailyProjectSummary>()
  const project = projects.get(path) ?? {
    name: workspaceName(path),
    path,
    events: 0,
    ...emptyTotals()
  }
  project.events += 1
  addTotals(project, usage)
  projects.set(path, project)
  dailyProjects.set(date, projects)
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

function shanghaiDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + shanghaiOffsetMs)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
    '<turn_aborted>',
    '<heartbeat>',
    '<environment_context>',
    '<app-context>',
    '<collaboration_mode>',
    '<permissions instructions>',
    '<recommended_plugins>',
    '<apps_instructions>',
    '<plugins_instructions>',
    '<personality_spec>',
    '# In app browser:',
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
