export interface StoredDeviceUsage {
  schemaVersion: 1 | 2 | 3
  receivedAt: string
  generatedAt: string
  accountFingerprint?: string
  device: { id: string; stableKey?: string; name: string; platform: string; arch?: string; appVersion?: string; createdAt: string }
  periods: Record<'today' | 'sevenDays' | 'month', UsagePeriod>
  dailyUsage: DailyUsage[]
  officialUsage?: { available: boolean; fetchedAt: string; dailyUsage: Array<{ date: string; tokens: number }> }
  syncEvents: Array<{ id: string; date: string; projectName?: string; total: TokenTotals }>
  analytics?: {
    projects: CloudProject[]
    tools: Array<{ name: string; calls: number; outputChars: number }>
    skills: Array<{ name: string; hits: number }>
  }
  quota?: StoredQuota
  dataQuality: { score: number; level: string; files: number; tokenEvents: number }
}

interface StoredQuota {
  available: boolean
  refreshedAt: string
  source: 'codex' | 'sample' | 'unavailable'
  planType?: string
  windows: Array<{ code: '5h' | '7d'; percentUsed: number; resetAt?: string }>
  resetCards: Array<{ expiresAt: string }>
}

interface UsagePeriod {
  events: number
  userMessages: number
  toolCalls: number
  total: TokenTotals
  apiEstimateUsd: number
}

interface DailyUsage {
  date: string
  events: number
  total: TokenTotals
  apiEstimateUsd: number
  projects: CloudDailyProject[]
}

interface CloudProject extends TokenTotals {
  name: string
  sessions: number
  lastActive: string
}

interface CloudDailyProject extends TokenTotals {
  name: string
  events: number
}

interface TokenTotals {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

type AggregateDay = {
  date: string
  events: number
  total: TokenTotals
  devices: Record<string, number>
  projects: Map<string, CloudDailyProject>
}

const emptyTotals = (): TokenTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0
})

const emptyPeriod = (): UsagePeriod => ({
  events: 0,
  userMessages: 0,
  toolCalls: 0,
  total: emptyTotals(),
  apiEstimateUsd: 0
})

export function parseDeviceUsage(value: unknown, receivedAt: string): StoredDeviceUsage | null {
  const root = record(value)
  const device = record(root?.device)
  const periods = record(root?.periods)
  const quality = record(root?.dataQuality)
  if (!root || ![1, 2, 3].includes(Number(root.schemaVersion)) || !device || !periods || !quality) return null
  if (!safeId(device.id) || !safeText(device.name, 120) || !safeText(device.platform, 32)) return null
  if (!isoDate(device.createdAt) || !isoDate(root.generatedAt)) return null

  const today = parsePeriod(periods.today)
  const sevenDays = parsePeriod(periods.sevenDays)
  const month = parsePeriod(periods.month)
  const daily = Array.isArray(root.dailyUsage)
    ? root.dailyUsage.map(parseDailyUsage).filter((item): item is DailyUsage => Boolean(item)).slice(-31)
    : []
  if (!today || !sevenDays || !month || daily.length > 31) return null

  const schemaVersion = Number(root.schemaVersion) as 1 | 2 | 3
  const syncEvents = schemaVersion >= 2 && Array.isArray(root.syncEvents)
    ? root.syncEvents.map(parseSyncEvent).filter((item): item is StoredDeviceUsage['syncEvents'][number] => Boolean(item)).slice(-100_000)
    : []
  const officialUsage = schemaVersion >= 2 ? parseOfficialUsage(root.officialUsage) : undefined
  const accountFingerprint = safeFingerprint(root.accountFingerprint) ? String(root.accountFingerprint) : undefined

  return {
    schemaVersion,
    receivedAt,
    generatedAt: String(root.generatedAt),
    accountFingerprint,
    device: {
      id: String(device.id),
      stableKey: safeFingerprint(device.stableKey) ? String(device.stableKey) : undefined,
      name: String(device.name).slice(0, 120),
      platform: String(device.platform).slice(0, 32),
      arch: safeText(device.arch, 32) ? String(device.arch) : undefined,
      appVersion: safeText(device.appVersion, 32) ? String(device.appVersion) : undefined,
      createdAt: String(device.createdAt)
    },
    periods: { today, sevenDays, month },
    dailyUsage: daily,
    officialUsage,
    syncEvents,
    analytics: schemaVersion >= 3 ? parseAnalytics(root.analytics) : undefined,
    quota: schemaVersion >= 3 ? parseQuota(root.quota) : undefined,
    dataQuality: {
      score: bounded(quality.score, 0, 100),
      level: safeText(quality.level, 16) ? String(quality.level) : 'unknown',
      files: bounded(quality.files, 0, 1_000_000),
      tokenEvents: bounded(quality.tokenEvents, 0, 100_000_000)
    }
  }
}

