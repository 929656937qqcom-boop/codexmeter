<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NButton, NConfigProvider, NInput, NSwitch, type GlobalThemeOverrides } from 'naive-ui'
import {
  AlertCircle,
  Bluetooth,
  Calendar,
  CheckCircle2,
  Clock,
  Cloud,
  Copy,
  ExternalLink,
  Info,
  KeyRound,
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
import type { AppSettings, RefreshIntervalMinutes, UpdateChannel } from '../shared/settings'
import type { UpdateState } from '../shared/update'
import type {
  CodexUsageSummary,
  UsageDailyProjectSummary,
  UsageDailySummary,
  UsagePeriodSummary,
  UsageReconciliationDay,
  UsageTokenTotals
} from '../shared/usageAnalytics'

const BLE_SERVICE_UUID = '6f4d0001-9c8f-4c2a-9f12-000000000001'
const BLE_USAGE_UUID = '6f4d0002-9c8f-4c2a-9f12-000000000002'

type UsagePeriodKey = 'today' | 'sevenDays' | 'month'
type UsageInsightView = 'trend' | 'reconciliation' | 'details'

interface UsageTrendPoint {
  date: string
  total: number
  x: number
  y: number
}

const isWidgetView = new URLSearchParams(window.location.search).get('view') === 'widget'
const snapshot = ref<QuotaSnapshot | null>(null)
const settings = ref<AppSettings | null>(null)
const loading = ref(false)
const usageLoading = ref(false)
const refreshMessage = ref('')
const status = ref('就绪')
const activeUsagePeriod = ref<UsagePeriodKey>('today')
const activeUsageInsight = ref<UsageInsightView>('trend')
const selectedUsageDate = ref('')
const usageSummary = ref<CodexUsageSummary | null>(null)
const widgetVisible = ref(false)
const alwaysOnTop = ref(false)
const hardwareEndpointInput = ref('')
const hardwareSaving = ref(false)
const hardwareStatusText = ref('')
const hardwareConnectionState = ref<'未连接' | '连接中' | '已连接' | '连接失败' | '推送成功' | '推送失败'>('未连接')
const hardwareAutoSync = ref(true)
const hardwareLastPushedAt = ref<string | undefined>()
const hardwareDialogVisible = ref(false)
const cloudDialogVisible = ref(false)
const cloudEnabled = ref(false)
const cloudEndpointInput = ref('')
const cloudSyncKeyInput = ref('')
const cloudSaving = ref(false)
const cloudKeyGenerating = ref(false)
const cloudDashboardOpening = ref(false)
const cloudPairingBusy = ref(false)
const cloudPairCode = ref('')
const cloudPairExpiresAt = ref<string | undefined>()
const cloudSyncedAt = ref<string | undefined>()
const cloudStatusText = ref('尚未开启')
const bleConnected = ref(false)
const bleDeviceName = ref('')
let bleCharacteristic: BluetoothRemoteGATTCharacteristic | undefined
const oauthConnected = ref(false)
const oauthEmail = ref<string | undefined>()
const connecting = ref(false)
const noticeVisible = ref(false)
const noticeText = ref('')
const aboutVisible = ref(false)
const diagnosticsEnabled = ref(false)
const updateState = ref<UpdateState>({ currentVersion: '0.1.0', channel: 'latest', status: 'idle' })
let unsubscribeQuota: (() => void) | undefined
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let removeCopyListener: (() => void) | undefined
let unsubscribeHardwarePush: (() => void) | undefined
let unsubscribeUpdateState: (() => void) | undefined
let removeDiagnosticListeners: (() => void) | undefined

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
const updateBusy = computed(() => updateState.value.status === 'checking' || updateState.value.status === 'downloading')
const updateStatusText = computed(() => {
  if (updateState.value.status === 'checking') return '正在检查更新（最多 15 秒）'
  if (updateState.value.status === 'available') return `发现 v${updateState.value.availableVersion}，准备下载`
  if (updateState.value.status === 'downloading') return `正在下载 ${updateState.value.progressPercent ?? 0}%`
  if (updateState.value.status === 'downloaded') return `v${updateState.value.availableVersion} 已下载，等待安装`
  if (updateState.value.status === 'up-to-date') return '当前已是最新版本'
  if (updateState.value.status === 'error') return updateState.value.error ?? '检查更新失败'
  if (updateState.value.status === 'unsupported') return '开发模式不检查更新'
  return updateState.value.channel === 'beta' ? '内部灰度通道' : '正式公开通道'
})
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
  const refreshedAt = usageSummary.value?.generatedAt ?? snapshot.value?.refreshedAt
  if (!refreshedAt) {
    return '--:--:--'
  }

  return new Date(refreshedAt).toLocaleTimeString()
})
const refreshStatusLabel = computed(() => refreshMessage.value || 'Refresh')
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
const cloudStateLabel = computed(() => cloudEnabled.value ? cloudSyncedAt.value ? '已同步' : '已开启' : '关闭')
const usagePeriods = computed<Array<{ key: UsagePeriodKey; label: string; hint: string; period: UsagePeriodSummary }>>(() => {
  const summary = usageSummary.value
  if (!summary) {
    return []
  }

  return [
    { key: 'today', label: '今日', hint: 'Today', period: summary.periods.today },
    { key: 'sevenDays', label: '7 日', hint: '7 Days', period: summary.periods.sevenDays },
    { key: 'month', label: '本月', hint: 'Month', period: summary.periods.month }
  ]
})
const currentUsagePeriod = computed(() => usageSummary.value?.periods[activeUsagePeriod.value] ?? emptyUsagePeriod())
const currentUsagePeriodLabel = computed(() => usagePeriods.value.find((item) => item.key === activeUsagePeriod.value)?.label ?? '今日')
const todayUsagePeriod = computed(() => usageSummary.value?.periods.today ?? emptyUsagePeriod())
const usageSplitItems = computed(() => {
  const total = currentUsagePeriod.value.total
  return [
    { label: '输入', value: total.inputTokens, tone: 'input' },
    { label: '缓存', value: total.cachedInputTokens, tone: 'cached' },
    { label: '输出', value: total.outputTokens, tone: 'output' }
  ]
})
const topUsageTools = computed(() => usageSummary.value?.tools.slice(0, 2) ?? [])
const topUsageSkills = computed(() => usageSummary.value?.skills.slice(0, 1) ?? [])
const topUsageProjects = computed(() => usageSummary.value?.projects.slice(0, 3) ?? [])
const topUsageThreads = computed(() => usageSummary.value?.threads.slice(0, 3) ?? [])
const todayUsageTasks = computed(() => usageSummary.value?.tasks.slice(0, 2) ?? [])
const dailyUsageSeries = computed(() => usageSummary.value?.dailyUsage ?? [])
const usageTrendMax = computed(() => Math.max(1, ...dailyUsageSeries.value.map((day) => day.total.totalTokens)))
const usageTrendPoints = computed<UsageTrendPoint[]>(() => {
  const days = dailyUsageSeries.value
  const lastIndex = Math.max(1, days.length - 1)
  return days.map((day, index) => ({
    date: day.date,
    total: day.total.totalTokens,
    x: 4 + (index / lastIndex) * 92,
    y: 75 - (day.total.totalTokens / usageTrendMax.value) * 57
  }))
})
const usageTrendLinePath = computed(() => buildUsageTrendPath(usageTrendPoints.value))
const usageTrendAreaPath = computed(() => {
  const points = usageTrendPoints.value
  if (!points.length) {
    return ''
  }
  return `${buildUsageTrendPath(points)} L ${points.at(-1)?.x ?? 96} 77 L ${points[0].x} 77 Z`
})
const selectedUsageDay = computed<UsageDailySummary | null>(() => {
  const days = dailyUsageSeries.value
  return days.find((day) => day.date === selectedUsageDate.value) ?? days.at(-1) ?? null
})
const selectedUsageProjects = computed<UsageDailyProjectSummary[]>(() => {
  const projects = selectedUsageDay.value?.projects ?? []
  if (projects.length <= 5) {
    return projects
  }

  const visible = projects.slice(0, 4)
  const rest = projects.slice(4)
  const other = rest.reduce<UsageDailyProjectSummary>((total, project) => {
    total.events += project.events
    addUsageTokenTotals(total, project)
    return total
  }, {
    name: `其他 ${rest.length} 个项目`,
    path: rest.map((project) => project.name).join('、'),
    events: 0,
    ...emptyTokenTotals()
  })
  return [...visible, other]
})
const usageReconciliationDays = computed(() => [...(usageSummary.value?.reconciliation ?? [])].reverse())
const reconciledUsageDays = computed(() => usageReconciliationDays.value.filter((day) => day.officialTokens !== undefined))
const reconciliationContribution = computed(() => {
  const days = reconciledUsageDays.value
  const official = days.reduce((total, day) => total + (day.officialTokens ?? 0), 0)
  const local = days.reduce((total, day) => total + day.localTokens, 0)
  return official > 0 ? (local / official) * 100 : undefined
})
const latestOfficialUsageDate = computed(() => usageSummary.value?.officialUsage.dailyUsage.at(-1)?.date)
const latestReliableOfficialLag = computed(() => usageSummary.value?.officialUsage.history?.days.filter((day) => day.lagReliable).at(-1))
const dataQualityTitle = computed(() => usageSummary.value?.dataQuality.notes.join('；') ?? '')

