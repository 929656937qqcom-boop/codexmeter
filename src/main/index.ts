import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, screen, session, shell, Tray } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NoopDeviceBridge } from './deviceBridge.js'
import { cancelCodexOAuth, startCodexOAuth } from './oauth.js'
import { fetchQuotaSnapshot } from './quotaProvider.js'
import { clearCodexOAuth, getCloudSyncKey, getCodexOAuth, getSettings, saveCloudSyncKey, saveSettings } from './store.js'
import { readCodexUsageSummaryInWorker } from './usageWorkerClient.js'
import { fetchOfficialAccountUsage } from './accountUsageProvider.js'
import { recordOfficialUsageSnapshot } from './accountUsageHistory.js'
import { getOrCreateDeviceProfile } from './deviceIdentity.js'
import { createCloudSyncKey, createPairingCode, redeemPairingCode, syncDeviceQuota, syncDeviceUsage, type CloudSyncResult } from './cloudSync.js'
import { initializeMainDiagnostics, monitorRendererDiagnostics, reportDiagnostic } from './diagnostics.js'
import { changeUpdateChannel, checkForUpdates, getUpdateState, initializeUpdater, installDownloadedUpdate } from './updater.js'
import { HttpDeviceBridge, type DeviceBridge } from '../shared/device.js'
import { unavailableQuotaSnapshot, type QuotaSnapshot } from '../shared/quota.js'
import { isRefreshIntervalMinutes, isUpdateChannel, normalizeCloudEndpoint, normalizeHardwareEndpoint } from '../shared/settings.js'
import { attachDeviceProfile, attachOfficialUsage, type CodexUsageSummary } from '../shared/usageAnalytics.js'
import type { DiagnosticEventInput } from '../shared/diagnostics.js'
import type { UpdateState } from '../shared/update.js'

const devServerUrl = process.env.CODEXMETER_DEV_SERVER_URL
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appIconPath = devServerUrl
  ? path.join(__dirname, '../../public/icon.png')
  : path.join(__dirname, '../../dist/icon.png')
const WIDGET_COLLAPSED_SIZE = { width: 68, height: 68 }
const WIDGET_MARGIN = 24

let mainWindow: BrowserWindow | null = null
let widgetWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let latestSnapshot: QuotaSnapshot | null = null
let widgetAlwaysOnTop = false
let deviceBridge: DeviceBridge = createDeviceBridge()
let bluetoothSelectTimer: NodeJS.Timeout | undefined
let latestCloudSync: CloudSyncResult = { synced: false }
let usageSummaryBuild: Promise<CodexUsageSummary> | undefined
let quotaRefreshInFlight: Promise<QuotaSnapshot> | undefined
let quotaRefreshTimer: NodeJS.Timeout | undefined
let promptedUpdateVersion: string | undefined
let updatePromptOpen = false

initializeMainDiagnostics()

function hardwareConnectionError(): Error {
  return new Error('无法连接外部小屏，请确认 ESP32-C3 已连接 Wi-Fi，且电脑与设备在同一局域网。')
}

function configureBluetoothPermissions(): void {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    const requestedPermission = String(permission)
    return requestedPermission === 'bluetooth' || requestedPermission === 'bluetoothScanning'
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const requestedPermission = String(permission)
    callback(requestedPermission === 'bluetooth' || requestedPermission === 'bluetoothScanning')
  })
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 920,
    minWidth: 980,
    minHeight: 820,
    useContentSize: true,
    frame: false,
    transparent: true,
    acceptFirstMouse: true,
    resizable: true,
    maximizable: true,
    title: 'CodexMeter',
    icon: appIconPath,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      experimentalFeatures: true,
      sandbox: false
    }
  })
  mainWindow.setIgnoreMouseEvents(false)
  Menu.setApplicationMenu(null)
  monitorRendererDiagnostics(mainWindow)
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault()
    if (bluetoothSelectTimer) {
      clearTimeout(bluetoothSelectTimer)
      bluetoothSelectTimer = undefined
    }

    console.info(
      'Bluetooth scan devices:',
      devices.map((device) => `${device.deviceName || '(no name)'}:${device.deviceId}`).join(', ') || '(none)'
    )

    const device =
      devices.find((item) => item.deviceName?.includes('CodexMeter')) ??
      devices.find((item) => item.deviceName?.includes('ESP32'))
    if (device) {
      callback(device.deviceId)
      return
    }

    bluetoothSelectTimer = setTimeout(() => {
      callback(devices[0]?.deviceId ?? '')
      bluetoothSelectTimer = undefined
    }, 8000)
  })

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }
  mainWindow.setIgnoreMouseEvents(false)

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
}

