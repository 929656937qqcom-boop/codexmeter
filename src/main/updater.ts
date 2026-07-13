import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { reportDiagnostic } from './diagnostics.js'
import type { UpdateChannel } from '../shared/settings.js'
import type { UpdateState } from '../shared/update.js'

const { autoUpdater } = electronUpdater
const updateCheckTimeoutMs = 15_000
const automaticCheckIntervalMs = 6 * 60 * 60 * 1_000

let updateState: UpdateState = {
  currentVersion: app.getVersion(),
  channel: 'latest',
  status: app.isPackaged ? 'idle' : 'unsupported'
}
let stateListener: ((state: UpdateState) => void) | undefined
let automaticCheckTimer: NodeJS.Timeout | undefined

export function initializeUpdater(channel: UpdateChannel, listener: (state: UpdateState) => void): void {
  stateListener = listener
  configureChannel(channel)
  if (!app.isPackaged) {
    setUpdateState({ status: 'unsupported' })
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: undefined }))
  autoUpdater.on('update-available', (info) => setUpdateState({ status: 'available', availableVersion: info.version }))
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'up-to-date', checkedAt: new Date().toISOString(), progressPercent: undefined }))
  autoUpdater.on('download-progress', (progress) => setUpdateState({ status: 'downloading', progressPercent: Math.round(progress.percent * 10) / 10 }))
  autoUpdater.on('update-downloaded', (info) => setUpdateState({
    status: 'downloaded',
    availableVersion: info.version,
    progressPercent: 100,
    checkedAt: new Date().toISOString()
  }))
  autoUpdater.on('error', (error) => {
    setUpdateState({ status: 'error', error: conciseError(error), checkedAt: new Date().toISOString() })
    void reportDiagnostic({ kind: 'update-error', message: error.message, stack: error.stack, operation: 'auto-update' })
  })

  const initialCheck = setTimeout(() => void checkForUpdates(), 30_000)
  initialCheck.unref()
  automaticCheckTimer = setInterval(() => void checkForUpdates(), automaticCheckIntervalMs)
  automaticCheckTimer.unref()
}

export function getUpdateState(): UpdateState {
  return { ...updateState }
}

export function changeUpdateChannel(channel: UpdateChannel): UpdateState {
  configureChannel(channel)
  setUpdateState({ status: app.isPackaged ? 'idle' : 'unsupported', availableVersion: undefined, progressPercent: undefined, error: undefined })
  return getUpdateState()
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) return getUpdateState()
  if (updateState.status === 'checking' || updateState.status === 'downloading') return getUpdateState()
  setUpdateState({ status: 'checking', error: undefined })
  try {
    await Promise.race([
      autoUpdater.checkForUpdates(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('检查更新超时')), updateCheckTimeoutMs))
    ])
  } catch (error) {
    const message = conciseError(error)
    setUpdateState({ status: 'error', error: message, checkedAt: new Date().toISOString() })
    void reportDiagnostic({ kind: 'update-error', message, operation: 'check-update' })
  }
  return getUpdateState()
}

export function installDownloadedUpdate(): boolean {
  if (updateState.status !== 'downloaded') return false
  autoUpdater.quitAndInstall(false, true)
  return true
}

function configureChannel(channel: UpdateChannel): void {
  updateState = { ...updateState, channel, currentVersion: app.getVersion() }
  if (!app.isPackaged) return
  autoUpdater.channel = channel
  autoUpdater.allowPrerelease = channel === 'beta'
  autoUpdater.allowDowngrade = false
}

function setUpdateState(patch: Partial<UpdateState>): void {
  updateState = { ...updateState, ...patch }
  stateListener?.(getUpdateState())
}

function conciseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/https?:\/\/[^\s]+/g, '<url>').slice(0, 240)
}
