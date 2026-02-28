import { rebuildAIPopupRefsForInternalNotes, cleanupPopups } from '../database'
import { hasPendingIndexSync } from './sync'

function resolveBoundedMsFromEnv(
  value: string | undefined,
  fallbackMs: number,
  minMs: number,
  maxMs: number
): number {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed)) return fallbackMs
  return Math.min(Math.max(parsed, minMs), maxMs)
}

const AI_POPUP_CLEANUP_MAX_AGE_DAYS = 30
const AI_POPUP_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const AI_POPUP_STARTUP_CLEANUP_DELAY_MS = resolveBoundedMsFromEnv(
  process.env.AI_POPUP_STARTUP_CLEANUP_DELAY_MS,
  10 * 60 * 1000,
  0,
  24 * 60 * 60 * 1000
)
const AI_POPUP_STARTUP_CLEANUP_RETRY_MS = 60 * 1000

let aiPopupCleanupTimer: ReturnType<typeof setInterval> | null = null
let aiPopupStartupCleanupTimer: ReturnType<typeof setTimeout> | null = null

function runAIPopupCleanup(reason: 'startup' | 'periodic'): void {
  try {
    const rebuilt = rebuildAIPopupRefsForInternalNotes()
    if (rebuilt > 0) {
      console.log(`[AI Popup Cleanup] Rebuilt ${rebuilt} internal popup reference(s) before cleanup (${reason}).`)
    }
    const deleted = cleanupPopups(AI_POPUP_CLEANUP_MAX_AGE_DAYS)
    if (deleted > 0) {
      console.log(`[AI Popup Cleanup] Removed ${deleted} stale popup record(s) (${reason}).`)
    }
  } catch (error) {
    console.warn('[AI Popup Cleanup] Failed to cleanup stale popup records:', error)
  }
}

export function scheduleAIPopupCleanup(): void {
  if (aiPopupStartupCleanupTimer) {
    clearTimeout(aiPopupStartupCleanupTimer)
    aiPopupStartupCleanupTimer = null
  }
  if (aiPopupCleanupTimer) {
    clearInterval(aiPopupCleanupTimer)
  }
  const runStartupCleanupWhenReady = () => {
    if (hasPendingIndexSync()) {
      aiPopupStartupCleanupTimer = setTimeout(runStartupCleanupWhenReady, AI_POPUP_STARTUP_CLEANUP_RETRY_MS)
      return
    }
    aiPopupStartupCleanupTimer = null
    runAIPopupCleanup('startup')
  }
  aiPopupStartupCleanupTimer = setTimeout(runStartupCleanupWhenReady, AI_POPUP_STARTUP_CLEANUP_DELAY_MS)
  aiPopupCleanupTimer = setInterval(() => {
    runAIPopupCleanup('periodic')
  }, AI_POPUP_CLEANUP_INTERVAL_MS)
}

export function clearAIPopupCleanupTimers(): void {
  if (aiPopupStartupCleanupTimer) {
    clearTimeout(aiPopupStartupCleanupTimer)
    aiPopupStartupCleanupTimer = null
  }
  if (aiPopupCleanupTimer) {
    clearInterval(aiPopupCleanupTimer)
    aiPopupCleanupTimer = null
  }
}
