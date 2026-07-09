<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NConfigProvider, NInput, NSwitch, type GlobalThemeOverrides } from 'naive-ui'
import {
  AlertCircle,
  Bluetooth,
  Calendar,
  CheckCircle2,
  Clock,
  Link2,
  Minus,
  Monitor,
  Pin,
  RefreshCw,
  Ticket,
  Wifi,
  X
} from 'lucide-vue-next'
import appIcon from './assets/icon.png'
import { buildBleUsagePayload } from '../shared/device'
import { sampleQuotaSnapshot, type QuotaSnapshot, type QuotaWindow, type ResetCard } from '../shared/quota'
import type { AppSettings, RefreshIntervalMinutes } from '../shared/settings'
import type { CodexUsageSummary, UsagePeriodSummary, UsageTokenTotals } from '../shared/usageAnalytics'

const BLE_SERVICE_UUID = '6f4d0001-9c8f-4c2a-9f12-000000000001'
const BLE_USAGE_UUID = '6f4d0002-9c8f-4c2a-9f12-000000000002'

const isWidgetView = new URLSearchParams(window.location.search).get('view') === 'widget'
const snapshot = ref<QuotaSnapshot | null>(null)
const settings = ref<AppSettings | null>(null)
const loading = ref(false)
const usageLoading = ref(false)
const status = ref('就绪')
const activeDashboardView = ref<'quota' | 'usage'>('quota')
const usageSummary = ref<CodexUsageSummary | null>(null)
const widgetVisible = ref(false)
const widgetExpanded = ref(false)
const alwaysOnTop = ref(false)
const hardwareEndpointInput = ref('')
const hardwareSaving = ref(false)
const hardwareStatusText = ref('')
const hardwareConnectionState = ref<'未连接' | '连接中' | '已连接' | '连接失败' | '推送成功' | '推送失败'>('未连接')
const hardwareAutoSync = ref(true)
const hardwareLastPushedAt = ref<string | undefined>()
const hardwareDialogVisible = ref(false)
const bleConnected = ref(false)
const bleDeviceName = ref('')
let bleCharacteristic: BluetoothRemoteGATTCharacteristic | undefined
const oauthConnected = ref(false)
const oauthEmail = ref<string | undefined>()
const connecting = ref(false)
const noticeVisible = ref(false)
const noticeText = ref('')
const aboutVisible = ref(false)
let unsubscribeQuota: (() => void) | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let widgetHoverOpenTimer: number | undefined
let widgetHoverCloseTimer: number | undefined
let widgetOrbClickTimer: number | undefined
let widgetExpansionRequestId = 0
let removeCopyListener: (() => void) | undefined
let unsubscribeHardwarePush: (() => void) | undefined

const intervalOptions = [
  { label: '手动刷新', value: 0 },
  { label: '5 分钟', value: 5 },
  { label: '10 分钟', value: 10 }
]
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#2563eb',
    primaryColorHover: '#1d4ed8',
    primaryColorPressed: '#1e40af',
    primaryColorSuppl: '#3b82f6'
  },
  Button: {
    borderRadiusLarge: '12px'
  }
}

const fiveHourWindow = computed(() => findWindow('5h'))
const sevenDayWindow = computed(() => findWindow('7d'))
const resetCards = computed<ResetCard[]>(() => snapshot.value?.resetCards ?? [])
const codexPlanLabel = computed(() => {
  const planType = formattedPlanType.value
  if (!planType) {
    return 'Codex OAuth'
  }

  return `Codex ${planType}`
})
const formattedPlanType = computed(() => formatPlanType(snapshot.value?.planType))

function resetCardExpiryText(card: ResetCard): string {
  const date = new Date(card.expiresAt)
  if (Number.isNaN(date.getTime())) {
    return '未知'
  }
  const now = Date.now()
  const daysLeft = Math.ceil((date.getTime() - now) / (1000 * 60 * 60 * 24))
  const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
  if (daysLeft <= 0) {
    return `已过期 · ${dateStr}`
  }
  return `剩余 ${daysLeft} 天 · ${dateStr}`
}