async function createWidgetWindow(): Promise<BrowserWindow> {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    return widgetWindow
  }

  const collapsedBounds = widgetBoundsFor(WIDGET_COLLAPSED_SIZE)
  widgetWindow = new BrowserWindow({
    width: WIDGET_COLLAPSED_SIZE.width,
    height: WIDGET_COLLAPSED_SIZE.height,
    useContentSize: true,
    x: collapsedBounds.x,
    y: collapsedBounds.y,
    resizable: false,
    maximizable: false,
    minimizable: false,
    frame: false,
    skipTaskbar: true,
    transparent: true,
    acceptFirstMouse: true,
    alwaysOnTop: widgetAlwaysOnTop,
    title: 'CodexMeter Widget',
    icon: appIconPath,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      experimentalFeatures: true,
      sandbox: false
    }
  })
  widgetWindow.setIgnoreMouseEvents(false)
  monitorRendererDiagnostics(widgetWindow)

  widgetWindow.on('closed', () => {
    widgetWindow = null
  })

  if (devServerUrl) {
    await widgetWindow.loadURL(`${devServerUrl}?view=widget`)
  } else {
    await widgetWindow.loadFile(path.join(__dirname, '../../dist/index.html'), {
      query: { view: 'widget' }
    })
  }
  widgetWindow.setIgnoreMouseEvents(false)

  return widgetWindow
}

function widgetBoundsFor(size: { width: number; height: number }): Electron.Rectangle {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    width: size.width,
    height: size.height,
    x: workArea.x + workArea.width - size.width - WIDGET_MARGIN,
    y: workArea.y + workArea.height - size.height - WIDGET_MARGIN
  }
}

async function showMainWindow(): Promise<{ visible: boolean }> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow()
  }

  if (!mainWindow) {
    return { visible: false }
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.setIgnoreMouseEvents(false)
  mainWindow.show()
  mainWindow.focus()

  return { visible: mainWindow.isVisible() }
}

function createTray(): void {
  const image = nativeImage.createFromPath(appIconPath).resize({ width: 16, height: 16 })
  if (process.platform === 'darwin') image.setTemplateImage(true)
  tray = new Tray(image)
  tray.setToolTip('CodexMeter')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 CodexMeter', click: () => void showMainWindow() },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', () => void showMainWindow())
}

function refreshQuotaAndBroadcast(): Promise<QuotaSnapshot> {
  if (quotaRefreshInFlight) return quotaRefreshInFlight

  const run = (async () => {
    const snapshot = await fetchQuotaSnapshot()
    try {
      await deviceBridge.sendSnapshot(snapshot)
      broadcastHardwarePush()
    } catch (error) {
      console.warn('Hardware display push failed:', error)
    }
    broadcastQuotaSnapshot(snapshot)
    queueCloudQuotaSync(snapshot)
    return snapshot
  })()

  quotaRefreshInFlight = run.finally(() => {
    quotaRefreshInFlight = undefined
  })
  return quotaRefreshInFlight
}

function configureQuotaRefreshSchedule(): void {
  if (quotaRefreshTimer) {
    clearInterval(quotaRefreshTimer)
    quotaRefreshTimer = undefined
  }

  const minutes = getSettings().refreshIntervalMinutes
  if (minutes === 0) return
  quotaRefreshTimer = setInterval(() => refreshQuotaInBackground('scheduled-refresh'), minutes * 60 * 1_000)
  quotaRefreshTimer.unref()
}

function refreshQuotaInBackground(operation: string): void {
  void refreshQuotaAndBroadcast().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    void reportDiagnostic({ kind: 'main-error', message, operation })
  })
}

