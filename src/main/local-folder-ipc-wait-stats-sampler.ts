import type {
  LocalFolderIpcRuntimeWaitStatsSnapshot,
} from './local-folder-ipc-runtime'
import {
  emitLocalFolderIpcWaitAlertAudit,
  emitLocalFolderIpcWaitStatsAudit,
  type LocalFolderIpcWaitAlertItem,
} from './local-folder-audit'

export type LocalFolderIpcWaitStatsFlushReason = 'interval' | 'before_quit' | 'will_quit'

export interface LocalFolderIpcWaitStatsRuntime {
  getWaitStatsSnapshot: () => LocalFolderIpcRuntimeWaitStatsSnapshot
  resetWaitStats: () => void
}

export interface LocalFolderIpcWaitStatsLogger {
  info: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
}

export interface LocalFolderIpcWaitStatsAlertOptions {
  enabled?: boolean
  minSampleCount?: number
  maxWaitMs?: number
  avgWaitMs?: number
  slowRatio?: number
  logWindowMs?: number
  maxSignatures?: number
}

export interface LocalFolderIpcWaitStatsSamplerOptions {
  enabled: boolean
  intervalMs: number
  getRuntime: () => LocalFolderIpcWaitStatsRuntime | null
  alert?: LocalFolderIpcWaitStatsAlertOptions
  logger?: LocalFolderIpcWaitStatsLogger
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

export interface LocalFolderIpcWaitStatsSampler {
  start: () => void
  stop: () => void
  flush: (reason: LocalFolderIpcWaitStatsFlushReason) => void
}

export function createLocalFolderIpcWaitStatsSampler(
  options: LocalFolderIpcWaitStatsSamplerOptions
): LocalFolderIpcWaitStatsSampler {
  const logger = options.logger ?? console
  const setIntervalFn = options.setIntervalFn ?? setInterval
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval

  const alertEnabled = options.alert?.enabled !== false
  const alertMinSampleCount = Number.isFinite(options.alert?.minSampleCount)
    ? Math.max(1, Math.floor(options.alert?.minSampleCount as number))
    : 5
  const alertMaxWaitMs = Number.isFinite(options.alert?.maxWaitMs)
    ? Math.max(0, options.alert?.maxWaitMs as number)
    : 2_000
  const alertAvgWaitMs = Number.isFinite(options.alert?.avgWaitMs)
    ? Math.max(0, options.alert?.avgWaitMs as number)
    : 500
  const alertSlowRatio = Number.isFinite(options.alert?.slowRatio)
    ? Math.min(1, Math.max(0, options.alert?.slowRatio as number))
    : 0.3
  const alertLogWindowMs = Number.isFinite(options.alert?.logWindowMs)
    ? Math.max(0, options.alert?.logWindowMs as number)
    : 5 * 60 * 1000
  const alertMaxSignatures = Number.isFinite(options.alert?.maxSignatures)
    ? Math.max(1, Math.floor(options.alert?.maxSignatures as number))
    : 512

  let timer: ReturnType<typeof setInterval> | null = null
  const alertLogState = new Map<
    string,
    {
      lastLoggedAt: number
      lastObservedAt: number
      suppressedCount: number
      maxSuppressedWaitMs: number
      maxSuppressedAverageWaitMs: number
      maxSuppressedSlowRatio: number
      suppressedReasons: Set<string>
    }
  >()

  type LocalFolderIpcWaitStatsAlertCandidate = LocalFolderIpcWaitAlertItem

  function safeLogError(message: string, error: unknown): void {
    try {
      logger.error(message, error)
    } catch {
      // Observability logger failures must never affect app behavior.
    }
  }

  function buildAlertSignature(candidate: LocalFolderIpcWaitStatsAlertCandidate): string {
    return JSON.stringify([candidate.operation, candidate.phase])
  }

  function trimAlertLogStateIfNeeded(nowMs: number): void {
    if (alertLogState.size <= alertMaxSignatures) {
      return
    }
    const entriesByOldest = Array.from(alertLogState.entries())
      .sort((a, b) => a[1].lastObservedAt - b[1].lastObservedAt)
    for (const [signature, state] of entriesByOldest) {
      const idleMs = nowMs - state.lastObservedAt
      if (alertLogState.size <= alertMaxSignatures) {
        break
      }
      if (idleMs < alertLogWindowMs) {
        continue
      }
      alertLogState.delete(signature)
    }
    if (alertLogState.size <= alertMaxSignatures) {
      return
    }
    for (const [signature] of entriesByOldest) {
      if (alertLogState.size <= alertMaxSignatures) {
        break
      }
      alertLogState.delete(signature)
    }
  }

  function maybeEmitAlert(
    candidate: LocalFolderIpcWaitStatsAlertCandidate,
    observedAtMs: number
  ): (LocalFolderIpcWaitStatsAlertCandidate & { suppressedCount?: number }) | null {
    const signature = buildAlertSignature(candidate)
    const previousState = alertLogState.get(signature)
    if (!previousState) {
      alertLogState.set(signature, {
        lastLoggedAt: observedAtMs,
        lastObservedAt: observedAtMs,
        suppressedCount: 0,
        maxSuppressedWaitMs: 0,
        maxSuppressedAverageWaitMs: 0,
        maxSuppressedSlowRatio: 0,
        suppressedReasons: new Set<string>(),
      })
      trimAlertLogStateIfNeeded(observedAtMs)
      return candidate
    }

    previousState.lastObservedAt = observedAtMs
    if (observedAtMs - previousState.lastLoggedAt < alertLogWindowMs) {
      previousState.suppressedCount += 1
      previousState.maxSuppressedWaitMs = Math.max(previousState.maxSuppressedWaitMs, candidate.maxWaitMs)
      previousState.maxSuppressedAverageWaitMs = Math.max(previousState.maxSuppressedAverageWaitMs, candidate.averageWaitMs)
      previousState.maxSuppressedSlowRatio = Math.max(previousState.maxSuppressedSlowRatio, candidate.slowRatio)
      for (const reason of candidate.reasons) {
        previousState.suppressedReasons.add(reason)
      }
      return null
    }

    const suppressedCount = previousState.suppressedCount
    const mergedReasons = Array.from(new Set([
      ...candidate.reasons,
      ...Array.from(previousState.suppressedReasons),
    ]))
    const mergedCandidate: LocalFolderIpcWaitStatsAlertCandidate & { suppressedCount?: number } = {
      ...candidate,
      maxWaitMs: Math.max(candidate.maxWaitMs, previousState.maxSuppressedWaitMs),
      averageWaitMs: Math.max(candidate.averageWaitMs, previousState.maxSuppressedAverageWaitMs),
      slowRatio: Math.max(candidate.slowRatio, previousState.maxSuppressedSlowRatio),
      reasons: mergedReasons,
      ...(suppressedCount > 0 ? { suppressedCount } : {}),
    }

    previousState.lastLoggedAt = observedAtMs
    previousState.suppressedCount = 0
    previousState.maxSuppressedWaitMs = 0
    previousState.maxSuppressedAverageWaitMs = 0
    previousState.maxSuppressedSlowRatio = 0
    previousState.suppressedReasons.clear()
    return mergedCandidate
  }

  function logAlerts(snapshot: LocalFolderIpcRuntimeWaitStatsSnapshot): void {
    if (!alertEnabled) {
      return
    }
    const candidates = snapshot.entries
      .filter((entry) => entry.count >= alertMinSampleCount)
      .map((entry) => {
        const averageWaitMs = entry.count > 0 ? entry.totalWaitMs / entry.count : 0
        const slowRatio = entry.count > 0 ? entry.slowCount / entry.count : 0
        const reasons: string[] = []
        if (entry.maxWaitMs >= alertMaxWaitMs) {
          reasons.push('max_wait_ms')
        }
        if (averageWaitMs >= alertAvgWaitMs) {
          reasons.push('avg_wait_ms')
        }
        if (slowRatio >= alertSlowRatio) {
          reasons.push('slow_ratio')
        }
        if (reasons.length === 0) {
          return null
        }
        return {
          operation: entry.operation,
          phase: entry.phase,
          count: entry.count,
          slowCount: entry.slowCount,
          maxWaitMs: entry.maxWaitMs,
          averageWaitMs,
          slowRatio,
          reasons,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

    if (candidates.length === 0) {
      return
    }

    const alerts = candidates
      .map((candidate) => maybeEmitAlert(candidate, snapshot.collectedAt))
      .filter((alert): alert is NonNullable<typeof alert> => alert !== null)

    if (alerts.length === 0) {
      return
    }

    emitLocalFolderIpcWaitAlertAudit(logger, {
      collected_at_ms: snapshot.collectedAt,
      alert_count: alerts.length,
      thresholds: {
        min_sample_count: alertMinSampleCount,
        max_wait_ms: alertMaxWaitMs,
        avg_wait_ms: alertAvgWaitMs,
        slow_ratio: alertSlowRatio,
      },
      alerts,
    }, snapshot.collectedAt)
  }

  function flush(reason: LocalFolderIpcWaitStatsFlushReason): void {
    const runtime = options.getRuntime()
    if (!runtime) return

    let snapshot: LocalFolderIpcRuntimeWaitStatsSnapshot
    try {
      snapshot = runtime.getWaitStatsSnapshot()
    } catch (error) {
      safeLogError('[localFolder:ipcRuntime] failed to collect wait stats snapshot:', error)
      return
    }

    if (snapshot.entries.length === 0) {
      return
    }

    try {
      emitLocalFolderIpcWaitStatsAudit(logger, {
        reason,
        collected_at_ms: snapshot.collectedAt,
        entry_count: snapshot.entries.length,
        entries: snapshot.entries,
      }, snapshot.collectedAt)
    } catch (error) {
      safeLogError('[localFolder:ipcRuntime] failed to emit wait stats audit:', error)
    }

    try {
      logAlerts(snapshot)
    } catch (error) {
      safeLogError('[localFolder:ipcRuntime] failed to emit wait alert audit:', error)
    }

    try {
      runtime.resetWaitStats()
    } catch (error) {
      safeLogError('[localFolder:ipcRuntime] failed to reset wait stats:', error)
    }
  }

  function stop(): void {
    if (!timer) return
    clearIntervalFn(timer)
    timer = null
  }

  function start(): void {
    if (!options.enabled) return
    if (timer) return

    timer = setIntervalFn(() => {
      flush('interval')
    }, options.intervalMs)
    timer.unref?.()
  }

  return {
    start,
    stop,
    flush,
  }
}
