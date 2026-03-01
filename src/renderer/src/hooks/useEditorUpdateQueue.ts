import { useCallback, useEffect, useRef } from 'react'
import type { Note } from '../types/note'
import { toast } from '../utils/toast'
import type { EditorNoteUpdate } from './editor-update-types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EDITOR_UPDATE_RETRY_BASE_MS = 200
const EDITOR_UPDATE_RETRY_MAX_MS = 3000
const EDITOR_UPDATE_FAILURE_PAUSE_THRESHOLD = 10
const EDITOR_UPDATE_FAILURE_PAUSE_MS = 30000
const FLUSH_WAIT_TIMEOUT_MS = 2500
const FLUSH_TIMEOUT_TOAST_COOLDOWN_MS = 4000
const RETRY_PAUSE_TOAST_COOLDOWN_MS = 10000

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Hook options & return type
// ---------------------------------------------------------------------------

export interface UseEditorUpdateQueueOptions {
  notesRef: React.MutableRefObject<Note[]>
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  isZh: boolean
}

export interface EditorUpdateQueueAPI {
  pendingEditorUpdatesRef: React.MutableRefObject<Map<string, EditorNoteUpdate>>
  flushQueuedEditorUpdates: (noteId: string | null, timeoutMs?: number) => Promise<boolean>
  flushQueuedEditorUpdatesForNotes: (noteIds: string[], timeoutMs?: number) => Promise<boolean>
  flushQueuedEditorUpdatesRef: React.MutableRefObject<
    (noteId: string | null, timeoutMs?: number) => Promise<boolean>
  >
  processEditorUpdateQueue: (noteId: string) => Promise<void>
  mergeAndSetPendingEditorUpdate: (noteId: string, basePatch: EditorNoteUpdate) => EditorNoteUpdate
  clearEditorUpdateRuntimeState: (noteId: string, keepPending?: boolean) => void
  clearAllEditorUpdateResumeTimers: () => void
  notifyFlushTimeout: () => void
  notifyFlushRequired: () => void
  applyNonEditorNotePatch: (id: string, patch: Partial<NoteInput>) => Promise<Note | null>
  triggerIndexCheck: (noteId: string | null, fallbackNote?: Note | null) => void
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useEditorUpdateQueue(options: UseEditorUpdateQueueOptions): EditorUpdateQueueAPI {
  const { notesRef, setNotes, isZh } = options

  // --- Refs (internal) ---
  const pendingEditorUpdatesRef = useRef<Map<string, EditorNoteUpdate>>(new Map())
  const editorUpdateInFlightRef = useRef<Set<string>>(new Set())
  const editorUpdateWaitersRef = useRef<Map<string, Array<() => void>>>(new Map())
  const editorUpdateRetryCountRef = useRef<Map<string, number>>(new Map())
  const editorUpdatePausedUntilRef = useRef<Map<string, number>>(new Map())
  const editorUpdateResumeTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const lastFlushTimeoutToastAtRef = useRef(0)
  const lastRetryPauseToastAtRef = useRef(0)
  const indexCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- Waiter helpers ---

  const resolveEditorUpdateWaiters = useCallback((noteId: string) => {
    const waiters = editorUpdateWaitersRef.current.get(noteId)
    if (!waiters || waiters.length === 0) return
    editorUpdateWaitersRef.current.delete(noteId)
    waiters.forEach((resolve) => resolve())
  }, [])

  const addEditorUpdateWaiter = useCallback((noteId: string, waiter: () => void) => {
    const waiters = editorUpdateWaitersRef.current.get(noteId) ?? []
    waiters.push(waiter)
    editorUpdateWaitersRef.current.set(noteId, waiters)
  }, [])

  const removeEditorUpdateWaiter = useCallback((noteId: string, waiter: () => void) => {
    const waiters = editorUpdateWaitersRef.current.get(noteId)
    if (!waiters || waiters.length === 0) return
    const nextWaiters = waiters.filter((item) => item !== waiter)
    if (nextWaiters.length === 0) {
      editorUpdateWaitersRef.current.delete(noteId)
      return
    }
    editorUpdateWaitersRef.current.set(noteId, nextWaiters)
  }, [])

  // --- Toast notifications ---

  const notifyFlushTimeout = useCallback(() => {
    const now = Date.now()
    if (now - lastFlushTimeoutToastAtRef.current < FLUSH_TIMEOUT_TOAST_COOLDOWN_MS) return
    lastFlushTimeoutToastAtRef.current = now
    toast(
      isZh
        ? '\u540C\u6B65\u8F83\u6162\uFF0C\u53D8\u66F4\u4F1A\u7EE7\u7EED\u5728\u540E\u53F0\u4FDD\u5B58\u3002'
        : 'Sync is slow. Changes will continue saving in the background.',
      { type: 'info' }
    )
  }, [isZh])

  const notifyFlushRequired = useCallback(() => {
    toast(
      isZh
        ? '\u4FDD\u5B58\u4ECD\u5728\u8FDB\u884C\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u5F53\u524D\u64CD\u4F5C\u3002'
        : 'Save is still in progress. Please retry this action in a moment.',
      { type: 'error' }
    )
  }, [isZh])

  const notifyRetryPause = useCallback(() => {
    const now = Date.now()
    if (now - lastRetryPauseToastAtRef.current < RETRY_PAUSE_TOAST_COOLDOWN_MS) return
    lastRetryPauseToastAtRef.current = now
    toast(
      isZh
        ? '\u4FDD\u5B58\u6682\u65F6\u5931\u8D25\uFF0C\u7CFB\u7EDF\u4F1A\u7A0D\u540E\u81EA\u52A8\u91CD\u8BD5\u3002'
        : 'Saving is temporarily paused. It will retry automatically.',
      { type: 'info' }
    )
  }, [isZh])

  // --- Retry / pause helpers ---

  const mergeAndSetPendingEditorUpdate = useCallback((noteId: string, basePatch: EditorNoteUpdate): EditorNoteUpdate => {
    const latestPending = pendingEditorUpdatesRef.current.get(noteId)
    const mergedPending = { ...basePatch, ...latestPending }
    pendingEditorUpdatesRef.current.set(noteId, mergedPending)
    return mergedPending
  }, [])

  const resetEditorUpdateRetryCount = useCallback((noteId: string) => {
    editorUpdateRetryCountRef.current.delete(noteId)
  }, [])

  const clearEditorUpdateResumeTimer = useCallback((noteId: string) => {
    const timer = editorUpdateResumeTimerRef.current.get(noteId)
    if (timer) {
      clearTimeout(timer)
      editorUpdateResumeTimerRef.current.delete(noteId)
    }
  }, [])

  const clearAllEditorUpdateResumeTimers = useCallback(() => {
    editorUpdateResumeTimerRef.current.forEach((timer) => clearTimeout(timer))
    editorUpdateResumeTimerRef.current.clear()
  }, [])

  const resetEditorUpdatePauseState = useCallback((noteId: string) => {
    editorUpdatePausedUntilRef.current.delete(noteId)
    clearEditorUpdateResumeTimer(noteId)
  }, [clearEditorUpdateResumeTimer])

  const getNextEditorUpdateRetry = useCallback((noteId: string): { retryCount: number; retryDelayMs: number } => {
    const nextRetryCount = (editorUpdateRetryCountRef.current.get(noteId) ?? 0) + 1
    editorUpdateRetryCountRef.current.set(noteId, nextRetryCount)
    const retryDelayMs = Math.min(
      EDITOR_UPDATE_RETRY_BASE_MS * (2 ** (nextRetryCount - 1)),
      EDITOR_UPDATE_RETRY_MAX_MS
    )
    return { retryCount: nextRetryCount, retryDelayMs }
  }, [])

  const clearEditorUpdateRuntimeState = useCallback((noteId: string, keepPending: boolean = false) => {
    if (!keepPending) {
      pendingEditorUpdatesRef.current.delete(noteId)
    }
    resetEditorUpdateRetryCount(noteId)
    resetEditorUpdatePauseState(noteId)
  }, [resetEditorUpdatePauseState, resetEditorUpdateRetryCount])

  // --- Core queue processor ---

  const processEditorUpdateQueue = useCallback(async (noteId: string) => {
    const pausedUntil = editorUpdatePausedUntilRef.current.get(noteId)
    if (pausedUntil && pausedUntil > Date.now()) {
      if (!editorUpdateResumeTimerRef.current.has(noteId)) {
        const delayMs = Math.max(0, pausedUntil - Date.now())
        const timer = setTimeout(() => {
          editorUpdateResumeTimerRef.current.delete(noteId)
          void processEditorUpdateQueue(noteId)
        }, delayMs)
        editorUpdateResumeTimerRef.current.set(noteId, timer)
      }
      return
    }
    if (pausedUntil) {
      resetEditorUpdatePauseState(noteId)
    }

    if (editorUpdateInFlightRef.current.has(noteId)) return
    editorUpdateInFlightRef.current.add(noteId)

    try {
      while (true) {
        const pending = pendingEditorUpdatesRef.current.get(noteId)
        if (!pending) break

        pendingEditorUpdatesRef.current.delete(noteId)

        try {
          const localNote = notesRef.current.find(note => note.id === noteId)
          if (!localNote) {
            resetEditorUpdateRetryCount(noteId)
            resetEditorUpdatePauseState(noteId)
            console.warn(`[App] Note not found locally while flushing updates: ${noteId}`)
            continue
          }

          const result = await window.electron.note.updateSafe(noteId, pending, localNote.revision)

          if (result.status === 'failed') {
            resetEditorUpdateRetryCount(noteId)
            resetEditorUpdatePauseState(noteId)
            if (result.error === 'note_not_found') {
              console.warn(`[App] Note not found while persisting updates: ${noteId}`)
            } else {
              console.warn(
                `[App] Rejected queued note update (${result.error}) for note ${noteId}`
              )
            }
            continue
          }

          if (result.status === 'conflict') {
            // Requeue local patch on top of latest server snapshot, then retry.
            const mergedPending = mergeAndSetPendingEditorUpdate(noteId, pending)

            const mergedCurrent = { ...result.current, ...mergedPending }
            notesRef.current = notesRef.current.map((note) => (note.id === noteId ? mergedCurrent : note))
            setNotes(prev => prev.map(note => note.id === noteId ? mergedCurrent : note))
            resetEditorUpdateRetryCount(noteId)
            resetEditorUpdatePauseState(noteId)
            continue
          }

          resetEditorUpdateRetryCount(noteId)
          resetEditorUpdatePauseState(noteId)
          const latestPending = pendingEditorUpdatesRef.current.get(noteId)
          const mergedNote = latestPending ? { ...result.note, ...latestPending } : result.note

          notesRef.current = notesRef.current.map((note) => (note.id === noteId ? mergedNote : note))
          setNotes(prev => prev.map(note => note.id === noteId ? mergedNote : note))
        } catch (error) {
          mergeAndSetPendingEditorUpdate(noteId, pending)
          const { retryCount, retryDelayMs } = getNextEditorUpdateRetry(noteId)
          console.error('[App] Failed to persist queued note update:', error)
          if (retryCount >= EDITOR_UPDATE_FAILURE_PAUSE_THRESHOLD) {
            const nextPausedUntil = Date.now() + EDITOR_UPDATE_FAILURE_PAUSE_MS
            editorUpdatePausedUntilRef.current.set(noteId, nextPausedUntil)
            console.warn(
              `[App] Pausing note update retries for ${EDITOR_UPDATE_FAILURE_PAUSE_MS}ms after ${retryCount} failures: ${noteId}`
            )
            notifyRetryPause()
            break
          }
          console.warn(`[App] Requeued note update for retry in ${retryDelayMs}ms: ${noteId}`)
          await wait(retryDelayMs)
        }
      }
    } finally {
      editorUpdateInFlightRef.current.delete(noteId)

      if (pendingEditorUpdatesRef.current.has(noteId)) {
        const nextPausedUntil = editorUpdatePausedUntilRef.current.get(noteId)
        if (nextPausedUntil && nextPausedUntil > Date.now()) {
          if (!editorUpdateResumeTimerRef.current.has(noteId)) {
            const delayMs = Math.max(0, nextPausedUntil - Date.now())
            const timer = setTimeout(() => {
              editorUpdateResumeTimerRef.current.delete(noteId)
              void processEditorUpdateQueue(noteId)
            }, delayMs)
            editorUpdateResumeTimerRef.current.set(noteId, timer)
          }
        } else {
          if (nextPausedUntil) {
            resetEditorUpdatePauseState(noteId)
          }
          // New updates arrived while flushing; keep draining.
          void processEditorUpdateQueue(noteId)
        }
      } else {
        resetEditorUpdateRetryCount(noteId)
        resetEditorUpdatePauseState(noteId)
        resolveEditorUpdateWaiters(noteId)
      }
    }
  }, [
    getNextEditorUpdateRetry,
    mergeAndSetPendingEditorUpdate,
    notifyRetryPause,
    resetEditorUpdatePauseState,
    resetEditorUpdateRetryCount,
    resolveEditorUpdateWaiters,
    notesRef,
    setNotes,
  ])

  // --- Flush helpers ---

  const flushQueuedEditorUpdates = useCallback(async (
    noteId: string | null,
    timeoutMs: number = FLUSH_WAIT_TIMEOUT_MS
  ): Promise<boolean> => {
    if (!noteId) return true

    const hasPending = pendingEditorUpdatesRef.current.has(noteId)
    const isInFlight = editorUpdateInFlightRef.current.has(noteId)
    if (!hasPending && !isInFlight) return true

    return new Promise<boolean>((resolve) => {
      let settled = false
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null

      const finish = (flushed: boolean) => {
        if (settled) return
        settled = true
        removeEditorUpdateWaiter(noteId, waiter)
        if (timeoutHandle) clearTimeout(timeoutHandle)
        resolve(flushed)
      }

      const waiter = () => finish(true)
      addEditorUpdateWaiter(noteId, waiter)
      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => finish(false), timeoutMs)
      }
      void processEditorUpdateQueue(noteId)
    })
  }, [addEditorUpdateWaiter, processEditorUpdateQueue, removeEditorUpdateWaiter])

  const flushQueuedEditorUpdatesForNotes = useCallback(async (
    noteIds: string[],
    timeoutMs: number = FLUSH_WAIT_TIMEOUT_MS
  ): Promise<boolean> => {
    const uniqueIds = [...new Set(noteIds.filter((id): id is string => Boolean(id)))]
    const results = await Promise.all(uniqueIds.map((id) => flushQueuedEditorUpdates(id, timeoutMs)))
    return results.every(Boolean)
  }, [flushQueuedEditorUpdates])

  // Stable ref for keyboard shortcut handlers
  const flushQueuedEditorUpdatesRef = useRef(flushQueuedEditorUpdates)
  flushQueuedEditorUpdatesRef.current = flushQueuedEditorUpdates

  // --- Non-editor note patch (conflict-aware update) ---

  const applyNonEditorNotePatch = useCallback(async (id: string, patch: Partial<NoteInput>): Promise<Note | null> => {
    const syncLocalNote = (next: Note) => {
      notesRef.current = notesRef.current.map((note) => (note.id === id ? next : note))
      setNotes(prev => prev.map(note => note.id === id ? next : note))
    }

    const localNote = notesRef.current.find(note => note.id === id)
    if (!localNote) return null

    const first = await window.electron.note.updateSafe(id, patch, localNote.revision)
    if (first.status === 'failed') return null
    if (first.status === 'updated') {
      syncLocalNote(first.note)
      return first.note
    }

    // Conflict: sync latest server snapshot and retry once.
    syncLocalNote(first.current)
    const retry = await window.electron.note.updateSafe(id, patch, first.current.revision)
    if (retry.status === 'updated') {
      syncLocalNote(retry.note)
      return retry.note
    }
    if (retry.status === 'conflict') {
      syncLocalNote(retry.current)
    }

    return null
  }, [notesRef, setNotes])

  // --- Index check (debounced) ---

  const triggerIndexCheck = useCallback((noteId: string | null, fallbackNote?: Note | null) => {
    if (!noteId) return

    if (indexCheckTimerRef.current) {
      clearTimeout(indexCheckTimerRef.current)
    }

    indexCheckTimerRef.current = setTimeout(() => {
      const note = notesRef.current.find(n => n.id === noteId)
        || (fallbackNote?.id === noteId ? fallbackNote : null)
      if (note) {
        window.electron.note.checkIndex(
          note.id,
          note.notebook_id || '',
          note.content
        ).catch(console.error)
      }
    }, 300)
  }, [notesRef])

  // --- Cleanup on unmount ---

  useEffect(() => {
    return () => {
      if (indexCheckTimerRef.current) {
        clearTimeout(indexCheckTimerRef.current)
      }
      editorUpdateResumeTimerRef.current.forEach((timer) => clearTimeout(timer))
      editorUpdateResumeTimerRef.current.clear()
    }
  }, [])

  return {
    pendingEditorUpdatesRef,
    flushQueuedEditorUpdates,
    flushQueuedEditorUpdatesForNotes,
    flushQueuedEditorUpdatesRef,
    processEditorUpdateQueue,
    mergeAndSetPendingEditorUpdate,
    clearEditorUpdateRuntimeState,
    clearAllEditorUpdateResumeTimers,
    notifyFlushTimeout,
    notifyFlushRequired,
    applyNonEditorNotePatch,
    triggerIndexCheck,
  }
}
