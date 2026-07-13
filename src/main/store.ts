import { safeStorage } from 'electron'
import Store from 'electron-store'
import { defaultSettings, type AppSettings } from '../shared/settings.js'

type CodexOAuthToken = {
  accessToken: string
  refreshToken: string
  idToken?: string
  expiresAt: string
  email?: string
}

type EncryptedCodexOAuthToken = {
  encrypted: true
  payload: string
}

type EncryptedSecret = {
  encrypted: true
  payload: string
}

type StoreSchema = {
  settings: AppSettings
  codexOAuth?: CodexOAuthToken | EncryptedCodexOAuthToken
  cloudSyncKey?: string | EncryptedSecret
}

const store = new Store<StoreSchema>({
  name: 'codexmeter',
  clearInvalidConfig: true,
  configFileMode: 0o600,
  defaults: {
    settings: defaultSettings
  }
})

export function getSettings(): AppSettings {
  return { ...defaultSettings, ...store.get('settings', defaultSettings) }
}

export function saveSettings(settings: AppSettings): AppSettings {
  store.set('settings', settings)
  return settings
}

export function getCodexOAuth(): CodexOAuthToken | undefined {
  const token = store.get('codexOAuth')
  if (!token) {
    return undefined
  }

  if (isEncryptedCodexOAuthToken(token)) {
    const decryptedToken = decryptCodexOAuth(token)
    if (!decryptedToken) {
      store.delete('codexOAuth')
      return undefined
    }

    return decryptedToken
  }

  store.set('codexOAuth', encryptCodexOAuth(token))
  return token
}

export function saveCodexOAuth(token: CodexOAuthToken) {
  store.set('codexOAuth', encryptCodexOAuth(token))
  return token
}

export function clearCodexOAuth(): void {
  store.delete('codexOAuth')
}

export function getCloudSyncKey(): string | undefined {
  const secret = store.get('cloudSyncKey')
  if (!secret) return undefined
  if (typeof secret === 'string') {
    saveCloudSyncKey(secret)
    return secret
  }
  if (!safeStorage.isEncryptionAvailable()) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(secret.payload, 'base64'))
  } catch {
    store.delete('cloudSyncKey')
    return undefined
  }
}

export function saveCloudSyncKey(secret: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    store.set('cloudSyncKey', {
      encrypted: true,
      payload: safeStorage.encryptString(secret).toString('base64')
    })
  } else {
    store.set('cloudSyncKey', secret)
  }
  return secret
}

function encryptCodexOAuth(token: CodexOAuthToken): EncryptedCodexOAuthToken | CodexOAuthToken {
  if (!safeStorage.isEncryptionAvailable()) {
    return token
  }

  return {
    encrypted: true,
    payload: safeStorage.encryptString(JSON.stringify(token)).toString('base64')
  }
}

function decryptCodexOAuth(token: EncryptedCodexOAuthToken): CodexOAuthToken | undefined {
  if (!safeStorage.isEncryptionAvailable()) {
    return undefined
  }

  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(token.payload, 'base64'))) as CodexOAuthToken
  } catch {
    return undefined
  }
}

function isEncryptedCodexOAuthToken(token: StoreSchema['codexOAuth']): token is EncryptedCodexOAuthToken {
  return Boolean(token && 'encrypted' in token && token.encrypted === true)
}