function resetCardCompactExpiryText(card: ResetCard): string {
  const date = new Date(card.expiresAt)
  if (Number.isNaN(date.getTime())) {
    return '未知'
  }
  const now = Date.now()
  const daysLeft = Math.ceil((date.getTime() - now) / (1000 * 60 * 60 * 24))
  const dateStr = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
  if (daysLeft <= 0) {
    return `已过期 · ${dateStr}`
  }
  return `剩余 ${daysLeft} 天 · ${dateStr}`
}
const systemState = computed<'connected' | 'disconnected' | 'error'>(() => {
  if (snapshot.value && !snapshot.value.available && oauthConnected.value) {
    return 'error'
  }

  return oauthConnected.value ? 'connected' : 'disconnected'
})
const systemStateLabel = computed(() => {
  if (systemState.value === 'error') {
    return '异常'
  }

  return systemState.value === 'connected' ? '已连接' : '未连接'
})
const refreshTime = computed(() => {
  if (!snapshot.value) {
    return '--:--:--'
  }

  return new Date(snapshot.value.refreshedAt).toLocaleTimeString()
})
const refreshSummary = computed(() => {
  if (!snapshot.value) {
    return '尚未刷新'
  }

  return `上次刷新 ${refreshTime.value}`
})
const fiveHourState = computed(() => quotaState(fiveHourWindow.value))
const sevenDayState = computed(() => quotaState(sevenDayWindow.value))
const httpConnected = computed(() => Boolean(settings.value?.hardwareEndpoint))
const hardwareConnected = computed(() => bleConnected.value || httpConnected.value)
const hardwareStatusTone = computed(() => {
  if (hardwareConnectionState.value === '连接失败' || hardwareConnectionState.value === '推送失败') {
    return 'is-error'
  }

  if (hardwareConnectionState.value === '连接中') {
    return 'is-pending'
  }

  if (hardwareConnectionState.value === '已连接' || hardwareConnectionState.value === '推送成功') {
    return 'is-success'
  }

  return 'is-idle'
})
const hardwareLastPushLabel = computed(() => {
  if (!hardwareLastPushedAt.value) {
    return '--'
  }

  const date = new Date(hardwareLastPushedAt.value)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return date.toLocaleTimeString()
})
const bleDisplayName = computed(() => bleConnected.value ? bleDeviceName.value || 'CodexMeter' : '未连接')
const httpDisplayAddress = computed(() => {
  if (!settings.value?.hardwareEndpoint) {
    return '未配置'
  }

  return settings.value.hardwareEndpoint.replace(/^https?:\/\//, '').replace(/\/$/, '')
})
const hardwareConnectionSummary = computed(() => {
  if (bleConnected.value && httpConnected.value) {
    return '蓝牙 + 网络'
  }
  if (bleConnected.value) {
    return '蓝牙已连接'
  }
  if (httpConnected.value) {
    return '网络已配置'
  }
  return '未连接'
})
const usagePeriods = computed(() => {
  const summary = usageSummary.value
  if (!summary) {
    return []
  }

  return [
    { key: 'today', label: '今日', period: summary.periods.today },
    { key: 'sevenDays', label: '7 日', period: summary.periods.sevenDays },
    { key: 'month', label: '本月', period: summary.periods.month }
  ]
})
const currentUsagePeriod = computed(() => usageSummary.value?.periods.month ?? emptyUsagePeriod())
const usageSplitItems = computed(() => {
  const total = currentUsagePeriod.value.total
  return [
    { label: 'Input', value: total.inputTokens, tone: 'input' },
    { label: 'Cached', value: total.cachedInputTokens, tone: 'cached' },
    { label: 'Output', value: total.outputTokens, tone: 'output' }
  ]
})
const topUsageTools = computed(() => usageSummary.value?.tools.slice(0, 2) ?? [])
const topUsageSkills = computed(() => usageSummary.value?.skills.slice(0, 1) ?? [])
const topUsageProjects = computed(() => usageSummary.value?.projects.slice(0, 3) ?? [])
const todayUsageTasks = computed(() => usageSummary.value?.tasks.slice(0, 2) ?? [])

onMounted(async () => {
  const handleCopy = () => showNotice('已复制到剪贴板')
  document.addEventListener('copy', handleCopy)
  removeCopyListener = () => document.removeEventListener('copy', handleCopy)

  unsubscribeQuota = window.codexMeter?.onQuotaUpdated((nextSnapshot) => {
    snapshot.value = nextSnapshot
    status.value = `已刷新 ${new Date(nextSnapshot.refreshedAt).toLocaleTimeString()}`
    if (hardwareAutoSync.value && bleConnected.value) {
      void sendBleSnapshot(nextSnapshot)
    }
  })
  unsubscribeHardwarePush = window.codexMeter?.onHardwarePushUpdated((pushedAt) => {
    hardwareLastPushedAt.value = pushedAt
    hardwareConnectionState.value = '推送成功'
  })

  if (isWidgetView) {
    snapshot.value = window.codexMeter ? await window.codexMeter.getLatestQuota() : sampleQuotaSnapshot()
    widgetExpanded.value = false
    void window.codexMeter?.setWidgetExpanded(false)
    return
  }

  if (window.codexMeter) {
    settings.value = await window.codexMeter.getSettings()
    hardwareEndpointInput.value = settings.value.hardwareEndpoint ?? ''
    hardwareAutoSync.value = settings.value.hardwareDisplayEnabled
    hardwareConnectionState.value = settings.value.hardwareEndpoint ? '已连接' : '未连接'
    const oauth = await window.codexMeter.getOAuthStatus()
    oauthConnected.value = oauth.connected
    oauthEmail.value = oauth.email
    const widgetState = await window.codexMeter.getWidgetState()
    widgetVisible.value = widgetState.visible
    alwaysOnTop.value = widgetState.visible ? widgetState.alwaysOnTop : false
    widgetExpanded.value = widgetState.expanded
  } else {
    settings.value = { refreshIntervalMinutes: 5, hardwareDisplayEnabled: true }
    hardwareAutoSync.value = true
  }

  await refreshQuota()
  await refreshUsageSummary()
  configureAutoRefresh(settings.value?.refreshIntervalMinutes ?? 5)
})

onUnmounted(() => {
  unsubscribeQuota?.()
  unsubscribeHardwarePush?.()
  removeCopyListener?.()
  clearAutoRefresh()
  clearNotice()
  clearWidgetHoverTimers()
  clearWidgetOrbClickTimer()
})

async function refreshQuota(): Promise<void> {
  if (loading.value) {
    return
  }

  loading.value = true
  status.value = '刷新中'
  try {
    snapshot.value = window.codexMeter ? await window.codexMeter.refreshQuota() : sampleQuotaSnapshot()
    status.value = `已刷新 ${new Date(snapshot.value.refreshedAt).toLocaleTimeString()}`
  } finally {
    loading.value = false
  }
}

async function refreshDashboardData(): Promise<void> {
  await refreshQuota()
  await refreshUsageSummary()
}

async function refreshUsageSummary(): Promise<void> {
  usageLoading.value = true
  try {
    usageSummary.value = window.codexMeter ? await window.codexMeter.getUsageSummary() : null
  } finally {
    usageLoading.value = false
  }
}

function showNotice(text: string): void {
  clearNotice()
  noticeText.value = text
  noticeVisible.value = true
  noticeTimer = setTimeout(() => {
    noticeVisible.value = false
    noticeTimer = undefined
  }, 2000)
}

function clearNotice(): void {
  if (noticeTimer) {
    clearTimeout(noticeTimer)
    noticeTimer = undefined
  }
}

function showAbout(): void {
  aboutVisible.value = true
}

function openHardwareDialog(): void {
  hardwareEndpointInput.value = settings.value?.hardwareEndpoint ?? hardwareEndpointInput.value
  hardwareAutoSync.value = settings.value?.hardwareEndpoint ? settings.value.hardwareDisplayEnabled : true
  hardwareDialogVisible.value = true
  hardwareConnectionState.value = hardwareConnected.value ? '已连接' : '未连接'
  hardwareStatusText.value = ''
}

async function updateInterval(value: number): Promise<void> {
  settings.value = window.codexMeter
    ? await window.codexMeter.saveRefreshInterval(value as RefreshIntervalMinutes)
    : { refreshIntervalMinutes: value as RefreshIntervalMinutes, hardwareDisplayEnabled: true }
  configureAutoRefresh(settings.value.refreshIntervalMinutes)
}

async function saveHardwareDisplay(enabled = true): Promise<void> {
  hardwareSaving.value = true
  try {
    settings.value = window.codexMeter
      ? await window.codexMeter.saveHardwareDisplay(enabled, hardwareEndpointInput.value)
      : {
          refreshIntervalMinutes: settings.value?.refreshIntervalMinutes ?? 5,
          hardwareDisplayEnabled: Boolean(enabled && hardwareEndpointInput.value),
          hardwareEndpoint: hardwareEndpointInput.value
        }
    hardwareEndpointInput.value = settings.value.hardwareEndpoint ?? hardwareEndpointInput.value.trim()
    hardwareAutoSync.value = settings.value.hardwareDisplayEnabled
    hardwareConnectionState.value = settings.value.hardwareEndpoint ? '已连接' : '未连接'
    hardwareStatusText.value = settings.value.hardwareDisplayEnabled ? '刷新额度后会自动推送到小屏' : '自动同步已关闭'
    showNotice(hardwareStatusText.value)
    if (!settings.value.hardwareEndpoint) {
      hardwareDialogVisible.value = false
    }
  } catch (error) {
    hardwareConnectionState.value = '连接失败'
    hardwareStatusText.value = error instanceof Error ? error.message : '硬件设置保存失败'
  } finally {
    hardwareSaving.value = false
  }
}

async function disconnectHardwareDisplay(): Promise<void> {
  bleCharacteristic = undefined
  bleConnected.value = false
  bleDeviceName.value = ''
  hardwareEndpointInput.value = ''
  await saveHardwareDisplay(false)
  hardwareConnectionState.value = '未连接'
  hardwareStatusText.value = '已断开所有小屏连接'
  showNotice(hardwareStatusText.value)
}

async function connectHttpDisplay(): Promise<void> {
  if (!window.codexMeter) {
    hardwareConnectionState.value = '连接失败'
    hardwareStatusText.value = '当前环境无法连接网络小屏'
    return
  }

  hardwareSaving.value = true
  hardwareConnectionState.value = '连接中'
  hardwareStatusText.value = '正在连接网络小屏...'
  try {
    await window.codexMeter.pingHardwareDisplay(hardwareEndpointInput.value)
    settings.value = await window.codexMeter.saveHardwareDisplay(hardwareAutoSync.value, hardwareEndpointInput.value)
    hardwareEndpointInput.value = settings.value.hardwareEndpoint ?? hardwareEndpointInput.value.trim()
    hardwareAutoSync.value = settings.value.hardwareDisplayEnabled
    hardwareConnectionState.value = '已连接'
    hardwareStatusText.value = '网络小屏已连接'
    const result = await window.codexMeter.pushLatestToDevice()
    hardwareLastPushedAt.value = result.pushedAt
    hardwareConnectionState.value = '推送成功'
    hardwareStatusText.value = '当前额度已同步到小屏'
    showNotice(hardwareStatusText.value)
  } catch {
    hardwareConnectionState.value = '连接失败'
    hardwareStatusText.value = '无法连接网络小屏，请确认 ESP32-C3 已连接 Wi-Fi，且电脑与设备在同一局域网。'
  } finally {
    hardwareSaving.value = false
  }
}

async function connectBluetoothDisplay(pushAfterConnect: boolean): Promise<void> {
  if (!navigator.bluetooth) {
    hardwareConnectionState.value = '连接失败'
    hardwareStatusText.value = '当前环境不支持蓝牙连接'
    return
  }

  hardwareSaving.value = true
  hardwareConnectionState.value = '连接中'
  hardwareStatusText.value = '正在连接蓝牙小屏...'
  try {
    const characteristic = await requestBleCharacteristic()
    bleCharacteristic = characteristic
    bleConnected.value = true
    hardwareConnectionState.value = '已连接'
    hardwareStatusText.value = '蓝牙小屏已连接'

    if (pushAfterConnect) {
      const currentSnapshot = snapshot.value ?? (window.codexMeter ? await window.codexMeter.getLatestQuota() : sampleQuotaSnapshot())
      await sendBleSnapshot(currentSnapshot)
      hardwareDialogVisible.value = false
    }

    showNotice(hardwareStatusText.value)
  } catch {
    bleCharacteristic = undefined
    bleConnected.value = false
    hardwareConnectionState.value = '连接失败'
    hardwareStatusText.value = '无法连接蓝牙小屏，请确认设备已上电并处于附近。'
  } finally {
    hardwareSaving.value = false
  }
}

async function requestBleCharacteristic(): Promise<BluetoothRemoteGATTCharacteristic> {
  const device = await navigator.bluetooth!.requestDevice({
    acceptAllDevices: true,
    optionalServices: [BLE_SERVICE_UUID]
  })
  bleDeviceName.value = device.name ?? 'CodexMeter'
  device.addEventListener('gattserverdisconnected', () => {
    bleCharacteristic = undefined
    bleConnected.value = false
    hardwareConnectionState.value = '未连接'
    hardwareStatusText.value = '蓝牙已断开'
  })
  const server = await device.gatt?.connect()
  if (!server) {
    throw new Error('BLE GATT unavailable')
  }

  const service = await server.getPrimaryService(BLE_SERVICE_UUID)
  return service.getCharacteristic(BLE_USAGE_UUID)
}

async function sendBleSnapshot(nextSnapshot: QuotaSnapshot): Promise<void> {
  await sendBlePayload(buildBleUsagePayload(nextSnapshot), '当前额度已同步到小屏')
}

async function sendBlePayload(payload: unknown, successText: string): Promise<void> {
  if (!bleCharacteristic) {
    await connectBluetoothDisplay(false)
  }

  if (!bleCharacteristic) {
    return
  }

  hardwareSaving.value = true
  hardwareConnectionState.value = '连接中'
  hardwareStatusText.value = '正在发送数据...'
  try {
    await bleCharacteristic.writeValue(new TextEncoder().encode(JSON.stringify(payload)))
    hardwareLastPushedAt.value = new Date().toISOString()
    hardwareConnectionState.value = '推送成功'
    hardwareStatusText.value = successText
    showNotice(successText)
  } catch {
    hardwareConnectionState.value = '推送失败'
    hardwareStatusText.value = '蓝牙数据发送失败，请重新连接小屏。'
  } finally {
    hardwareSaving.value = false
  }
}

function configureAutoRefresh(minutes: RefreshIntervalMinutes): void {
  clearAutoRefresh()
  if (minutes === 0 || isWidgetView) {
    return
  }

  refreshTimer = setInterval(() => {
    void refreshQuota()
  }, minutes * 60 * 1000)
}

function clearAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }
}

