export type RefreshIntervalMinutes = 0 | 5 | 10
export type UpdateChannel = 'latest' | 'beta'

export interface AppSettings {
  refreshIntervalMinutes: RefreshIntervalMinutes
  hardwareDisplayEnabled: boolean
  hardwareEndpoint?: string
  cloudSyncEnabled: boolean
  cloudEndpoint: string
  updateChannel: UpdateChannel
  diagnosticsEnabled: boolean
}

export const defaultSettings: AppSettings = {
  refreshIntervalMinutes: 5,
  hardwareDisplayEnabled: true,
  cloudSyncEnabled: false,
  cloudEndpoint: 'https://codexmeter-cloud-929656937.netlify.app/api/usage',
  updateChannel: 'latest',
  diagnosticsEnabled: false
}

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return value === 'latest' || value === 'beta'
}

export function normalizeCloudEndpoint(input: string | undefined): string {
  const value = input?.trim()
  if (!value) return defaultSettings.cloudEndpoint
  const url = new URL(value)
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('Cloud endpoint must use HTTPS')
  }
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  if (!url.pathname.endsWith('/api/usage')) url.pathname = `${url.pathname}/api/usage`.replace(/\/+/g, '/')
  return url.toString().replace(/\/$/, '')
}

export function isRefreshIntervalMinutes(value: number): value is RefreshIntervalMinutes {
  return value === 0 || value === 5 || value === 10
}

export function normalizeHardwareEndpoint(input: string | undefined): string | undefined {
  const value = input?.trim()
  if (!value) {
    return undefined
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(value) ? value : `http://${value}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported hardware endpoint: ${input}`)
  }

  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''

  return url.toString().replace(/\/$/, '')
}
