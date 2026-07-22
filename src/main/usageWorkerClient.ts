import { homedir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { CodexUsageSummary } from '../shared/usageAnalytics.js'

type UsageWorkerResult =
  | { ok: true; summary: CodexUsageSummary }
  | { ok: false; error: string }

export function readCodexUsageSummaryInWorker(now = new Date()): Promise<CodexUsageSummary> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./usageWorker.js', import.meta.url), {
      workerData: {
        codexHome: path.join(homedir(), '.codex'),
        now: now.toISOString()
      }
    })
    let settled = false

    worker.once('message', (result: UsageWorkerResult) => {
      settled = true
      void worker.terminate()
      if (result.ok) resolve(result.summary)
      else reject(new Error(result.error))
    })
    worker.once('error', (error) => {
      settled = true
      reject(error)
    })
    worker.once('exit', (code) => {
      if (!settled && code !== 0) reject(new Error(`Token analysis worker exited with code ${code}`))
    })
  })
}