function isLatestSnapshotFresh(): boolean {
  if (!latestSnapshot) return false
  const refreshedAt = new Date(latestSnapshot.refreshedAt).getTime()
  if (!Number.isFinite(refreshedAt)) return false
  const minutes = getSettings().refreshIntervalMinutes
  if (minutes === 0) return true
  return Date.now() - refreshedAt < minutes * 60 * 1_000
}

function queueCloudQuotaSync(snapshot: QuotaSnapshot): void {
  const settings = getSettings()
  if (!settings.cloudSyncEnabled || !getCloudSyncKey()) return
  const profile = getOrCreateDeviceProfile(path.join(app.getPath('userData'), 'device-profile.json'), new Date(), app.getVersion())
  void syncDeviceQuota(settings.cloudEndpoint, profile.id, snapshot).then((result) => {
    latestCloudSync = result
    if (!result.synced && result.error) {
      void reportDiagnostic({ kind: 'cloud-sync-error', message: result.error, operation: 'sync-device-quota' })
    }
  })
}

async function pushLatestSnapshotToDevice(): Promise<{ pushed: boolean; pushedAt: string }> {
  const snapshot = latestSnapshot ?? await fetchQuotaSnapshot()
  await deviceBridge.sendSnapshot(snapshot)
  const pushedAt = broadcastHardwarePush()
  if (!latestSnapshot) {
    broadcastQuotaSnapshot(snapshot)
  }

  return { pushed: true, pushedAt }
}

function broadcastHardwarePush(): string {
  const pushedAt = new Date().toISOString()
  mainWindow?.webContents.send('hardware:pushUpdated', pushedAt)
  widgetWindow?.webContents.send('hardware:pushUpdated', pushedAt)
  return pushedAt
}

function createDeviceBridge(): DeviceBridge {
  const settings = getSettings()
  if (settings.hardwareDisplayEnabled && settings.hardwareEndpoint) {
    return new HttpDeviceBridge(settings.hardwareEndpoint)
  }

  return new NoopDeviceBridge()
}

function broadcastQuotaSnapshot(snapshot: QuotaSnapshot): void {
  latestSnapshot = snapshot
  mainWindow?.webContents.send('quota:updated', snapshot)
  widgetWindow?.webContents.send('quota:updated', snapshot)
}

ipcMain.handle('quota:refresh', async () => refreshQuotaAndBroadcast())

function buildUsageSummary(): Promise<CodexUsageSummary> {
  if (usageSummaryBuild) return usageSummaryBuild

  const now = new Date()
  const run = Promise.all([
    readCodexUsageSummaryInWorker(now),
    fetchOfficialAccountUsage()
  ]).then(([summary, officialSnapshot]) => {
    const localSummary = attachDeviceProfile(
      summary,
      getOrCreateDeviceProfile(path.join(app.getPath('userData'), 'device-profile.json'), now, app.getVersion())
    )
    const officialUsage = recordOfficialUsageSnapshot(
      path.join(app.getPath('userData'), 'official-usage-history.json'),
      officialSnapshot
    )
    return attachOfficialUsage(localSummary, officialUsage)
  })

  usageSummaryBuild = run.finally(() => {
    usageSummaryBuild = undefined
  })
  return usageSummaryBuild
}

async function syncCloudUsage(summary?: CodexUsageSummary): Promise<CloudSyncResult> {
  const settings = getSettings()
  if (!settings.cloudSyncEnabled || !getCloudSyncKey()) return { synced: false, error: '云端同步尚未开启' }
  const currentSummary = summary ?? await buildUsageSummary()
  latestCloudSync = await syncDeviceUsage(settings.cloudEndpoint, currentSummary, latestSnapshot ?? undefined)
  if (!latestCloudSync.synced && latestCloudSync.error) {
    void reportDiagnostic({ kind: 'cloud-sync-error', message: latestCloudSync.error, operation: 'sync-device-usage' })
  }
  return latestCloudSync
}

ipcMain.handle('usage:summary', async () => {
  const summary = await buildUsageSummary()
  const settings = getSettings()
  if (settings.cloudSyncEnabled && getCloudSyncKey()) {
    await syncCloudUsage(summary)
  }
  return summary
})

ipcMain.handle('quota:latest', async () => {
  if (isLatestSnapshotFresh() && latestSnapshot) {
    return latestSnapshot
  }

  return refreshQuotaAndBroadcast()
})

