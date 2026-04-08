const LOCAL_PERF_STARTUP_WINDOW_MS = Number.isFinite(Number(process.env.LOCAL_PERF_STARTUP_WINDOW_MS))
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_PERF_STARTUP_WINDOW_MS)))
  : (process.env.NODE_ENV === 'test' ? 0 : 45_000)

const localPerfBootAtMs = Date.now()

export interface StartupPhaseState {
  bootAtMs: number
  nowMs: number
  elapsedMs: number
  windowMs: number
  inStartupPhase: boolean
}

export function getStartupPhaseState(nowMs: number = Date.now()): StartupPhaseState {
  const elapsedMs = Math.max(0, nowMs - localPerfBootAtMs)
  const windowMs = LOCAL_PERF_STARTUP_WINDOW_MS
  return {
    bootAtMs: localPerfBootAtMs,
    nowMs,
    elapsedMs,
    windowMs,
    inStartupPhase: windowMs > 0 && elapsedMs < windowMs,
  }
}

