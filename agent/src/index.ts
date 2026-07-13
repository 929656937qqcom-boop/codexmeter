import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, homedir, platform } from 'node:os'
import path from 'node:path'
import { readCodexUsageSummary } from '../../src/main/usageProvider.js'
import { getOrCreateDeviceProfile } from '../../src/main/deviceIdentity.js'
import { attachDeviceProfile, attachOfficialUsage, buildDeviceUsageEnvelope, type OfficialAccountUsage } from '../../src/shared/usageAnalytics.js'
import { parseOfficialAccountUsage } from '../../src/shared/accountUsage.js'

const defaultEndpoint = 'https://codexmeter-cloud-929656937.netlify.app/api/usage'
const agentHome = path.join(homedir(), '.codexmeter-agent')
const configPath = path.join(agentHome, 'config.json')
const devicePath = path.join(agentHome, 'device-profile.json')
const keychainService = 'com.codexmeter.agent'
const keychainAccount = 'sync-credential'

type AgentConfig = { endpoint: string; intervalMinutes: number; credential?: string }
type CodexAuth = { tokens?: { access_token?: string; account_id?: string } }

async function main(): Promise<void> {
  const [command = 'status', argument] = process.argv.slice(2)
  if (command === 'pair') return pair(argument ?? '')
  if (command === 'sync') return void await syncOnce()
  if (command === 'run') return run()
  if (command === 'dashboard') return openDashboard()
  if (command === 'status') return status()
  throw new Error('Usage: codexmeter-agent <pair CODE|sync|run|dashboard|status>')
}

async function pair(code: string): Promise<void> {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!/^[A-Z2-9]{8}$/.test(normalized)) throw new Error('请输入有效的 8 位配对码')
  const config = readConfig()
  const url = apiUrl(config.endpoint, 'pair')
  url.searchParams.set('code', normalized)
  const response = await fetch(url)
  const data = await response.json() as { token?: string; error?: string }
  if (!response.ok || !data.token) throw new Error(data.error ?? `配对失败 (${response.status})`)
  saveCredential(data.token)
  writeConfig({ ...config, credential: platform() === 'darwin' ? undefined : data.token })
  console.log('配对成功，正在执行首次同步...')
  await syncOnce()
}

async function syncOnce(): Promise<void> {
  const config = readConfig()
  const credential = readCredential(config)
  if (!credential) throw new Error('尚未配对，请先运行 pair 命令')
  let summary = attachDeviceProfile(
    readCodexUsageSummary(),
    getOrCreateDeviceProfile(devicePath, new Date(), 'agent-0.1.0')
  )
  const { usage, accountId } = await readOfficialUsage()
  summary = attachOfficialUsage(summary, usage)
  const syncEvents = (summary.syncEventSources ?? []).slice(-5000).map((event) => ({
    id: createHash('sha256').update(`codexmeter-event-v1:${event.source}`).digest('base64url'),
    date: event.date,
    projectName: event.projectName,
    total: event.total
  }))
  const accountFingerprint = accountId
    ? createHash('sha256').update(`codexmeter-account-v1:${accountId}`).digest('base64url')
    : undefined
  const payload = buildDeviceUsageEnvelope(summary, { accountFingerprint, syncEvents })
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json', 'User-Agent': 'CodexMeter-Agent/0.1.0' },
    body: JSON.stringify(payload)
  })
  const result = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(result.error ?? `同步失败 (${response.status})`)
  console.log(`同步成功 ${new Date().toLocaleString()} · ${platform()} ${arch()} · ${payload.syncEvents.length} 条匿名事件`)
}

async function run(): Promise<void> {
  const config = readConfig()
  for (;;) {
    try { await syncOnce() } catch (error) { console.error(error instanceof Error ? error.message : error) }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, config.intervalMinutes) * 60_000))
  }
}

function status(): void {
  const config = readConfig()
  console.log(JSON.stringify({ paired: Boolean(readCredential(config)), endpoint: config.endpoint, intervalMinutes: config.intervalMinutes, platform: platform(), arch: arch() }, null, 2))
}

function openDashboard(): void {
  const config = readConfig()
  const credential = readCredential(config)
  if (!credential) throw new Error('尚未配对')
  if (platform() === 'darwin') {
    execFileSync('/usr/bin/pbcopy', [], { input: credential })
    spawn('/usr/bin/open', [new URL(config.endpoint).origin], { detached: true, stdio: 'ignore' }).unref()
    console.log('网页看板已打开，同步凭据已复制，请粘贴到登录框。')
    return
  }
  console.log(new URL(config.endpoint).origin)
}

async function readOfficialUsage(): Promise<{ usage: OfficialAccountUsage; accountId?: string }> {
  const fetchedAt = new Date().toISOString()
  const authPath = path.join(homedir(), '.codex', 'auth.json')
  if (!existsSync(authPath)) return { usage: { available: false, fetchedAt, dailyUsage: [], error: '未找到 Codex 登录信息' } }
  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf8')) as CodexAuth
    const accessToken = auth.tokens?.access_token
    const accountId = auth.tokens?.account_id
    if (!accessToken) return { usage: { available: false, fetchedAt, dailyUsage: [], error: 'Codex 未登录' }, accountId }
    const response = await fetch('https://chatgpt.com/backend-api/wham/profiles/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'CodexMeter-Agent/0.1.0',
        'OpenAI-Beta': 'codex-1',
        originator: 'Codex Desktop',
        ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {})
      }
    })
    if (!response.ok) return { usage: { available: false, fetchedAt, dailyUsage: [], error: `官方数据请求失败 (${response.status})` }, accountId }
    return { usage: parseOfficialAccountUsage(await response.json(), fetchedAt), accountId }
  } catch (error) {
    return { usage: { available: false, fetchedAt, dailyUsage: [], error: error instanceof Error ? error.message : '读取官方数据失败' } }
  }
}

function readConfig(): AgentConfig {
  if (!existsSync(configPath)) return { endpoint: defaultEndpoint, intervalMinutes: 5 }
  try {
    const value = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<AgentConfig>
    return { endpoint: value.endpoint || defaultEndpoint, intervalMinutes: Number(value.intervalMinutes) || 5, credential: value.credential }
  } catch {
    return { endpoint: defaultEndpoint, intervalMinutes: 5 }
  }
}

function writeConfig(config: AgentConfig): void {
  mkdirSync(agentHome, { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
}

function readCredential(config: AgentConfig): string | undefined {
  if (process.env.CODEXMETER_SYNC_CREDENTIAL) return process.env.CODEXMETER_SYNC_CREDENTIAL
  if (platform() === 'darwin') {
    try {
      return execFileSync('/usr/bin/security', ['find-generic-password', '-s', keychainService, '-a', keychainAccount, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch { return undefined }
  }
  return config.credential
}

function saveCredential(credential: string): void {
  if (platform() !== 'darwin') return
  execFileSync('/usr/bin/security', ['add-generic-password', '-U', '-s', keychainService, '-a', keychainAccount, '-w', credential], { stdio: 'ignore' })
}

function apiUrl(endpoint: string, resource: string): URL {
  const url = new URL(endpoint)
  url.pathname = `/api/${resource}`
  url.search = ''
  url.hash = ''
  return url
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