onMounted(async () => {
  const handleCopy = () => showNotice('已复制到剪贴板')
  document.addEventListener('copy', handleCopy)
  removeCopyListener = () => document.removeEventListener('copy', handleCopy)

  const handleRendererError = (event: ErrorEvent) => {
    void window.codexMeter?.reportDiagnostic({
      kind: 'renderer-error',
      message: event.message || 'Renderer error',
      stack: event.error instanceof Error ? event.error.stack : undefined,
      operation: 'window-error'
    })
  }
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
    void window.codexMeter?.reportDiagnostic({
      kind: 'renderer-error',
      message: error.message,
      stack: error.stack,
      operation: 'unhandled-rejection'
    })
  }
  window.addEventListener('error', handleRendererError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  removeDiagnosticListeners = () => {
    window.removeEventListener('error', handleRendererError)
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }

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
    settings.value = window.codexMeter ? await window.codexMeter.getSettings() : null
    snapshot.value = window.codexMeter ? await window.codexMeter.getLatestQuota() : sampleQuotaSnapshot()
    return
  }

  if (window.codexMeter) {
    settings.value = await window.codexMeter.getSettings()
    diagnosticsEnabled.value = settings.value.diagnosticsEnabled
    hardwareEndpointInput.value = settings.value.hardwareEndpoint ?? ''
    hardwareAutoSync.value = settings.value.hardwareDisplayEnabled
    hardwareConnectionState.value = settings.value.hardwareEndpoint ? '已连接' : '未连接'
    const oauth = await window.codexMeter.getOAuthStatus()
    oauthConnected.value = oauth.connected
    oauthEmail.value = oauth.email
    const widgetState = await window.codexMeter.getWidgetState()
    widgetVisible.value = widgetState.visible
    alwaysOnTop.value = widgetState.visible ? widgetState.alwaysOnTop : false
    const cloud = await window.codexMeter.getCloudSync()
    cloudEnabled.value = cloud.enabled
    cloudEndpointInput.value = cloud.endpoint
    cloudSyncKeyInput.value = cloud.syncKey ?? ''
    cloudSyncedAt.value = cloud.syncedAt
    cloudStatusText.value = cloud.error ?? (cloud.syncedAt ? `最近同步 ${compactDateTime(cloud.syncedAt)}` : cloud.enabled ? '等待首次同步' : '尚未开启')
    updateState.value = await window.codexMeter.getUpdateState()
    unsubscribeUpdateState = window.codexMeter.onUpdateState((state) => {
      updateState.value = state
    })
  } else {
    settings.value = {
      refreshIntervalMinutes: 5,
      hardwareDisplayEnabled: true,
      cloudSyncEnabled: false,
      cloudEndpoint: 'https://codexmeter-cloud-929656937.netlify.app/api/usage',
      updateChannel: 'latest',
      diagnosticsEnabled: false
    }
    hardwareAutoSync.value = true
  }

  await refreshQuota()
  await refreshUsageSummary()
})

