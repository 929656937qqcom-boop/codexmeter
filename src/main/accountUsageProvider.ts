import { getCodexOAuth } from './store.js'
import { parseOfficialAccountUsage } from '../shared/accountUsage.js'
import type { OfficialAccountUsage } from '../shared/usageAnalytics.js'

const profileEndpoint = 'https://chatgpt.com/backend-api/wham/profiles/me'

export async function fetchOfficialAccountUsage(): Promise<OfficialAccountUsage> {
  const fetchedAt = new Date().toISOString()
  const token = getCodexOAuth()
  if (!token?.accessToken) {
    return { available: false, fetchedAt, dailyUsage: [], error: 'Codex OAuth 未连接' }
  }

  try {
    const accountId = readJwtClaim(token.accessToken, 'https://api.openai.com/auth', 'chatgpt_account_id')
    const response = await fetch(profileEndpoint, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'CodexMeter/0.1',
        'OpenAI-Beta': 'codex-1',
        originator: 'Codex Desktop',
        ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {})
      }
    })

    if (!response.ok) {
      return { available: false, fetchedAt, dailyUsage: [], error: `官方数据请求失败 (${response.status})` }
    }

    return parseOfficialAccountUsage(await response.json(), fetchedAt)
  } catch (error) {
    return {
      available: false,
      fetchedAt,
      dailyUsage: [],
      error: error instanceof Error ? error.message : '官方数据请求失败'
    }
  }
}

function readJwtClaim(token: string, namespace: string, claim: string): string | undefined {
  const payload = token.split('.')[1]
  if (!payload) return undefined
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const json = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as Record<string, unknown>
    const group = json[namespace] as Record<string, unknown> | undefined
    return typeof group?.[claim] === 'string' ? group[claim] : undefined
  } catch {
    return undefined
  }
}