async function connectOAuth(forceLogin = false): Promise<void> {
  if (!window.codexMeter || connecting.value) {
    return
  }

  connecting.value = true
  status.value = '等待授权'
  try {
    const result = await window.codexMeter.connectOAuth(forceLogin)
    oauthConnected.value = result.connected
    oauthEmail.value = result.email
    status.value = result.connected ? '已连接' : '连接失败'
    if (result.connected) {
      await refreshQuota()
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('cancelled')) {
      status.value = '已取消连接'
    } else {
      status.value = error instanceof Error && error.message.includes('timed out') ? '连接超时，可重试' : '连接失败'
    }
  } finally {
    connecting.value = false
  }
}

async function cancelOAuth(): Promise<void> {
  if (!window.codexMeter || !connecting.value) {
    return
  }

  await window.codexMeter.cancelOAuth()
  connecting.value = false
  status.value = '已取消连接'
}

async function disconnectOAuth(): Promise<void> {
  if (!window.codexMeter || connecting.value) {
    return
  }

  connecting.value = true
  try {
    const result = await window.codexMeter.disconnectOAuth()
    oauthConnected.value = result.connected
    oauthEmail.value = undefined
    snapshot.value = result.snapshot
    status.value = '已断开'
  } finally {
    connecting.value = false
  }
}