ipcMain.handle('settings:get', () => getSettings())

ipcMain.handle('settings:saveRefreshInterval', (_event, minutes: number) => {
  if (!isRefreshIntervalMinutes(minutes)) {
    throw new Error(`Unsupported refresh interval: ${minutes}`)
  }

  const settings = saveSettings({
    ...getSettings(),
    refreshIntervalMinutes: minutes
  })
  configureQuotaRefreshSchedule()
  return settings
})

ipcMain.handle('settings:saveDiagnostics', (_event, enabled: boolean) => saveSettings({
  ...getSettings(),
  diagnosticsEnabled: Boolean(enabled)
}))

ipcMain.handle('settings:saveHardwareDisplay', (_event, enabled: boolean, endpoint?: string) => {
  const hardwareEndpoint = normalizeHardwareEndpoint(endpoint)
  const nextSettings = saveSettings({
    ...getSettings(),
    hardwareDisplayEnabled: Boolean(enabled && hardwareEndpoint),
    hardwareEndpoint
  })
  deviceBridge = createDeviceBridge()
  return nextSettings
})

ipcMain.handle('cloud:get', () => {
  const settings = getSettings()
  return {
    enabled: settings.cloudSyncEnabled,
    endpoint: settings.cloudEndpoint,
    syncKey: getCloudSyncKey(),
    ...latestCloudSync
  }
})

ipcMain.handle('cloud:generateKey', () => ({ syncKey: saveCloudSyncKey(createCloudSyncKey()) }))
ipcMain.handle('cloud:createPairingCode', () => createPairingCode(getSettings().cloudEndpoint))
ipcMain.handle('cloud:redeemPairingCode', async (_event, code: string) => ({ syncKey: saveCloudSyncKey(await redeemPairingCode(getSettings().cloudEndpoint, code)) }))

ipcMain.handle('cloud:save', (_event, enabled: boolean, endpoint: string, syncKey?: string) => {
  const normalizedEndpoint = normalizeCloudEndpoint(endpoint)
  let key = syncKey?.trim() || getCloudSyncKey()
  if (key && !/^cm_(?:sync|device)_[A-Za-z0-9_-]{32,}$/.test(key)) throw new Error('同步凭据格式不正确')
  if (enabled && !key) key = saveCloudSyncKey(createCloudSyncKey())
  else if (key) saveCloudSyncKey(key)
  const settings = saveSettings({
    ...getSettings(),
    cloudSyncEnabled: Boolean(enabled),
    cloudEndpoint: normalizedEndpoint
  })
  return { enabled: settings.cloudSyncEnabled, endpoint: settings.cloudEndpoint, syncKey: key, ...latestCloudSync }
})

ipcMain.handle('cloud:syncNow', async () => {
  return syncCloudUsage()
})

ipcMain.handle('cloud:openDashboard', async () => {
  const settings = getSettings()
  if (!getCloudSyncKey()) throw new Error('请先建立云端账号凭证')
  const pairing = await createPairingCode(settings.cloudEndpoint)
  const dashboard = new URL(settings.cloudEndpoint)
  dashboard.pathname = '/'
  dashboard.searchParams.set('pair', pairing.code)
  dashboard.hash = ''
  await shell.openExternal(dashboard.toString())
  void buildUsageSummary()
    .then((summary) => syncCloudUsage(summary))
    .catch((error) => {
      latestCloudSync = { synced: false, error: error instanceof Error ? error.message : '后台同步失败' }
    })
  return { opened: true }
})

ipcMain.handle('devices:list', () => deviceBridge.listDevices())
ipcMain.handle('devices:pushLatest', () => pushLatestSnapshotToDevice())
ipcMain.handle('devices:ping', async (_event, endpoint: string) => {
  const bridge = new HttpDeviceBridge(endpoint)
  if (!(await bridge.ping())) {
    throw hardwareConnectionError()
  }

  return { connected: true }
})
ipcMain.handle('devices:pushTest', async (_event, endpoint: string) => {
  const bridge = new HttpDeviceBridge(endpoint)
  await bridge.sendTestPayload()
  const pushedAt = broadcastHardwarePush()
  return { pushed: true, pushedAt }
})

