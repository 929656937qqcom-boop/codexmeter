import type { UpdateChannel } from './settings.js'

export type UpdateStatus =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  currentVersion: string
  channel: UpdateChannel
  status: UpdateStatus
  availableVersion?: string
  progressPercent?: number
  checkedAt?: string
  error?: string
}