export function aggregateDevices(input: StoredDeviceUsage[], now = new Date()) {
  const devices = latestByPhysicalDevice(input)
  const daily = new Map<string, AggregateDay>()
  const periods = { today: emptyPeriod(), sevenDays: emptyPeriod(), month: emptyPeriod() }
  const seenEvents = new Map<string, string>()
  let duplicateEvents = 0
  const today = shanghaiDateKey(now)
  const monthStart = today.slice(0, 8) + '01'
  const sevenDayKeys = new Set(Array.from({ length: 7 }, (_, index) => shanghaiDateKey(new Date(now.getTime() - index * 86_400_000))))

  for (const item of devices) {
    const snapshotDate = shanghaiDateKey(new Date(item.generatedAt))
    if (snapshotDate >= monthStart && snapshotDate <= today) addPeriod(periods.month, item.periods.month)
    for (const day of item.dailyUsage) addDaily(daily, day, item.device.id)
  }

  for (const item of devices) {
    for (const event of item.syncEvents) {
      const owner = seenEvents.get(event.id)
      if (!owner) {
        seenEvents.set(event.id, item.device.id)
        continue
      }
      if (owner === item.device.id) continue
      duplicateEvents += 1
      subtractDuplicate(daily, periods, event, item.device.id, now)
    }
  }
  periods.today = periodFromDaily(daily, new Set([today]))
  periods.sevenDays = periodFromDaily(daily, sevenDayKeys)
  for (const period of Object.values(periods)) period.apiEstimateUsd = estimateApiValue(period.total)

  const officialByDate = new Map<string, { date: string; tokens: number; fetchedAt: string }>()
  for (const item of devices) {
    if (!item.officialUsage?.available) continue
    for (const day of item.officialUsage.dailyUsage) {
      const current = officialByDate.get(day.date)
      if (!current || Date.parse(item.officialUsage.fetchedAt) > Date.parse(current.fetchedAt)) {
        officialByDate.set(day.date, { ...day, fetchedAt: item.officialUsage.fetchedAt })
      }
    }
  }

  const dailyUsage = [...daily.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-31)
    .map((day) => ({
      date: day.date,
      events: day.events,
      total: day.total,
      totalTokens: day.total.totalTokens,
      devices: day.devices,
      projects: [...day.projects.values()].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 8)
    }))
  const deviceTotals = new Map<string, number>()
  for (const day of daily.values()) {
    for (const [deviceId, tokens] of Object.entries(day.devices)) {
      deviceTotals.set(deviceId, (deviceTotals.get(deviceId) ?? 0) + tokens)
    }
  }
  const localTotal = [...deviceTotals.values()].reduce((sum, value) => sum + value, 0)
  const fingerprints = new Set(devices.map((item) => item.accountFingerprint).filter(Boolean))
  const quota = selectAccountQuota(devices)

  return {
    deviceCount: devices.length,
    updatedAt: devices.map((item) => item.receivedAt).sort().at(-1),
    accountVerified: fingerprints.size === 1,
    periods,
    dailyUsage,
    officialDailyUsage: [...officialByDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-31),
    projects: aggregateProjects(devices),
    tools: aggregateTools(devices),
    skills: aggregateSkills(devices),
    quota,
    deduplication: { uniqueEvents: seenEvents.size, duplicateEvents },
    devices: [...devices].reverse().map((item) => {
      const total = deviceTotals.get(item.device.id) ?? 0
      const todayTokens = daily.get(today)?.devices[item.device.id] ?? 0
      const sevenDaysTokens = [...daily.values()]
        .filter((day) => sevenDayKeys.has(day.date))
        .reduce((sum, day) => sum + (day.devices[item.device.id] ?? 0), 0)
      return {
        ...item,
        contribution: {
          todayTokens,
          sevenDaysTokens,
          totalTokens: total,
          sharePercent: localTotal > 0 ? Math.round((total / localTotal) * 10_000) / 100 : 0
        }
      }
    })
  }
}