async function updateWidgetVisible(value: boolean): Promise<void> {
  widgetVisible.value = value
  if (!value) {
    alwaysOnTop.value = false
  }
  if (!window.codexMeter) {
    return
  }

  const state = await window.codexMeter.setWidgetVisible(value, value ? alwaysOnTop.value : false)
  widgetVisible.value = state.visible
  alwaysOnTop.value = state.alwaysOnTop
  widgetExpanded.value = state.expanded
}

async function updateAlwaysOnTop(value: boolean): Promise<void> {
  if (!widgetVisible.value) {
    alwaysOnTop.value = false
    return
  }

  alwaysOnTop.value = value
  if (!window.codexMeter) {
    return
  }

  const state = await window.codexMeter.setWidgetAlwaysOnTop(value)
  widgetVisible.value = state.visible
  alwaysOnTop.value = state.alwaysOnTop
  widgetExpanded.value = state.expanded
}

async function minimizeMainWindow(): Promise<void> {
  await window.codexMeter?.minimizeMainWindow()
}

async function closeMainWindow(): Promise<void> {
  await window.codexMeter?.closeMainWindow()
}

async function setWidgetExpanded(value: boolean): Promise<void> {
  const requestId = ++widgetExpansionRequestId
  if (!window.codexMeter) {
    widgetExpanded.value = value
    return
  }

  if (!value) {
    widgetExpanded.value = false
  }

  try {
    const state = await window.codexMeter.setWidgetExpanded(value)
    if (requestId === widgetExpansionRequestId) {
      widgetExpanded.value = state.expanded
    }
  } catch (error) {
    if (requestId === widgetExpansionRequestId) {
      widgetExpanded.value = false
    }
    console.error('Failed to resize CodexMeter widget:', error)
  }
}

function toggleWidgetExpanded(): void {
  void setWidgetExpanded(!widgetExpanded.value)
}

function clearWidgetHoverTimers(): void {
  if (widgetHoverOpenTimer) {
    clearTimeout(widgetHoverOpenTimer)
    widgetHoverOpenTimer = undefined
  }
  if (widgetHoverCloseTimer) {
    clearTimeout(widgetHoverCloseTimer)
    widgetHoverCloseTimer = undefined
  }
}

function clearWidgetOrbClickTimer(): void {
  if (widgetOrbClickTimer) {
    clearTimeout(widgetOrbClickTimer)
    widgetOrbClickTimer = undefined
  }
}

function scheduleWidgetHoverDetails(): void {
  clearWidgetHoverTimers()
  widgetHoverOpenTimer = window.setTimeout(() => {
    widgetHoverOpenTimer = undefined
    showWidgetDetails()
  }, 180)
}

function scheduleWidgetDetailsClose(): void {
  if (widgetHoverOpenTimer) {
    clearTimeout(widgetHoverOpenTimer)
    widgetHoverOpenTimer = undefined
  }
  if (widgetHoverCloseTimer) {
    clearTimeout(widgetHoverCloseTimer)
  }
  widgetHoverCloseTimer = window.setTimeout(() => {
    widgetHoverCloseTimer = undefined
    clearWidgetOrbClickTimer()
    void setWidgetExpanded(false)
  }, 650)
}

function handleWidgetOrbClick(): void {
  clearWidgetHoverTimers()
  if (widgetOrbClickTimer) {
    clearWidgetOrbClickTimer()
    void openMainFromWidget()
    return
  }

  widgetOrbClickTimer = window.setTimeout(() => {
    widgetOrbClickTimer = undefined
    showWidgetDetails()
  }, 220)
}