onUnmounted(() => {
  unsubscribeQuota?.()
  unsubscribeHardwarePush?.()
  unsubscribeUpdateState?.()
  removeCopyListener?.()
  removeDiagnosticListeners?.()
  clearNotice()
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
  if (loading.value || usageLoading.value) return
  refreshMessage.value = '正在刷新额度'
  try {
    await refreshQuota()
    refreshMessage.value = '正在分析并同步'
    await refreshUsageSummary()
    refreshMessage.value = '刷新完成'
    showNotice('数据已刷新并同步云端')
  } catch (error) {
    refreshMessage.value = '刷新失败'
    showNotice(error instanceof Error ? `刷新失败：${error.message}` : '刷新失败')
  }
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

async function setUpdateChannel(channel: UpdateChannel): Promise<void> {
  if (!window.codexMeter || updateState.value.channel === channel) return
  updateState.value = await window.codexMeter.setUpdateChannel(channel)
  settings.value = settings.value ? { ...settings.value, updateChannel: channel } : settings.value
}

async function checkAppUpdate(): Promise<void> {
  if (!window.codexMeter || updateBusy.value) return
  updateState.value = await window.codexMeter.checkForUpdates()
}

async function installAppUpdate(): Promise<void> {
  if (!window.codexMeter) return
  await window.codexMeter.installUpdate()
}

async function saveDiagnosticsEnabled(enabled: boolean): Promise<void> {
  diagnosticsEnabled.value = enabled
  if (!window.codexMeter) return
  settings.value = await window.codexMeter.saveDiagnosticsEnabled(enabled)
  showNotice(enabled ? '匿名错误诊断已开启' : '匿名错误诊断已关闭')
}

function openHardwareDialog(): void {
  hardwareEndpointInput.value = settings.value?.hardwareEndpoint ?? hardwareEndpointInput.value
  hardwareAutoSync.value = settings.value?.hardwareEndpoint ? settings.value.hardwareDisplayEnabled : true
  hardwareDialogVisible.value = true
  hardwareConnectionState.value = hardwareConnected.value ? '已连接' : '未连接'
  hardwareStatusText.value = ''
}

function openCloudDialog(): void {
  cloudDialogVisible.value = true
  if (!window.codexMeter) return
  cloudStatusText.value = '正在读取同步状态...'
  void window.codexMeter.getCloudSync().then((cloud) => {
    cloudEnabled.value = cloud.enabled
    cloudEndpointInput.value = cloud.endpoint
    cloudSyncKeyInput.value = cloud.syncKey ?? ''
    cloudSyncedAt.value = cloud.syncedAt
    cloudStatusText.value = cloud.error ?? (cloud.syncedAt ? `最近同步 ${compactDateTime(cloud.syncedAt)}` : cloud.enabled ? '等待首次同步' : '尚未开启')
  }).catch((error) => {
    cloudStatusText.value = error instanceof Error ? `读取失败：${error.message}` : '读取同步状态失败'
  })
}

async function generateCloudKey(): Promise<void> {
  if (!window.codexMeter || cloudKeyGenerating.value) return
  cloudKeyGenerating.value = true
  cloudStatusText.value = '正在建立云端账号凭证...'
  try {
    cloudSyncKeyInput.value = (await window.codexMeter.generateCloudSyncKey()).syncKey
    cloudStatusText.value = '已建立新的云端空间；其他设备请使用一次性配对码加入'
  } catch (error) {
    cloudStatusText.value = error instanceof Error ? `生成失败：${error.message}` : '建立账号凭证失败'
  } finally {
    cloudKeyGenerating.value = false
  }
}

async function copyCloudKey(): Promise<void> {
  if (!cloudSyncKeyInput.value) return
  try {
    await navigator.clipboard.writeText(cloudSyncKeyInput.value)
    cloudStatusText.value = '账号同步凭证已复制到剪贴板'
    showNotice('账号同步凭证已复制')
  } catch {
    cloudStatusText.value = '复制失败，请选中密钥后按 Ctrl+C'
  }
}

async function saveCloudSyncSettings(): Promise<void> {
  if (!window.codexMeter || cloudSaving.value) return
  cloudSaving.value = true
  cloudStatusText.value = cloudEnabled.value ? '正在保存并同步...' : '正在保存设置...'
  try {
    const state = await window.codexMeter.saveCloudSync(
      cloudEnabled.value,
      cloudEndpointInput.value,
      cloudSyncKeyInput.value || undefined
    )
    cloudEnabled.value = state.enabled
    cloudEndpointInput.value = state.endpoint
    cloudSyncKeyInput.value = state.syncKey ?? ''
    if (state.enabled) {
      const result = await window.codexMeter.syncCloudNow()
      cloudSyncedAt.value = result.syncedAt
      cloudStatusText.value = result.synced ? `同步成功 ${compactDateTime(result.syncedAt ?? '')}` : result.error ?? '同步失败'
      if (!result.synced) return
    } else {
      cloudStatusText.value = '尚未开启'
    }
    showNotice(state.enabled ? '云端设置已保存并同步' : '云端同步已关闭')
    cloudDialogVisible.value = false
  } catch (error) {
    cloudStatusText.value = error instanceof Error ? `保存失败：${error.message}` : '保存云端设置失败'
  } finally {
    cloudSaving.value = false
  }
}

async function openCloudDashboard(): Promise<void> {
  if (!window.codexMeter || cloudDashboardOpening.value) return
  cloudDashboardOpening.value = true
  cloudStatusText.value = '正在获取一次性登录码（最多 12 秒）...'
  try {
    await window.codexMeter.saveCloudSync(cloudEnabled.value, cloudEndpointInput.value, cloudSyncKeyInput.value || undefined)
    await window.codexMeter.openCloudDashboard()
    cloudStatusText.value = cloudSyncedAt.value ? `最近同步 ${compactDateTime(cloudSyncedAt.value)}` : '网页看板已打开'
  } catch (error) {
    cloudStatusText.value = error instanceof Error ? `打开失败：${error.message}` : '打开网页看板失败'
  } finally {
    cloudDashboardOpening.value = false
  }
}

async function createCloudPairCode(): Promise<void> {
  if (!window.codexMeter || cloudPairingBusy.value) return
  cloudPairingBusy.value = true
  cloudStatusText.value = '正在生成一次性配对码...'
  try {
    await window.codexMeter.saveCloudSync(cloudEnabled.value, cloudEndpointInput.value, cloudSyncKeyInput.value || undefined)
    const result = await window.codexMeter.createCloudPairingCode()
    cloudPairCode.value = result.code
    cloudPairExpiresAt.value = result.expiresAt
    cloudStatusText.value = `配对码 ${result.code}，10 分钟内有效且只能使用一次`
  } catch (error) {
    cloudStatusText.value = error instanceof Error ? `生成失败：${error.message}` : '生成配对码失败'
  } finally {
    cloudPairingBusy.value = false
  }
}

async function redeemCloudPairCode(): Promise<void> {
  if (!window.codexMeter || cloudPairingBusy.value || !cloudPairCode.value.trim()) return
  cloudPairingBusy.value = true
  cloudStatusText.value = '正在加入同步空间...'
  try {
    cloudSyncKeyInput.value = (await window.codexMeter.redeemCloudPairingCode(cloudPairCode.value)).syncKey
    cloudEnabled.value = true
    await saveCloudSyncSettings()
  } catch (error) {
    cloudStatusText.value = error instanceof Error ? `加入失败：${error.message}` : '加入同步空间失败'
  } finally {
    cloudPairingBusy.value = false
  }
}

async function updateInterval(value: number): Promise<void> {
  settings.value = window.codexMeter
    ? await window.codexMeter.saveRefreshInterval(value as RefreshIntervalMinutes)
    : {
        refreshIntervalMinutes: value as RefreshIntervalMinutes,
        hardwareDisplayEnabled: true,
        cloudSyncEnabled: false,
        cloudEndpoint: 'https://codexmeter-cloud-929656937.netlify.app/api/usage',
        updateChannel: settings.value?.updateChannel ?? 'latest',
        diagnosticsEnabled: settings.value?.diagnosticsEnabled ?? false
      }
}

async function saveHardwareDisplay(enabled = true): Promise<void> {
  hardwareSaving.value = true
  try {
    settings.value = window.codexMeter
      ? await window.codexMeter.saveHardwareDisplay(enabled, hardwareEndpointInput.value)
      : {
          refreshIntervalMinutes: settings.value?.refreshIntervalMinutes ?? 5,
          hardwareDisplayEnabled: Boolean(enabled && hardwareEndpointInput.value),
          hardwareEndpoint: hardwareEndpointInput.value,
          cloudSyncEnabled: settings.value?.cloudSyncEnabled ?? false,
          cloudEndpoint: settings.value?.cloudEndpoint ?? 'https://codexmeter-cloud-929656937.netlify.app/api/usage',
          updateChannel: settings.value?.updateChannel ?? 'latest',
          diagnosticsEnabled: settings.value?.diagnosticsEnabled ?? false
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
}

async function minimizeMainWindow(): Promise<void> {
  await window.codexMeter?.minimizeMainWindow()
}

async function closeMainWindow(): Promise<void> {
  await window.codexMeter?.closeMainWindow()
}

async function openMainFromWidget(): Promise<void> {
  try {
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

const widgetWeeklyRemaining = computed(() => remainingPercent(sevenDayWindow.value))
const widgetOrbTone = computed(() => `is-${sevenDayState.value}`)
const widgetUpdateTime = computed(() => widgetClockText(snapshot.value?.refreshedAt))
const widgetTooltip = computed(() => {
  const fiveHour = fiveHourWindow.value ? `${remainingPercent(fiveHourWindow.value)}%` : '--'
  const weekly = sevenDayWindow.value ? `${remainingPercent(sevenDayWindow.value)}%` : '--'
  const cards = resetCards.value.length
    ? resetCards.value.map((card, index) => `重置卡 ${index + 1}: ${widgetResetCardShortDate(card)}`)
    : ['重置卡: 0']

  return [
    `一周剩余: ${weekly}`,
    `5 小时剩余: ${fiveHour}`,
    `更新: ${widgetUpdateTime.value}`,
    ...cards,
    '双击打开主界面'
  ].join('\n')
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
  if (value >= 100_000_000) {
    return `${formatChineseQuantity(value / 100_000_000, 2)}亿`
  }
  if (value >= 1_000_000) {
    return `${formatChineseQuantity(value / 1_000_000, 1)}百万`
  }
  if (value >= 10_000) {
    return `${formatChineseQuantity(value / 10_000, 1)}万`
  }
  return Math.round(value).toLocaleString('zh-CN')
}

function formatChineseQuantity(value: number, maximumFractionDigits: number): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits
  })
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

function formatToolCost(outputChars: number): string {
  if (outputChars >= 100_000_000) {
    return `${formatChineseQuantity(outputChars / 100_000_000, 2)}亿字`
  }
  if (outputChars >= 10_000) {
    return `${formatChineseQuantity(outputChars / 10_000, 1)}万字`
  }
  return `${Math.round(outputChars).toLocaleString('zh-CN')}字`
}

function compactDay(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--'
  }

  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function usageSplitStyle(value: number): Record<string, string> {
  const total = currentUsagePeriod.value.total
  const denominator = Math.max(1, total.inputTokens + total.outputTokens)
  const width = Math.max(4, Math.round((value / denominator) * 100))
  return { '--usage-split-width': `${Math.min(100, width)}%` }
}

function buildUsageTrendPath(points: UsageTrendPoint[]): string {
  if (!points.length) {
    return ''
  }

  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const controlOffset = (current.x - previous.x) * 0.42
    path += ` C ${previous.x + controlOffset} ${previous.y}, ${current.x - controlOffset} ${current.y}, ${current.x} ${current.y}`
  }
  return path
}

function addUsageTokenTotals(target: UsageTokenTotals, source: UsageTokenTotals): void {
  target.inputTokens += source.inputTokens
  target.cachedInputTokens += source.cachedInputTokens
  target.outputTokens += source.outputTokens
  target.reasoningOutputTokens += source.reasoningOutputTokens
  target.totalTokens += source.totalTokens
}

function usageDayLabel(dateValue: string): string {
  const date = usageDayDate(dateValue)
  if (!date) {
    return '--'
  }
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`
}

function usageDayWeekday(dateValue: string): string {
  const date = usageDayDate(dateValue)
  if (!date) {
    return '--'
  }
  return `周${'日一二三四五六'[date.getUTCDay()]}`
}

function usageDayDate(dateValue: string): Date | null {
  const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return null
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

function usageDayTitle(day: UsageDailySummary): string {
  const projects = day.projects
    .slice(0, 5)
    .map((project) => `${project.name} ${formatTokenCount(project.totalTokens)}`)
    .join('，')
  return `${day.date}：${formatTokenCount(day.total.totalTokens)}${projects ? `；${projects}` : ''}`
}

function reconciliationStatusLabel(day: UsageReconciliationDay): string {
  if (day.status === 'close') return '接近'
  if (day.status === 'different') return '存在差异'
  if (day.status === 'official-behind') return '官方待同步'
  return '暂无官方数据'
}

function reconciliationStatusClass(day: UsageReconciliationDay): string {
  return `is-${day.status}`
}

function formatContribution(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '--'
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}%`
}

function formatLagMinutes(value: number): string {
  if (value < 60) return `${value} 分钟`
  const hours = value / 60
  return hours < 24 ? `${hours.toFixed(1)} 小时` : `${(hours / 24).toFixed(1)} 天`
}

function usageProjectShare(project: UsageDailyProjectSummary): number {
  const total = selectedUsageDay.value?.total.totalTokens ?? 0
  return total > 0 ? (project.totalTokens / total) * 100 : 0
}

function usageProjectDisplayName(project: UsageDailyProjectSummary): string {
  if (project.name.startsWith('其他 ')) {
    return project.name
  }
  const duplicates = (selectedUsageDay.value?.projects ?? []).filter((item) => item.name === project.name)
  if (duplicates.length <= 1) {
    return project.name
  }
  const parts = project.path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  return parts.slice(-2).join(' / ') || project.name
}

function formatUsageShare(project: UsageDailyProjectSummary): string {
  const share = usageProjectShare(project)
  if (share > 0 && share < 1) {
    return '<1%'
  }
  return `${Math.round(share)}%`
}

function usageProjectStyle(project: UsageDailyProjectSummary): Record<string, string> {
  const share = usageProjectShare(project)
  return { '--usage-project-share': `${share > 0 ? Math.max(2, share) : 0}%` }
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
        <div class="about-head">
          <strong>CodexMeter</strong>
          <span>v{{ updateState.currentVersion }}</span>
        </div>
        <p>{{ updateStatusText }}</p>
        <div class="about-channel" aria-label="更新通道">
          <button type="button" :class="{ active: updateState.channel === 'latest' }" @click="setUpdateChannel('latest')">正式版</button>
          <button type="button" :class="{ active: updateState.channel === 'beta' }" @click="setUpdateChannel('beta')">内部灰度</button>
        </div>
        <label class="about-diagnostics">
          <span><strong>匿名错误诊断</strong><small>仅上传脱敏错误、版本和系统信息</small></span>
          <NSwitch :value="diagnosticsEnabled" size="small" @update:value="saveDiagnosticsEnabled" />
        </label>
        <div class="about-actions">
          <button type="button" :disabled="updateBusy" @click="checkAppUpdate">{{ updateBusy ? '处理中…' : '检查更新' }}</button>
          <button v-if="updateState.status === 'downloaded'" type="button" class="primary" @click="installAppUpdate">重启安装</button>
          <button type="button" @click="aboutVisible = false">关闭</button>
        </div>
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

    <Transition name="notice">
      <div v-if="cloudDialogVisible" class="hardware-connect-backdrop" @click.self="cloudDialogVisible = false">
        <section class="hardware-connect-popover cloud-sync-popover">
          <div class="hardware-connect-head">
            <div>
              <strong>云端多设备汇总</strong>
              <span>上传 Token 汇总与项目显示名，不上传对话、项目路径、文件内容或 Codex OAuth</span>
            </div>
            <button type="button" aria-label="关闭" @click="cloudDialogVisible = false">×</button>
          </div>

          <div class="cloud-sync-form">
            <label>
              <span>服务地址</span>
              <NInput v-model:value="cloudEndpointInput" size="small" placeholder="https://.../api/usage" />
            </label>
            <label>
              <span>账号同步凭证（本机加密保存）</span>
              <div class="cloud-key-field">
                <KeyRound :size="14" :stroke-width="2" />
                <NInput v-model:value="cloudSyncKeyInput" type="password" size="small" placeholder="cm_sync_..." />
                <button type="button" title="复制密钥" aria-label="复制密钥" @click="copyCloudKey">
                  <Copy :size="14" :stroke-width="2" />
                </button>
              </div>
            </label>
            <div class="cloud-key-actions">
              <NButton size="small" ghost :loading="cloudKeyGenerating" @click="generateCloudKey">重新建立云端空间</NButton>
              <NButton size="small" ghost :disabled="cloudDashboardOpening" @click="openCloudDashboard">
                <template #icon><ExternalLink :size="14" /></template>
                {{ cloudDashboardOpening ? '正在连接（最多 12 秒）' : '自动登录网页看板' }}
              </NButton>
            </div>
            <div class="cloud-pair-panel">
              <div class="cloud-pair-copy">
                <strong>连接新设备（一次性配对码）</strong>
                <span>{{ cloudPairExpiresAt ? `配对码有效至 ${compactDateTime(cloudPairExpiresAt)}` : '已有设备生成，新设备输入；10 分钟后失效' }}</span>
              </div>
              <div class="cloud-pair-row">
                <NInput v-model:value="cloudPairCode" size="small" maxlength="8" placeholder="8 位配对码" />
                <NButton size="small" ghost :loading="cloudPairingBusy" @click="createCloudPairCode">生成</NButton>
                <NButton size="small" type="primary" :loading="cloudPairingBusy" :disabled="!cloudPairCode.trim()" @click="redeemCloudPairCode">加入</NButton>
              </div>
            </div>
          </div>

          <div class="hardware-control-panel">
            <div class="hardware-sync-row">
              <div><strong>自动同步</strong><span>启动和刷新分析数据时上传设备汇总</span></div>
              <b>[{{ cloudEnabled ? '开启' : '关闭' }}]</b>
              <NSwitch v-model:value="cloudEnabled" size="small" />
            </div>
            <div class="cloud-sync-status" :class="{ success: Boolean(cloudSyncedAt), error: cloudStatusText.includes('失败') }">
              <Cloud :size="16" :stroke-width="2" />
              <span>{{ cloudStatusText }}</span>
            </div>
            <div class="hardware-sync-row diagnostics-sync-row">
              <div><strong>匿名错误诊断</strong><span>上传脱敏错误类型、版本和系统信息，不上传对话与路径</span></div>
              <b>[{{ diagnosticsEnabled ? '开启' : '关闭' }}]</b>
              <NSwitch :value="diagnosticsEnabled" size="small" @update:value="saveDiagnosticsEnabled" />
            </div>
          </div>

          <div class="hardware-connect-actions">
            <NButton size="small" @click="cloudDialogVisible = false">取消</NButton>
            <NButton size="small" type="primary" :loading="cloudSaving" @click="saveCloudSyncSettings">保存并同步</NButton>
          </div>
        </section>
      </div>
    </Transition>

    <main v-if="isWidgetView" class="widget-shell is-collapsed">
      <button
        class="widget-orb"
        :class="widgetOrbTone"
        :title="widgetTooltip"
        type="button"
        aria-label="CodexMeter 7 天剩余额度悬浮球，双击打开主界面"
        @dblclick="openMainFromWidget"
      >
        <span class="widget-orb-center">
          <strong class="widget-orb-value">{{ sevenDayWindow ? `${widgetWeeklyRemaining}%` : '--' }}</strong>
          <span class="widget-orb-label">7D</span>
        </span>
      </button>
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
              :class="{ 'is-loading': loading || usageLoading }"
              type="button"
              aria-label="刷新"
              :disabled="loading || usageLoading"
              @click="refreshDashboardData"
            >
              <RefreshCw :size="18" :stroke-width="2.2" />
            </button>
            <div class="window-control-strip" aria-label="窗口控制">
              <button class="window-control-button is-about" type="button" aria-label="关于与更新" title="关于与更新" @click="showAbout">
                <Info :size="15" :stroke-width="2.2" />
              </button>
              <button class="window-control-button" type="button" aria-label="缩小" title="缩小" @click="minimizeMainWindow">
                <Minus :size="15" :stroke-width="2.4" />
              </button>
              <button
                class="window-control-button is-close"
                type="button"
                aria-label="关闭"
                title="关闭"
                @click="closeMainWindow"
              >
                <X :size="15" :stroke-width="2.4" />
              </button>
            </div>
          </div>
        </header>

        <div class="dashboard-status-strip">
          <span class="dashboard-section-label">额度与 Token 分析</span>
          <b :class="systemState">{{ systemState === 'connected' ? 'ONLINE' : systemState === 'error' ? 'ERROR' : 'OFFLINE' }}</b>
          <em>{{ refreshStatusLabel }}</em>
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
            <Monitor :size="16" :stroke-width="2" />
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
            <Pin :size="16" :stroke-width="2" />
            <span>固化</span>
            <strong>{{ alwaysOnTop ? '开启' : '关闭' }}</strong>
          </button>
          <button
            class="widget-control-button"
            :class="{ active: cloudEnabled }"
            type="button"
            @click="openCloudDialog"
          >
            <Cloud :size="16" :stroke-width="2" />
            <span>云端</span>
            <strong>{{ cloudStateLabel }}</strong>
          </button>
          <button
            class="link-status-pill"
            :class="systemState"
            type="button"
            :title="oauthConnected ? oauthEmail ?? 'OAuth 已连接' : '连接 Codex OAuth'"
            @click="connecting ? cancelOAuth() : oauthConnected ? disconnectOAuth() : connectOAuth()"
          >
            <Link2 :size="16" :stroke-width="2" />
            <span>连接</span>
            <strong>{{ connecting ? '连接中' : systemStateLabel }}</strong>
          </button>
        </div>

        <section class="quota-dial-grid" aria-label="Codex 用量额度">
          <article class="quota-dial-card five-hour" :class="fiveHourState">
            <div class="quota-dial-head">
              <span>
                <Clock :size="16" :stroke-width="2" />
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
                <Calendar :size="16" :stroke-width="2" />
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
          <section class="reset-card-list" aria-label="重置卡">
          <div class="reset-card-list-head">
            <span class="reset-card-list-title">
              <Ticket :size="16" :stroke-width="2" />
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
        </section>

        <section class="usage-analytics-panel" aria-label="本机 token 分析">
          <div class="usage-period-grid">
            <button
              v-for="item in usagePeriods"
              :key="item.key"
              class="usage-period-card"
              :class="{ active: activeUsagePeriod === item.key }"
              type="button"
              :title="`${item.label}：输入 ${formatTokenCount(item.period.total.inputTokens)}，缓存 ${formatTokenCount(item.period.total.cachedInputTokens)}，输出 ${formatTokenCount(item.period.total.outputTokens)}`"
              @click="activeUsagePeriod = item.key"
            >
              <span>{{ item.label }}</span>
              <strong>{{ formatTokenCount(item.period.total.totalTokens) }}</strong>
              <em>{{ formatUsd(item.period.apiEstimateUsd) }}</em>
              <small>{{ item.period.events }} 次</small>
            </button>
          </div>

          <div class="usage-split-strip" :title="`${currentUsagePeriodLabel} token 拆分`">
            <div v-for="item in usageSplitItems" :key="item.label" class="usage-split-item" :class="item.tone">
              <span>{{ item.label }}</span>
              <strong>{{ formatTokenCount(item.value) }}</strong>
              <i :style="usageSplitStyle(item.value)" />
            </div>
          </div>

          <section class="usage-insight-card">
            <header class="usage-insight-header">
              <div>
                <strong>{{ activeUsageInsight === 'trend' ? '最近 7 天' : activeUsageInsight === 'reconciliation' ? '账号对账' : '排行与任务' }}</strong>
                <span v-if="activeUsageInsight === 'trend' && selectedUsageDay">
                  {{ usageDayLabel(selectedUsageDay.date) }} · {{ formatTokenCount(selectedUsageDay.total.totalTokens) }}
                </span>
                <span v-else-if="activeUsageInsight === 'reconciliation'">
                  官方更新至 {{ latestOfficialUsageDate ? usageDayLabel(latestOfficialUsageDate) : '--' }} · 本机贡献为估算
                </span>
                <span v-else>项目、线程、工具与今日任务</span>
              </div>
              <nav class="usage-insight-tabs" aria-label="分析视图切换">
                <button type="button" :class="{ active: activeUsageInsight === 'trend' }" @click="activeUsageInsight = 'trend'">趋势</button>
                <button type="button" :class="{ active: activeUsageInsight === 'reconciliation' }" @click="activeUsageInsight = 'reconciliation'">对账</button>
                <button type="button" :class="{ active: activeUsageInsight === 'details' }" @click="activeUsageInsight = 'details'">排行</button>
              </nav>
            </header>

            <div v-if="activeUsageInsight === 'trend'" class="usage-trend-layout">
              <div class="usage-trend-chart">
                <div class="usage-trend-summary">
                  <span>每日 token</span>
                  <strong>峰值 {{ formatTokenCount(usageTrendMax) }}</strong>
                </div>
                <svg class="usage-trend-svg" viewBox="0 0 100 80" preserveAspectRatio="none" aria-label="最近 7 天 token 趋势">
                  <defs>
                    <linearGradient id="usageTrendAreaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stop-color="#22d3ee" stop-opacity="0.28" />
                      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0.02" />
                    </linearGradient>
                  </defs>
                  <line v-for="gridY in [20, 48, 76]" :key="gridY" x1="4" :y1="gridY" x2="96" :y2="gridY" class="usage-trend-grid-line" />
                  <path v-if="usageTrendAreaPath" :d="usageTrendAreaPath" class="usage-trend-area" />
                  <path v-if="usageTrendLinePath" :d="usageTrendLinePath" class="usage-trend-line" />
                  <g
                    v-for="(point, index) in usageTrendPoints"
                    :key="point.date"
                    class="usage-trend-point"
                    :class="{ selected: selectedUsageDay?.date === point.date }"
                  >
                    <line v-if="selectedUsageDay?.date === point.date" :x1="point.x" y1="14" :x2="point.x" y2="77" class="usage-trend-guide" />
                    <circle :cx="point.x" :cy="point.y" r="2.3" />
                    <title>{{ usageDayTitle(dailyUsageSeries[index]) }}</title>
                  </g>
                </svg>
                <div class="usage-trend-days">
                  <button
                    v-for="day in dailyUsageSeries"
                    :key="day.date"
                    type="button"
                    :class="{ active: selectedUsageDay?.date === day.date }"
                    :title="usageDayTitle(day)"
                    @mouseenter="selectedUsageDate = day.date"
                    @focus="selectedUsageDate = day.date"
                    @click="selectedUsageDate = day.date"
                  >
                    <span>{{ usageDayWeekday(day.date) }}</span>
                    <strong>{{ formatTokenCount(day.total.totalTokens) }}</strong>
                    <small>{{ usageDayLabel(day.date) }}</small>
                  </button>
                </div>
              </div>

              <section class="usage-daily-projects">
                <header>
                  <div>
                    <span>{{ selectedUsageDay ? `${usageDayLabel(selectedUsageDay.date)} 项目` : '项目构成' }}</span>
                    <strong>{{ selectedUsageDay ? formatTokenCount(selectedUsageDay.total.totalTokens) : '--' }}</strong>
                  </div>
                  <em>{{ selectedUsageDay?.events ?? 0 }} 次</em>
                </header>
                <div class="usage-daily-project-list">
                  <div
                    v-for="(project, index) in selectedUsageProjects"
                    :key="project.path"
                    class="usage-daily-project-row"
                    :class="`tone-${index % 5}`"
                    :title="project.path"
                  >
                    <div>
                      <span>{{ usageProjectDisplayName(project) }}</span>
                      <strong>{{ formatTokenCount(project.totalTokens) }} · {{ formatUsageShare(project) }}</strong>
                    </div>
                    <i :style="usageProjectStyle(project)" />
                  </div>
                  <div v-if="!selectedUsageProjects.length" class="usage-daily-project-empty">当天暂无 token 记录</div>
                </div>
              </section>
            </div>

            <div v-else-if="activeUsageInsight === 'reconciliation'" class="usage-reconciliation-layout">
              <div class="usage-reconciliation-summary">
                <div>
                  <span>账号累计</span>
                  <strong>{{ formatTokenCount(usageSummary?.officialUsage.lifetimeTokens ?? 0) }}</strong>
                  <small>{{ usageSummary?.officialUsage.available ? '官方账号口径' : '暂未获取' }}</small>
                </div>
                <div>
                  <span>已对账日期</span>
                  <strong>{{ reconciledUsageDays.length }} / 7</strong>
                  <small v-if="latestReliableOfficialLag">
                    最近入账 {{ formatLagMinutes(latestReliableOfficialLag.firstSeenLagMinutes) }}
                  </small>
                  <small v-else>已记录 {{ usageSummary?.officialUsage.history?.snapshotCount ?? 0 }} 个官方快照</small>
                </div>
                <div>
                  <span>本机贡献率</span>
                  <strong>{{ formatContribution(reconciliationContribution) }}</strong>
                  <small>{{ usageSummary?.device?.name ?? '当前电脑' }} · 仅统计已有官方日桶</small>
                </div>
              </div>

              <div class="usage-reconciliation-table">
                <div class="usage-reconciliation-row is-head">
                  <span>日期</span><span>本机日志</span><span>官方账号</span><span>贡献率</span><span>状态</span>
                </div>
                <div
                  v-for="day in usageReconciliationDays"
                  :key="day.date"
                  class="usage-reconciliation-row"
                  :class="reconciliationStatusClass(day)"
                >
                  <strong>{{ usageDayLabel(day.date) }}</strong>
                  <span>{{ formatTokenCount(day.localTokens) }}</span>
                  <span>{{ day.officialTokens === undefined ? '--' : formatTokenCount(day.officialTokens) }}</span>
                  <span>{{ formatContribution(day.contributionPercent) }}</span>
                  <em>{{ reconciliationStatusLabel(day) }}</em>
                </div>
              </div>
              <p class="usage-reconciliation-note">
                官方数据可能延迟；临时线程、云端任务和其他设备不会完整出现在本机日志中。
              </p>
            </div>

            <div v-else class="usage-details-layout">
              <div class="usage-rank-grid">
                <section class="usage-rank-card">
                  <h3>项目排行</h3>
                  <div v-for="project in topUsageProjects" :key="project.path" class="usage-rank-row">
                    <span :title="project.path">{{ project.name }}</span>
                    <strong :title="`最近活跃 ${compactDateTime(project.lastActive)}`">
                      {{ formatTokenCount(project.totalTokens) }} · {{ compactDay(project.lastActive) }}
                    </strong>
                  </div>
                  <div v-if="!topUsageProjects.length" class="usage-rank-row is-empty">
                    <span>暂无项目数据</span>
                    <strong>--</strong>
                  </div>
                </section>

                <section class="usage-rank-card">
                  <h3>线程排行</h3>
                  <div v-for="thread in topUsageThreads" :key="thread.id" class="usage-rank-row">
                    <span :title="`${thread.title} · ${thread.workspace}`">{{ thread.title }}</span>
                    <strong :title="`${thread.events} 次 token_count · ${compactDateTime(thread.lastActive)}`">
                      {{ formatTokenCount(thread.totalTokens) }} · {{ compactDay(thread.lastActive) }}
                    </strong>
                  </div>
                  <div v-if="!topUsageThreads.length" class="usage-rank-row is-empty">
                    <span>暂无线程数据</span>
                    <strong>--</strong>
                  </div>
                </section>

                <section class="usage-rank-card">
                  <h3>工具 / Skill</h3>
                  <div v-for="tool in topUsageTools" :key="tool.name" class="usage-rank-row">
                    <span>{{ tool.name }}</span>
                    <strong :title="`工具输出约 ${formatToolCost(tool.outputChars)}`">
                      {{ tool.calls }}次 · {{ formatToolCost(tool.outputChars) }}
                    </strong>
                  </div>
                  <div v-for="skill in topUsageSkills" :key="skill.name" class="usage-rank-row skill">
                    <span>{{ skill.name }}</span>
                    <strong>{{ skill.hits }}次</strong>
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
                  <span :title="dataQualityTitle">
                    本地完整度 {{ usageSummary?.dataQuality.score ?? 0 }}% · {{ todayUsagePeriod.events }} token_count · {{ todayUsagePeriod.toolCalls }} tools
                  </span>
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
            </div>
          </section>
        </section>
      </section>
    </main>
  </NConfigProvider>
</template>
