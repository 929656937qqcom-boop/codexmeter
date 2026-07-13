import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, hostname, platform } from 'node:os'
import path from 'node:path'
import type { UsageDeviceProfile } from '../shared/usageAnalytics.js'

export function getOrCreateDeviceProfile(filePath: string, now = new Date(), appVersion?: string): UsageDeviceProfile {
  const existing = readDeviceProfile(filePath)
  if (existing) {
    const migrated = { ...existing, arch: arch(), appVersion }
    writeDeviceProfile(filePath, migrated)
    return migrated
  }

  const currentPlatform = platform()
  const profile: UsageDeviceProfile = {
    id: randomUUID(),
    name: hostname() || (currentPlatform === 'darwin' ? 'Mac' : currentPlatform === 'win32' ? 'Windows 电脑' : '电脑'),
    platform: currentPlatform,
    arch: arch(),
    appVersion,
    createdAt: now.toISOString()
  }
  writeDeviceProfile(filePath, profile)
  return profile
}

function writeDeviceProfile(filePath: string, profile: UsageDeviceProfile): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(profile, null, 2), { encoding: 'utf8', mode: 0o600 })
}

function readDeviceProfile(filePath: string): UsageDeviceProfile | undefined {
  if (!existsSync(filePath)) return undefined
  try {
    const profile = JSON.parse(readFileSync(filePath, 'utf8')) as UsageDeviceProfile
    if (profile.id && profile.name && profile.platform && profile.createdAt) return profile
  } catch {
    return undefined
  }
  return undefined
}