function showWidgetDetails(): void {
  void setWidgetExpanded(true)
}

async function openMainFromWidget(): Promise<void> {
  clearWidgetHoverTimers()
  clearWidgetOrbClickTimer()
  widgetExpanded.value = false
  try {
    await setWidgetExpanded(false)
    await window.codexMeter?.openMainWindow()
  } catch (error) {
    console.error('Failed to open CodexMeter main window from widget:', error)
  }
}

function findWindow(code: '5h' | '7d'): QuotaWindow | null {
  return snapshot.value?.windows.find((window) => window.code === code) ?? null
}

function formatPlanType(planType: string | undefined): string | undefined {
  const value = planType?.trim()
  if (!value) {
    return undefined
  }

  return value.charAt(0).toUpperCase() + value.slice(1)
}

function remainingPercent(window: QuotaWindow | null): number {
  if (!window) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round((100 - window.percentUsed) * 100) / 100))
}

function usedPercent(window: QuotaWindow | null): number {
  return window ? Math.round(window.percentUsed * 100) / 100 : 0
}

type QuotaState = 'empty' | 'abundant' | 'normal' | 'attention' | 'tight' | 'critical' | 'exhausted'

function quotaState(window: QuotaWindow | null): QuotaState {
  if (!window) {
    return 'empty'
  }

  const remaining = remainingPercent(window)
  if (remaining <= 0) {
    return 'exhausted'
  }

  const thresholds = window.code === '5h'
    ? [60, 30, 20, 10] // 5h: >60 abundant, 30-60 normal, 20-30 attention, 10-20 tight, 1-10 critical
    : [60, 40, 25, 10] // 7d: >60 abundant, 40-60 normal, 25-40 attention, 10-25 tight, 1-10 critical

  if (remaining > thresholds[0]) return 'abundant'
  if (remaining > thresholds[1]) return 'normal'
  if (remaining > thresholds[2]) return 'attention'
  if (remaining > thresholds[3]) return 'tight'
  return 'critical'
}

function quotaBadge(window: QuotaWindow | null): string {
  const labels: Record<QuotaState, string> = {
    empty: '无数据',
    abundant: '充足',
    normal: '正常',
    attention: '关注',
    tight: '紧张',
    critical: '预警',
    exhausted: '已耗尽'
  }
  return labels[quotaState(window)]
}



function quotaColor(window: QuotaWindow | null): string {
  const colors: Record<QuotaState, string> = {
    empty: '#94a3b8',
    abundant: '#22c55e',
    normal: '#16a34a',
    attention: '#eab308',
    tight: '#f97316',
    critical: '#ea580c',
    exhausted: '#ef4444'
  }
  return colors[quotaState(window)]
}

function quotaDialStyle(window: QuotaWindow | null, accent: string): Record<string, string> {
  return {
    '--quota-progress': `${remainingPercent(window)}%`,
    '--quota-accent': accent
  }
}

const widgetFiveRing = computed(() => remainingPercent(fiveHourWindow.value))
const widgetOrbStyle = computed(() => ({
  '--widget-five-ring': `${widgetFiveRing.value}%`,
  '--widget-orb-fill': `${widgetFiveRing.value}%`
}))
const widgetPeekDialStyle = computed(() => ({
  '--widget-five-ring': `${remainingPercent(fiveHourWindow.value)}%`,
  '--widget-week-ring': `${remainingPercent(sevenDayWindow.value)}%`
}))
const widgetPeekFiveStyle = computed(() => ({
  '--widget-peek-ring': `${remainingPercent(fiveHourWindow.value)}%`
}))
const widgetPeekWeeklyStyle = computed(() => ({
  '--widget-peek-ring': `${remainingPercent(sevenDayWindow.value)}%`
}))
const widgetOrbTone = computed(() => `is-${fiveHourState.value}`)
const widgetFiveUpdate = computed(() => widgetClockText(snapshot.value?.refreshedAt))
const widgetPeekFiveUpdate = computed(() => {
  const resetAt = widgetWindowResetClock(fiveHourWindow.value)
  return resetAt === '--' ? `更新 ${widgetFiveUpdate.value}` : `重置 ${resetAt} · 更新 ${widgetFiveUpdate.value}`
})
const widgetPeekWeeklyUpdate = computed(() => {
  const resetAt = widgetWindowResetDate(sevenDayWindow.value)
  return resetAt === '--' ? `更新 ${widgetFiveUpdate.value}` : `重置 ${resetAt} · 更新 ${widgetFiveUpdate.value}`
})
const widgetResetCardPeek = computed(() => {
  if (!resetCards.value.length) {
    return '重置卡 0'
  }

  return `重置卡 ${resetCards.value.length} · ${widgetResetCardShortDate(resetCards.value[0])}`
})

