export interface StoredDeviceUsage {
  schemaVersion: 1 | 2
  receivedAt: string
  generatedAt: string
  accountFingerprint?: string
  device: { id: string; name: string; platform: string; arch?: string; appVersion?: string; createdAt: string }
  periods: Record<'today' | 'sevenDays' | 'month', UsagePeriod>
  dailyUsage: DailyUsage[]
  officialUsage?: { available: boolean; fetchedAt: string; dailyUsage: Array<{ date: string; tokens: number }> }
  syncEvents: Array<{ id: string; date: string; total: TokenTotals }>
  dataQuality: { score: number; level: string; files: number; tokenEvents: number }
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
}

interface TokenTotals {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export function parseDeviceUsage(value: unknown, receivedAt: string): StoredDeviceUsage | null {
  const root = record(value)
  const device = record(root?.device)
  const periods = record(root?.periods)
  const quality = record(root?.dataQuality)
  if ((root?.schemaVersion !== 1 && root?.schemaVersion !== 2) || !device || !periods || !quality) return null
  if (!safeId(device.id) || !safeText(device.name, 120) || !safeText(device.platform, 32)) return null
  if (!isoDate(device.createdAt) || !isoDate(root.generatedAt)) return null

  const today = parsePeriod(periods.today)
  const sevenDays = parsePeriod(periods.sevenDays)
  const month = parsePeriod(periods.month)
  const daily = Array.isArray(root.dailyUsage)
    ? root.dailyUsage.map(parseDailyUsage).filter((item): item is DailyUsage => Boolean(item)).slice(-31)
    : []
  if (!today || !sevenDays || !month || daily.length > 31) return null

  const syncEvents = root.schemaVersion === 2 && Array.isArray(root.syncEvents)
    ? root.syncEvents.map(parseSyncEvent).filter((item): item is StoredDeviceUsage['syncEvents'][number] => Boolean(item)).slice(-100_000)
    : []
  const officialUsage = root.schemaVersion === 2 ? parseOfficialUsage(root.officialUsage) : undefined
  const accountFingerprint = safeFingerprint(root.accountFingerprint) ? String(root.accountFingerprint) : undefined

  return {
    schemaVersion: root.schemaVersion,
    receivedAt,
    generatedAt: String(root.generatedAt),
    accountFingerprint,
    device: {
      id: String(device.id),
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
    dataQuality: {
      score: bounded(quality.score, 0, 100),
      level: safeText(quality.level, 16) ? String(quality.level) : 'unknown',
      files: bounded(quality.files, 0, 1_000_000),
      tokenEvents: bounded(quality.tokenEvents, 0, 100_000_000)
    }
  }
}

export function aggregateDevices(input: StoredDeviceUsage[], now = new Date()) {
  const devices = [...input].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
  const daily = new Map<string, { date: string; totalTokens: number; devices: Record<string, number> }>()
  const deviceTotals = new Map<string, number>()
  const seenEvents = new Set<string>()
  let duplicateEvents = 0

  for (const item of devices) {
    if (item.syncEvents.length) {
      for (const event of item.syncEvents) {
        if (seenEvents.has(event.id)) {
          duplicateEvents += 1
          continue
        }
        seenEvents.add(event.id)
        addDaily(daily, event.date, item.device.id, event.total.totalTokens)
        deviceTotals.set(item.device.id, (deviceTotals.get(item.device.id) ?? 0) + event.total.totalTokens)
      }
      continue
    }
    for (const day of item.dailyUsage) {
      addDaily(daily, day.date, item.device.id, day.total.totalTokens)
      deviceTotals.set(item.device.id, (deviceTotals.get(item.device.id) ?? 0) + day.total.totalTokens)
    }
  }

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

  const dailyUsage = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-31)
  const localTotal = [...deviceTotals.values()].reduce((sum, value) => sum + value, 0)
  const today = shanghaiDateKey(now)
  const sevenDayKeys = new Set(Array.from({ length: 7 }, (_, index) => shanghaiDateKey(new Date(now.getTime() - index * 86_400_000))))
  const fingerprints = new Set(devices.map((item) => item.accountFingerprint).filter(Boolean))

  return {
    deviceCount: devices.length,
    updatedAt: devices.map((item) => item.receivedAt).sort().at(-1),
    accountVerified: fingerprints.size === 1,
    dailyUsage,
    officialDailyUsage: [...officialByDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-31),
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

function addDaily(
  daily: Map<string, { date: string; totalTokens: number; devices: Record<string, number> }>,
  date: string,
  deviceId: string,
  tokens: number
): void {
  const current = daily.get(date) ?? { date, totalTokens: 0, devices: {} }
  current.totalTokens += tokens
  current.devices[deviceId] = (current.devices[deviceId] ?? 0) + tokens
  daily.set(date, current)
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
  return { date: String(item.date), events: bounded(item.events, 0, 100_000_000), total, apiEstimateUsd: bounded(item.apiEstimateUsd, 0, 1_000_000_000) }
}

function parseSyncEvent(value: unknown): StoredDeviceUsage['syncEvents'][number] | null {
  const item = record(value)
  const total = parseTotals(item?.total)
  if (!item || !safeFingerprint(item.id) || !dateKey(item.date) || !total) return null
  return { id: String(item.id), date: String(item.date), total }
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