ipcMain.handle('oauth:status', () => {
  const token = getCodexOAuth()
  return {
    connected: Boolean(token?.accessToken),
    email: token?.email
  }
})

ipcMain.handle('oauth:connect', async (_event, forceLogin?: boolean) => startCodexOAuth(Boolean(forceLogin)))
ipcMain.handle('oauth:cancel', () => cancelCodexOAuth())

ipcMain.handle('oauth:disconnect', async () => {
  clearCodexOAuth()
  const snapshot = unavailableQuotaSnapshot()
  broadcastQuotaSnapshot(snapshot)
  return { connected: false, snapshot }
})

ipcMain.handle('window:minimizeMain', () => {
  mainWindow?.minimize()
  return { minimized: Boolean(mainWindow?.isMinimized()) }
})

ipcMain.handle('window:closeMain', () => {
  mainWindow?.close()
  return { visible: Boolean(mainWindow?.isVisible()) }
})

ipcMain.handle('widget:state', () => ({
  visible: Boolean(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()),
  alwaysOnTop: widgetAlwaysOnTop
}))

ipcMain.handle('widget:setVisible', async (_event, visible: boolean, alwaysOnTop?: boolean) => {
  widgetAlwaysOnTop = Boolean(alwaysOnTop)

  if (visible) {
    const window = await createWidgetWindow()
    window.setAlwaysOnTop(widgetAlwaysOnTop)
    window.setIgnoreMouseEvents(false)
    window.show()
  } else if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.hide()
  }

  return {
    visible: Boolean(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()),
    alwaysOnTop: widgetAlwaysOnTop
  }
})

ipcMain.handle('widget:setAlwaysOnTop', (_event, enabled: boolean) => {
  widgetAlwaysOnTop = Boolean(enabled)
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.setAlwaysOnTop(widgetAlwaysOnTop)
  }

  return {
    visible: Boolean(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()),
    alwaysOnTop: widgetAlwaysOnTop
  }
})

ipcMain.handle('widget:openMainWindow', async () => showMainWindow())

ipcMain.handle('diagnostics:report', (_event, input: DiagnosticEventInput) => reportDiagnostic(input))

ipcMain.handle('updates:get', () => getUpdateState())
ipcMain.handle('updates:check', () => checkForUpdates())
ipcMain.handle('updates:setChannel', (_event, channel: unknown) => {
  if (!isUpdateChannel(channel)) throw new Error('不支持的更新通道')
  saveSettings({ ...getSettings(), updateChannel: channel })
  return changeUpdateChannel(channel)
})
ipcMain.handle('updates:install', () => {
  isQuitting = true
  return { installing: installDownloadedUpdate() }
})

function broadcastUpdateState(state: UpdateState): void {
  mainWindow?.webContents.send('updates:state', state)
  widgetWindow?.webContents.send('updates:state', state)
  if (state.status === 'downloaded') {
    void promptForDownloadedUpdate(state)
  }
}

async function promptForDownloadedUpdate(state: UpdateState): Promise<void> {
  const version = state.availableVersion
  if (!version || updatePromptOpen || promptedUpdateVersion === version) return

  promptedUpdateVersion = version
  updatePromptOpen = true
  try {
    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'CodexMeter 更新',
      message: `CodexMeter v${version} 已准备好`,
      detail: '更新已在后台下载完成。现在重启即可自动安装，也可以稍后再处理。',
      buttons: ['重启并安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (result.response === 0) {
      isQuitting = true
      installDownloadedUpdate()
    }
  } finally {
    updatePromptOpen = false
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromPath(appIconPath))
  if (app.getVersion().includes('-beta') && getSettings().updateChannel !== 'beta') {
    saveSettings({ ...getSettings(), updateChannel: 'beta' })
  }
  configureBluetoothPermissions()
  const window = await createWidgetWindow()
  window.show()
  createTray()
  configureQuotaRefreshSchedule()
  powerMonitor.on('resume', () => refreshQuotaInBackground('system-resume'))
  powerMonitor.on('unlock-screen', () => refreshQuotaInBackground('screen-unlock'))
  initializeUpdater(getSettings().updateChannel, broadcastUpdateState)
})

app.on('activate', () => {
  void showMainWindow()
})