function widgetClockText(value: string | undefined): string {
  if (!value) {
    return '--:--'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--:--'
  }

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function widgetWindowResetClock(window: QuotaWindow | null): string {
  return widgetClockText(window?.resetAt)
}

function widgetWindowResetDate(window: QuotaWindow | null): string {
  if (!window?.resetAt) {
    return '--'
  }

  const date = new Date(window.resetAt)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function widgetResetCardShortDate(card: ResetCard): string {
  const date = new Date(card.expiresAt)
  if (Number.isNaN(date.getTime())) {
    return '未知'
  }

  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function quotaTagType(window: QuotaWindow | null): 'default' | 'error' | 'warning' | 'success' | 'info' {
  const types: Record<QuotaState, 'default' | 'error' | 'warning' | 'success' | 'info'> = {
    empty: 'default',
    abundant: 'success',
    normal: 'success',
    attention: 'warning',
    tight: 'warning',
    critical: 'error',
    exhausted: 'error'
  }
  return types[quotaState(window)]
}

function quotaIcon(window: QuotaWindow | null, weekly = false) {
  const state = quotaState(window)
  if (state === 'exhausted' || state === 'critical') {
    return AlertCircle
  }
  if (state === 'attention' || state === 'tight') {
    return AlertCircle
  }
  return weekly ? Calendar : Clock
}

function resetLabel(window: QuotaWindow | null): string {
  if (!window?.resetAt) {
    return '重置 未知'
  }

  const date = new Date(window.resetAt)
  if (Number.isNaN(date.getTime())) {
    return '重置 未知'
  }

  return window.code === '5h'
    ? `重置 ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : `重置 ${date.toLocaleDateString([], { month: '2-digit', day: '2-digit' })}`
}

function widgetResetDateTime(window: QuotaWindow | null): string {
  if (!window?.resetAt) {
    return '--'
  }

  const date = new Date(window.resetAt)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return `${date.toLocaleDateString([], { month: '2-digit', day: '2-digit' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function quotaPeriodDisplay(window: QuotaWindow | null): string {
  if (!window?.resetAt) {
    return '--'
  }

  const date = new Date(window.resetAt)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return window.code === '5h'
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : widgetResetDateTime(window)
}

function emptyUsagePeriod(): UsagePeriodSummary {
  return {
    events: 0,
    userMessages: 0,
    toolCalls: 0,
    total: emptyTokenTotals(),
    apiEstimateUsd: 0
  }
}

function emptyTokenTotals(): UsageTokenTotals {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0
  }
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  }
  return String(Math.round(value))
}

function formatUsd(value: number): string {
  if (value >= 100) {
    return `$${Math.round(value)}`
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`
  }
  return `$${value.toFixed(4)}`
}

function usageSplitStyle(value: number): Record<string, string> {
  const total = currentUsagePeriod.value.total
  const denominator = Math.max(1, total.inputTokens + total.outputTokens)
  const width = Math.max(4, Math.round((value / denominator) * 100))
  return { '--usage-split-width': `${Math.min(100, width)}%` }
}

function compactDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

</script>

<template>
  <NConfigProvider :theme-overrides="themeOverrides">
    <Transition name="notice">
      <div v-if="noticeVisible" class="app-notice">
        <CheckCircle2 :size="16" :stroke-width="2" />
        <span>{{ noticeText }}</span>
      </div>
    </Transition>

    <Transition name="notice">
      <div v-if="aboutVisible" class="about-popover">
        <div>
          <strong>CodexMeter</strong>
          <span>版本 v1.0.0</span>
        </div>
        <p>本地运行 · 不联网自动更新 · 仅读取授权后的用量数据</p>
        <button type="button" @click="aboutVisible = false">知道了</button>
      </div>
    </Transition>

    <Transition name="notice">
      <div v-if="hardwareDialogVisible" class="hardware-connect-backdrop" @click.self="hardwareDialogVisible = false">
        <section class="hardware-connect-popover">
          <div class="hardware-connect-head">
            <div>
              <strong>连接外部小屏</strong>
              <span>蓝牙和网络可同时启用，刷新额度后会按已连接通道推送到 ESP32-C3 OLED 小屏</span>
            </div>
            <button type="button" aria-label="关闭" @click="hardwareDialogVisible = false">×</button>
          </div>

          <div class="hardware-channel-list">
            <section class="hardware-channel">
              <div class="hardware-channel-icon">
                <Bluetooth :size="17" :stroke-width="2" />
              </div>
              <div class="hardware-channel-main">
                <div class="hardware-channel-title">
                  <strong>蓝牙连接</strong>
                  <span :class="bleConnected ? 'is-success' : 'is-idle'">{{ bleConnected ? '已连接' : '未连接' }}</span>
                </div>
                <p>{{ bleConnected ? bleDisplayName : '搜索 CodexMeter 屏幕' }}</p>
              </div>
              <NButton size="small" type="primary" ghost :loading="hardwareSaving" @click="connectBluetoothDisplay(true)">
                {{ bleConnected ? '重新连接' : '连接蓝牙' }}
              </NButton>
            </section>

            <section class="hardware-channel">
              <div class="hardware-channel-icon">
                <Monitor :size="17" :stroke-width="2" />
              </div>
              <div class="hardware-channel-main">
                <div class="hardware-channel-title">
                  <strong>网络连接</strong>
                  <span :class="httpConnected ? 'is-success' : 'is-idle'">{{ httpConnected ? '已配置' : '未配置' }}</span>
                </div>
                <p>{{ httpConnected ? httpDisplayAddress : '使用设备 IP 地址连接' }}</p>
              </div>
              <label class="hardware-connect-field">
                <span>设备地址</span>
                <div class="hardware-address-input">
                  <Wifi :size="14" :stroke-width="2" />
                  <NInput
                    v-model:value="hardwareEndpointInput"
                    size="small"
                    placeholder="192.168.1.114"
                    @keyup.enter="connectHttpDisplay"
                  />
                </div>
                <NButton size="small" type="primary" ghost :loading="hardwareSaving" @click="connectHttpDisplay">
                  连接网络
                </NButton>
              </label>
            </section>
          </div>

          <div class="hardware-control-panel">
            <div class="hardware-sync-row">
              <div>
                <strong>自动同步</strong>
                <span>刷新额度后自动推送到小屏</span>
              </div>
              <b>[{{ hardwareAutoSync ? '开启' : '关闭' }}]</b>
              <NSwitch v-model:value="hardwareAutoSync" size="small" />
            </div>
            <div class="hardware-connect-status" :class="hardwareStatusTone">
              <div class="hardware-status-icon">
                <span class="oauth-status-dot" />
              </div>
              <div class="hardware-status-copy">
                <strong>屏幕状态</strong>
                <em>{{ hardwareStatusText || hardwareConnectionSummary }}</em>
              </div>
              <b class="hardware-status-badge">{{ hardwareConnectionState }}</b>
            </div>
          </div>

          <div class="hardware-connect-actions">
            <NButton size="small" :loading="hardwareSaving" @click="hardwareDialogVisible = false">取消</NButton>
          </div>
        </section>
      </div>
    </Transition>

    <main v-if="isWidgetView" class="widget-shell" :class="widgetExpanded ? 'is-expanded' : 'is-collapsed'">
      <button
        v-if="!widgetExpanded"
        class="widget-orb"
        :class="widgetOrbTone"
        :style="widgetOrbStyle"
        type="button"
        aria-label="查看 CodexMeter 用量详情"
        @mouseenter="scheduleWidgetHoverDetails"
        @mouseleave="scheduleWidgetDetailsClose"
        @focus="scheduleWidgetHoverDetails"
        @click="handleWidgetOrbClick"
      >
        <span class="widget-orb-meter" aria-hidden="true">
          <span class="widget-orb-gauge" />
        </span>
        <span class="widget-orb-center">
          <strong class="widget-orb-value">{{ fiveHourWindow ? `${remainingPercent(fiveHourWindow)}%` : '--' }}</strong>
          <span class="widget-orb-label">5H</span>
        </span>
      </button>

      <section v-else class="widget-peek" @mouseenter="clearWidgetHoverTimers" @mouseleave="scheduleWidgetDetailsClose">
        <div class="widget-peek-card">
          <div class="widget-peek-visual">
            <div class="widget-peek-dual-ring" :style="widgetPeekDialStyle">
              <span class="widget-peek-ring is-weekly" :style="widgetPeekWeeklyStyle" aria-hidden="true">
                <span />
              </span>
              <span class="widget-peek-ring is-five-hour" :style="widgetPeekFiveStyle" aria-hidden="true">
                <span />
              </span>
              <div class="widget-peek-center">
                <span>
                  <small>5h</small>
                  <strong>{{ fiveHourWindow ? `${remainingPercent(fiveHourWindow)}%` : '--' }}</strong>
                </span>
                <span>
                  <small>7d</small>
                  <strong>{{ sevenDayWindow ? `${remainingPercent(sevenDayWindow)}%` : '--' }}</strong>
                </span>
                <em>剩余</em>
              </div>
            </div>
          </div>

          <div class="widget-peek-legend">
            <div class="widget-peek-row" :class="['five-hour', fiveHourState]">
              <span class="widget-peek-dot" aria-hidden="true" />
              <span class="widget-peek-copy">
                <strong>5h 重置</strong>
              </span>
              <b class="widget-peek-value">{{ widgetWindowResetClock(fiveHourWindow) }}</b>
            </div>

            <div class="widget-peek-row" :class="['weekly', sevenDayState]">
              <span class="widget-peek-dot" aria-hidden="true" />
              <span class="widget-peek-copy">
                <strong>7d 重置</strong>
              </span>
              <b class="widget-peek-value">{{ widgetWindowResetDate(sevenDayWindow) }} {{ widgetWindowResetClock(sevenDayWindow) }}</b>
            </div>
          </div>

          <div class="widget-peek-reset">
            <span>{{ widgetResetCardPeek }}</span>
            <button class="widget-peek-open" type="button" @click.stop="openMainFromWidget">打开</button>
          </div>
        </div>
      </section>
    </main>

    <main v-else class="desktop-shell">
      <section class="dashboard-panel">
        <header class="dashboard-header">
          <div class="dashboard-brand">
            <img class="dashboard-logo" :src="appIcon" alt="" />
            <div>
              <h1>CodexMeter</h1>
              <p>上次刷新 {{ refreshTime }}</p>
            </div>
          </div>
          <div class="dashboard-actions">
            <button
              class="plan-badge"
              type="button"
              :title="oauthConnected ? oauthEmail ?? codexPlanLabel : '连接 Codex OAuth'"
              @click="connecting ? cancelOAuth() : oauthConnected ? disconnectOAuth() : connectOAuth()"
            >
              {{ oauthConnected ? codexPlanLabel : 'Codex OAuth' }}
            </button>
            <button
              class="dashboard-refresh"
              type="button"
              aria-label="刷新"
              :disabled="loading || usageLoading"
              @click="refreshDashboardData"
            >
              <RefreshCw :size="15" :stroke-width="2.2" />
            </button>
            <div class="window-control-strip" aria-label="窗口控制">
              <button class="window-control-button" type="button" aria-label="缩小" title="缩小" @click="minimizeMainWindow">
                <Minus :size="13" :stroke-width="2.4" />
              </button>
              <button
                class="window-control-button is-close"
                type="button"
                aria-label="关闭"
                title="关闭"
                @click="closeMainWindow"
              >
                <X :size="13" :stroke-width="2.4" />
              </button>
            </div>
          </div>
        </header>

        <div class="dashboard-status-strip">
          <div class="dashboard-view-tabs" aria-label="面板切换">
            <button type="button" :class="{ active: activeDashboardView === 'quota' }" @click="activeDashboardView = 'quota'">
              额度
            </button>
            <button
              type="button"
              :class="{ active: activeDashboardView === 'usage' }"
              @click="activeDashboardView = 'usage'; refreshUsageSummary()"
            >
              分析
            </button>
          </div>
          <b :class="systemState">{{ systemState === 'connected' ? 'ONLINE' : systemState === 'error' ? 'ERROR' : 'OFFLINE' }}</b>
          <em>Refresh</em>
          <strong>{{ refreshTime }}</strong>
        </div>

        <div class="dashboard-control-strip">
          <button
            class="widget-control-button"
            :class="{ active: widgetVisible }"
            type="button"
            :aria-pressed="widgetVisible"
            @click="updateWidgetVisible(!widgetVisible)"
          >
            <Monitor :size="12" :stroke-width="2" />
            <span>小组件</span>
            <strong>{{ widgetVisible ? '已开' : '关闭' }}</strong>
          </button>
          <button
            class="widget-control-button"
            :class="{ active: alwaysOnTop }"
            type="button"
            :disabled="!widgetVisible"
            :aria-pressed="alwaysOnTop"
            @click="updateAlwaysOnTop(!alwaysOnTop)"
          >
            <Pin :size="12" :stroke-width="2" />
            <span>固化</span>
            <strong>{{ alwaysOnTop ? '开启' : '关闭' }}</strong>
          </button>
          <button
            class="link-status-pill"
            :class="systemState"
            type="button"
            :title="oauthConnected ? oauthEmail ?? 'OAuth 已连接' : '连接 Codex OAuth'"
            @click="connecting ? cancelOAuth() : oauthConnected ? disconnectOAuth() : connectOAuth()"
          >
            <Link2 :size="12" :stroke-width="2" />
            <span>连接</span>
            <strong>{{ connecting ? '连接中' : systemStateLabel }}</strong>
          </button>
        </div>

        <template v-if="activeDashboardView === 'quota'">
          <section class="quota-dial-grid" aria-label="Codex 用量额度">
          <article class="quota-dial-card five-hour" :class="fiveHourState">
            <div class="quota-dial-head">
              <span>
                <Clock :size="12" :stroke-width="2" />
                5 小时额度
              </span>
              <b>{{ quotaBadge(fiveHourWindow) }}</b>
            </div>
            <div class="quota-dial-body">
              <div class="quota-dial" :style="quotaDialStyle(fiveHourWindow, '#20c66f')">
                <span class="quota-dial-hole">
                  <strong>{{ fiveHourWindow ? `${remainingPercent(fiveHourWindow)}%` : '--' }}</strong>
                  <small>剩余</small>
                </span>
              </div>
              <div class="quota-dial-metrics">
                <span>已用 <strong>{{ usedPercent(fiveHourWindow) }}%</strong></span>
                <span>重置 <strong>{{ quotaPeriodDisplay(fiveHourWindow) }}</strong></span>
              </div>
            </div>
          </article>

          <article class="quota-dial-card weekly" :class="sevenDayState">
            <div class="quota-dial-head">
              <span>
                <Calendar :size="12" :stroke-width="2" />
                一周额度
              </span>
              <b>{{ quotaBadge(sevenDayWindow) }}</b>
            </div>
            <div class="quota-dial-body">
              <div class="quota-dial" :style="quotaDialStyle(sevenDayWindow, '#f0c51a')">
                <span class="quota-dial-hole">
                  <strong>{{ sevenDayWindow ? `${remainingPercent(sevenDayWindow)}%` : '--' }}</strong>
                  <small>剩余</small>
                </span>
              </div>
              <div class="quota-dial-metrics">
                <span>已用 <strong>{{ usedPercent(sevenDayWindow) }}%</strong></span>
                <span>重置 <strong>{{ quotaPeriodDisplay(sevenDayWindow) }}</strong></span>
              </div>
            </div>
          </article>
        </section>

        <section class="reset-card-list" aria-label="重置卡">
          <div class="reset-card-list-head">
            <span class="reset-card-list-title">
              <Ticket :size="13" :stroke-width="2" />
              <strong>重置卡 · {{ resetCards.length }} 张</strong>
            </span>
            <small>可提前重置额度窗口</small>
          </div>
          <div class="reset-card-divider" />
          <div v-if="resetCards.length" class="reset-card-rows">
            <div v-for="(card, i) in resetCards.slice(0, 3)" :key="card.id" class="reset-card-row">
              <span>第 {{ i + 1 }} 张</span>
              <strong :title="resetCardExpiryText(card)">{{ resetCardExpiryText(card) }}</strong>
            </div>
          </div>
            <div v-else class="reset-card-row is-empty">
              <span>暂无可用重置</span>
              <strong>--</strong>
            </div>
          </section>
        </template>

        <section v-else class="usage-analytics-panel" aria-label="本机 token 分析">
          <div class="usage-period-grid">
            <article v-for="item in usagePeriods" :key="item.key" class="usage-period-card">
              <span>{{ item.label }}</span>
              <strong>{{ formatTokenCount(item.period.total.totalTokens) }}</strong>
              <em>{{ formatUsd(item.period.apiEstimateUsd) }}</em>
            </article>
          </div>

          <div class="usage-split-strip">
            <div v-for="item in usageSplitItems" :key="item.label" class="usage-split-item" :class="item.tone">
              <span>{{ item.label }}</span>
              <strong>{{ formatTokenCount(item.value) }}</strong>
              <i :style="usageSplitStyle(item.value)" />
            </div>
          </div>

          <div class="usage-rank-grid">
            <section class="usage-rank-card">
              <h3>项目排行</h3>
              <div v-for="project in topUsageProjects" :key="project.path" class="usage-rank-row">
                <span :title="project.path">{{ project.name }}</span>
                <strong>{{ formatTokenCount(project.totalTokens) }}</strong>
              </div>
              <div v-if="!topUsageProjects.length" class="usage-rank-row is-empty">
                <span>暂无项目数据</span>
                <strong>--</strong>
              </div>
            </section>

            <section class="usage-rank-card">
              <h3>工具 / Skill</h3>
              <div v-for="tool in topUsageTools" :key="tool.name" class="usage-rank-row">
                <span>{{ tool.name }}</span>
                <strong>{{ tool.calls }}</strong>
              </div>
              <div v-for="skill in topUsageSkills" :key="skill.name" class="usage-rank-row skill">
                <span>{{ skill.name }}</span>
                <strong>{{ skill.hits }}</strong>
              </div>
              <div v-if="!topUsageTools.length && !topUsageSkills.length" class="usage-rank-row is-empty">
                <span>暂无工具数据</span>
                <strong>--</strong>
              </div>
            </section>
          </div>

          <section class="usage-task-board">
            <div class="usage-task-head">
              <strong>今日任务</strong>
              <span>{{ currentUsagePeriod.events }} token_count · {{ currentUsagePeriod.toolCalls }} tools</span>
            </div>
            <div v-for="task in todayUsageTasks" :key="`${task.kind}-${task.source}-${task.updatedAt}`" class="usage-task-row">
              <span>{{ task.title }}</span>
              <time>{{ task.kind === 'automation' ? task.source : compactDateTime(task.updatedAt) }}</time>
            </div>
            <div v-if="!todayUsageTasks.length" class="usage-task-row is-empty">
              <span>暂无本机任务记录</span>
              <time>--</time>
            </div>
          </section>
        </section>
      </section>
    </main>
  </NConfigProvider>
</template>
