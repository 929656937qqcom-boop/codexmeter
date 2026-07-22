import { parentPort, workerData } from 'node:worker_threads'
import { readCodexUsageSummaryFromCodexHome } from './usageProvider.js'

type UsageWorkerInput = {
  codexHome: string
  now: string
}

type UsageWorkerResult =
  | { ok: true; summary: ReturnType<typeof readCodexUsageSummaryFromCodexHome> }
  | { ok: false; error: string }

const input = workerData as UsageWorkerInput

try {
  const summary = readCodexUsageSummaryFromCodexHome(input.codexHome, new Date(input.now))
  parentPort?.postMessage({ ok: true, summary } satisfies UsageWorkerResult)
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : 'Token analysis failed'
  } satisfies UsageWorkerResult)
}