function periodFromDaily(daily: Map<string, AggregateDay>, dateKeys: Set<string>): UsagePeriod {
  const period = emptyPeriod()
  for (const day of daily.values()) {
    if (!dateKeys.has(day.date)) continue
    period.events += day.events
    addTotals(period.total, day.total)
  }
  return period
}

function latestByPhysicalDevice(input: StoredDeviceUsage[]): StoredDeviceUsage[] {
  const latest = new Map<string, StoredDeviceUsage>()
  for (const item of [...input].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))) {
    latest.set(physicalDeviceKey(item), item)
  }
  return [...latest.values()].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
}

function physicalDeviceKey(item: StoredDeviceUsage): string {
  return item.device.stableKey ?? item.device.id
}

export function normalizeDeviceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || Array.from(name).length > 32 || /[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

function selectAccountQuota(devices: StoredDeviceUsage[]): StoredQuota | undefined {
  const quotas = devices
    .map((item) => item.quota)
    .filter((quota): quota is StoredQuota => Boolean(quota))
    .sort((a, b) => Date.parse(a.refreshedAt) - Date.parse(b.refreshedAt))
  const available = quotas.filter((quota) => quota.available && quota.windows.length > 0)
  return available.at(-1) ?? quotas.at(-1)
}

function addDaily(daily: Map<string, AggregateDay>, source: DailyUsage, deviceId: string): void {
  const current: AggregateDay = daily.get(source.date) ?? {
    date: source.date,
    events: 0,
    total: emptyTotals(),
    devices: {},
    projects: new Map<string, CloudDailyProject>()
  }
  current.events += source.events
  addTotals(current.total, source.total)
  current.devices[deviceId] = (current.devices[deviceId] ?? 0) + source.total.totalTokens
  for (const sourceProject of source.projects) {
    const project = current.projects.get(sourceProject.name) ?? { name: sourceProject.name, events: 0, ...emptyTotals() }
    project.events += sourceProject.events
    addTotals(project, sourceProject)
    current.projects.set(project.name, project)
  }
  daily.set(source.date, current)
}

function subtractDuplicate(
  daily: Map<string, AggregateDay>,
  periods: Record<'today' | 'sevenDays' | 'month', UsagePeriod>,
  event: StoredDeviceUsage['syncEvents'][number],
  duplicateDeviceId: string,
  now: Date
): void {
  const day = daily.get(event.date)
  if (day) {
    day.events = Math.max(0, day.events - 1)
    subtractTotals(day.total, event.total)
    day.devices[duplicateDeviceId] = Math.max(0, (day.devices[duplicateDeviceId] ?? 0) - event.total.totalTokens)
    if (event.projectName) {
      const project = day.projects.get(event.projectName)
      if (project) {
        project.events = Math.max(0, project.events - 1)
        subtractTotals(project, event.total)
      }
    }
  }
  const today = shanghaiDateKey(now)
  const sevenStart = shanghaiDateKey(new Date(now.getTime() - 6 * 86_400_000))
  const monthStart = today.slice(0, 8) + '01'
  if (event.date === today) subtractPeriod(periods.today, event.total)
  if (event.date >= sevenStart && event.date <= today) subtractPeriod(periods.sevenDays, event.total)
  if (event.date >= monthStart && event.date <= today) subtractPeriod(periods.month, event.total)
}

function addPeriod(target: UsagePeriod, source: UsagePeriod): void {
  target.events += source.events
  target.userMessages += source.userMessages
  target.toolCalls += source.toolCalls
  target.apiEstimateUsd += source.apiEstimateUsd
  addTotals(target.total, source.total)
}

function subtractPeriod(target: UsagePeriod, total: TokenTotals): void {
  target.events = Math.max(0, target.events - 1)
  subtractTotals(target.total, total)
}

function aggregateProjects(devices: StoredDeviceUsage[]): CloudProject[] {
  const output = new Map<string, CloudProject>()
  for (const item of devices) {
    for (const source of item.analytics?.projects ?? []) {
      const current = output.get(source.name) ?? { name: source.name, sessions: 0, lastActive: source.lastActive, ...emptyTotals() }
      current.sessions += source.sessions
      if (Date.parse(source.lastActive) > Date.parse(current.lastActive)) current.lastActive = source.lastActive
      addTotals(current, source)
      output.set(source.name, current)
    }
  }
  return [...output.values()].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 8)
}

