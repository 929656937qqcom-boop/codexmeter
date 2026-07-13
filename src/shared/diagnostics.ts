export type DiagnosticKind =
  | 'main-error'
  | 'renderer-error'
  | 'renderer-crash'
  | 'cloud-sync-error'
  | 'update-error'

export interface DiagnosticEventInput {
  kind: DiagnosticKind
  message: string
  stack?: string
  operation?: string
}

export interface DiagnosticEnvelope extends DiagnosticEventInput {
  schemaVersion: 1
  createdAt: string
  device: {
    id: string
    name: string
    platform: string
    arch: string
    appVersion: string
  }
}
