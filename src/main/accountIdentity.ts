import { createHash } from 'node:crypto'
import { getCodexOAuth } from './store.js'

export function getAccountFingerprint(): string | undefined {
  const token = getCodexOAuth()
  if (!token) return undefined
  const accountId = readJwtClaim(token.accessToken, 'https://api.openai.com/auth', 'chatgpt_account_id')
    ?? readJwtClaim(token.idToken, '', 'sub')
  if (!accountId) return undefined
  return createHash('sha256').update(`codexmeter-account-v1:${accountId}`).digest('base64url')
}

function readJwtClaim(token: string | undefined, namespace: string, claim: string): string | undefined {
  const payload = token?.split('.')[1]
  if (!payload) return undefined
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const source = namespace ? decoded[namespace] as Record<string, unknown> | undefined : decoded
    return typeof source?.[claim] === 'string' ? source[claim] : undefined
  } catch {
    return undefined
  }
}
