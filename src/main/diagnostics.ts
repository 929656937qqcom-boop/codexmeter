import { app, type BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import path from 'node:path'
import { getCloudSyncKey, getSettings } from './store.js'
import { getOrCreateDeviceProfile } from './deviceIdentity.js'
import type { DiagnosticEnvelope, DiagnosticEventInput } from '../shared/diagnostics.js'

const diagnosticTimeoutMs = 8_000

export function initializeMainDiagnostics(): void {
  process.on('uncaughtExceptionMonitor', (error) => {
    void reportDiagnostic({ kind: 'main-error', message: error.message, stack: error.stack, operation: 'uncaught-exception' })
  })
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    void reportDiagnostic({ kind: 'main-error', message: error.message, stack: error.stack, operation: 'unhandled-rejection' })
  })
}

export function monitorRendererDiagnostics(window: BrowserWindow): void {
  window.webContents.on('render-process-gone', (_event, details) => {
    void reportDiagnostic({
      kind: 'renderer-crash',
      message: `Renderer process exited: ${details.reason}`,
      operation: `exit-code-${details.exitCode}`
    })
  })
}

export async function reportDiagnostic(input: DiagnosticEventInput): Promise<boolean> {
  const settings = getSettings()
  const key = getCloudSyncKey()
  if (!app.isReady() || !settings.diagnosticsEnabled || !settings.cloudSyncEnabled || !key) return false

  const profile = getOrCreateDeviceProfile(
    path.join(app.getPath('userData'), 'device-profile.json'),
    new Date(),
    app.getVersion()
  )
  const envelope: DiagnosticEnvelope = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    kind: input.kind,
    message: sanitizeDiagnosticText(input.message, 500),
    stack: input.stack ? sanitizeDiagnosticText(input.stack, 3_000) : undefined,
    operation: input.operation ? sanitizeDiagnosticText(input.operation, 80) : undefined,
    device: {
      id: profile.id,
      name: profile.name,
      platform: profile.platform,
      arch: profile.arch ?? process.arch,
      appVersion: app.getVersion()
    }
  }

  try {
    const response = await fetch(diagnosticUrl(settings.cloudEndpoint), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(diagnosticTimeoutMs),
      body: JSON.stringify(envelope)
    })
    return response.ok
  } catch {
    return false
  }
}

export function sanitizeDiagnosticText(value: string, maxLength: number): string {
  const home = homedir()
  return value
    .replace(new RegExp(escapeRegExp(home), 'gi'), '<home>')
    .replace(/cm_(?:sync|device)_[A-Za-z0-9_-]{16,}/g, '<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer <redacted>')
    .replace(/https?:\/\/[^\s]+/g, '<url>')
    .slice(0, maxLength)
}

function diagnosticUrl(endpoint: string): URL {
  const url = new URL(endpoint)
  url.pathname = '/api/diagnostics'
  url.search = ''
  url.hash = ''
  return url
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
