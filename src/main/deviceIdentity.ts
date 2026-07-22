import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, hostname, platform, userInfo } from 'node:os'
import path from 'node:path'
import type { UsageDeviceProfile } from '../shared/usageAnalytics.js'

export function getOrCreateDeviceProfile(filePath: string, now = new Date(), appVersion?: string): UsageDeviceProfile {
  const currentPlatform = platform()
  const stableKey = createStableDeviceKey(currentPlatform)
  const existing = readDeviceProfile(filePath)
  if (existing) {
    const migrated = { ...existing, platform: existing.platform || currentPlatform, arch: arch(), appVersion, stableKey: existing.stableKey ?? stableKey }
    writeDeviceProfile(filePath, migrated)
    return migrated
  }

  const profile: UsageDeviceProfile = {
    id: randomUUID(),
    stableKey,
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

function createStableDeviceKey(currentPlatform: NodeJS.Platform): string {
  const machineId = readMachineId(currentPlatform) ?? [
    currentPlatform,
    arch(),
    hostname(),
    safeUserName()
  ].join('|')
  const digest = createHash('sha256')
    .update(`codexmeter-device-v1|${machineId}`)
    .digest('base64url')
    .slice(0, 43)
  return `machine_${digest}`
}

function readMachineId(currentPlatform: NodeJS.Platform): string | undefined {
  try {
    if (currentPlatform === 'win32') {
      const output = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 1500
      })
      return output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/)?.[1]?.trim()
    }

    if (currentPlatform === 'darwin') {
      const output = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        encoding: 'utf8',
        timeout: 1500
      })
      return output.match(/"IOPlatformUUID"\s+=\s+"([^"]+)"/)?.[1]?.trim()
    }

    if (currentPlatform === 'linux') {
      for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        if (!existsSync(file)) continue
        const value = readFileSync(file, 'utf8').trim()
        if (value) return value
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

function safeUserName(): string {
  try {
    return userInfo().username || ''
  } catch {
    return ''
  }
}