function aggregateTools(devices: StoredDeviceUsage[]) {
  const output = new Map<string, { name: string; calls: number; outputChars: number }>()
  for (const item of devices) {
    for (const source of item.analytics?.tools ?? []) {
      const current = output.get(source.name) ?? { name: source.name, calls: 0, outputChars: 0 }
      current.calls += source.calls
      current.outputChars += source.outputChars
      output.set(source.name, current)
    }
  }
  return [...output.values()].sort((a, b) => b.outputChars + b.calls * 500 - (a.outputChars + a.calls * 500)).slice(0, 8)
}

function aggregateSkills(devices: StoredDeviceUsage[]) {
  const output = new Map<string, { name: string; hits: number }>()
  for (const item of devices) {
    for (const source of item.analytics?.skills ?? []) {
      const current = output.get(source.name) ?? { name: source.name, hits: 0 }
      current.hits += source.hits
      output.set(source.name, current)
    }
  }
  return [...output.values()].sort((a, b) => b.hits - a.hits).slice(0, 8)
}

function parsePeriod(value: unknown): UsagePeriod | null {
  const item = record(value)
  const total = parseTotals(item?.total)
  if (!item || !total) return null
  return {
    events: bounded(item.events, 0, 100_000_000),
    userMessages: bounded(item.userMessages, 0, 100_000_000),
    toolCalls: bounded(item.toolCalls, 0, 100_000_000),
    total,
    apiEstimateUsd: bounded(item.apiEstimateUsd, 0, 1_000_000_000)
  }
}

function parseDailyUsage(value: unknown): DailyUsage | null {
  const item = record(value)
  const total = parseTotals(item?.total)
  if (!item || !dateKey(item.date) || !total) return null
  const projects = Array.isArray(item.projects)
    ? item.projects.map(parseDailyProject).filter((project): project is CloudDailyProject => Boolean(project)).slice(0, 8)
    : []
  return {
    date: String(item.date),
    events: bounded(item.events, 0, 100_000_000),
    total,
    apiEstimateUsd: bounded(item.apiEstimateUsd, 0, 1_000_000_000),
    projects
  }
}

function parseDailyProject(value: unknown): CloudDailyProject | null {
  const item = record(value)
  const total = parseTotals(item)
  if (!item || !safeText(item.name, 120) || !total) return null
  return { name: String(item.name), events: bounded(item.events, 0, 100_000_000), ...total }
}

function parseSyncEvent(value: unknown): StoredDeviceUsage['syncEvents'][number] | null {
  const item = record(value)
  const total = parseTotals(item?.total)
  if (!item || !safeFingerprint(item.id) || !dateKey(item.date) || !total) return null
  return {
    id: String(item.id),
    date: String(item.date),
    projectName: safeText(item.projectName, 120) ? String(item.projectName) : undefined,
    total
  }
}

function parseAnalytics(value: unknown): StoredDeviceUsage['analytics'] | undefined {
  const item = record(value)
  if (!item) return undefined
  const projects = Array.isArray(item.projects)
    ? item.projects.map((value) => {
      const project = record(value)
      const total = parseTotals(project)
      return project && total && safeText(project.name, 120) && isoDate(project.lastActive)
        ? { name: String(project.name), sessions: bounded(project.sessions, 0, 1_000_000), lastActive: String(project.lastActive), ...total }
        : null
    }).filter((project): project is CloudProject => Boolean(project)).slice(0, 8)
    : []
  const tools = Array.isArray(item.tools)
    ? item.tools.map((value) => {
      const tool = record(value)
      return tool && safeText(tool.name, 120)
        ? { name: String(tool.name), calls: bounded(tool.calls, 0, 100_000_000), outputChars: bounded(tool.outputChars, 0, Number.MAX_SAFE_INTEGER) }
        : null
    }).filter((tool): tool is { name: string; calls: number; outputChars: number } => Boolean(tool)).slice(0, 8)
    : []
  const skills = Array.isArray(item.skills)
    ? item.skills.map((value) => {
      const skill = record(value)
      return skill && safeText(skill.name, 120) ? { name: String(skill.name), hits: bounded(skill.hits, 0, 100_000_000) } : null
    }).filter((skill): skill is { name: string; hits: number } => Boolean(skill)).slice(0, 8)
    : []
  return { projects, tools, skills }
}

