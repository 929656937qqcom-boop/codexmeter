import { createHash } from 'node:crypto'

type BlobReader = {
  get: (key: string, options: { type: 'json' }) => Promise<unknown>
}

export interface AuthContext {
  namespace: string
  credentialType: 'master' | 'device'
  credentialHash: string
  deviceId?: string
}

export async function authenticate(req: Request, store: BlobReader): Promise<AuthContext | null> {
  const authorization = req.headers.get('authorization') ?? ''
  const master = authorization.match(/^Bearer\s+(cm_sync_[A-Za-z0-9_-]{32,})$/)
  if (master) {
    const credentialHash = hash(master[1])
    return { namespace: credentialHash, credentialType: 'master', credentialHash }
  }
  const device = authorization.match(/^Bearer\s+(cm_device_[A-Za-z0-9_-]{32,})$/)
  if (!device) return null
  const credentialHash = hash(device[1])
  const mapping = await store.get(`auth/device-tokens/${credentialHash}.json`, { type: 'json' }) as { namespace?: string; deviceId?: string } | null
  return mapping?.namespace
    ? { namespace: mapping.namespace, credentialType: 'device', credentialHash, deviceId: mapping.deviceId }
    : null
}

export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