function parseOfficialUsage(value: unknown): StoredDeviceUsage['officialUsage'] | undefined {
  const item = record(value)
  if (!item || typeof item.available !== 'boolean' || !isoDate(item.fetchedAt)) return undefined
  const dailyUsage = Array.isArray(item.dailyUsage)
    ? item.dailyUsage.map((value) => {
      const day = record(value)
      return day && dateKey(day.date) ? { date: String(day.date), tokens: bounded(day.tokens, 0, Number.MAX_SAFE_INTEGER) } : null
    }).filter((day): day is { date: string; tokens: number } => Boolean(day)).slice(-31)
    : []
  return { available: item.available, fetchedAt: String(item.fetchedAt), dailyUsage }
}

function parseQuota(value: unknown): StoredQuota | undefined {
  const item = record(value)
  if (!item || typeof item.available !== 'boolean' || !isoDate(item.refreshedAt)) return undefined
  const source = item.source === 'codex' || item.source === 'sample' || item.source === 'unavailable' ? item.source : 'unavailable'
  const windows: StoredQuota['windows'] = []
  for (const value of Array.isArray(item.windows) ? item.windows : []) {
    const window = record(value)
    if (!window || (window.code !== '5h' && window.code !== '7d')) continue
    windows.push({
      code: window.code,
      percentUsed: bounded(window.percentUsed, 0, 100),
      ...(isoDate(window.resetAt) ? { resetAt: String(window.resetAt) } : {})
    })
    if (windows.length === 2) break
  }
  const resetCards = Array.isArray(item.resetCards)
    ? item.resetCards.map((value) => {
      const card = record(value)
      return card && isoDate(card.expiresAt) ? { expiresAt: String(card.expiresAt) } : null
    }).filter((card): card is { expiresAt: string } => Boolean(card)).slice(0, 8)
    : []
  return {
    available: item.available,
    refreshedAt: String(item.refreshedAt),
    source,
    planType: safeText(item.planType, 32) ? String(item.planType) : undefined,
    windows,
    resetCards
  }
}

function parseTotals(value: unknown): TokenTotals | null {
  const item = record(value)
  if (!item) return null
  return {
    inputTokens: bounded(item.inputTokens, 0, Number.MAX_SAFE_INTEGER),
    cachedInputTokens: bounded(item.cachedInputTokens, 0, Number.MAX_SAFE_INTEGER),
    outputTokens: bounded(item.outputTokens, 0, Number.MAX_SAFE_INTEGER),
    reasoningOutputTokens: bounded(item.reasoningOutputTokens, 0, Number.MAX_SAFE_INTEGER),
    totalTokens: bounded(item.totalTokens, 0, Number.MAX_SAFE_INTEGER)
  }
}

function addTotals(target: TokenTotals, source: TokenTotals): void {
  target.inputTokens += source.inputTokens
  target.cachedInputTokens += source.cachedInputTokens
  target.outputTokens += source.outputTokens
  target.reasoningOutputTokens += source.reasoningOutputTokens
  target.totalTokens += source.totalTokens
}

function subtractTotals(target: TokenTotals, source: TokenTotals): void {
  target.inputTokens = Math.max(0, target.inputTokens - source.inputTokens)
  target.cachedInputTokens = Math.max(0, target.cachedInputTokens - source.cachedInputTokens)
  target.outputTokens = Math.max(0, target.outputTokens - source.outputTokens)
  target.reasoningOutputTokens = Math.max(0, target.reasoningOutputTokens - source.reasoningOutputTokens)
  target.totalTokens = Math.max(0, target.totalTokens - source.totalTokens)
}

function estimateApiValue(total: TokenTotals): number {
  const uncachedInput = Math.max(0, total.inputTokens - total.cachedInputTokens)
  const value = (uncachedInput * 1.75 + total.cachedInputTokens * 0.175 + total.outputTokens * 14) / 1_000_000
  return Math.round(value * 10_000) / 10_000
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function bounded(value: unknown, min: number, max: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min
}

function safeId(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value)
}

function safeFingerprint(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,100}$/.test(value)
}

function safeText(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

function isoDate(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function dateKey(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value))
}

function shanghaiDateKey(date: Date): string {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
