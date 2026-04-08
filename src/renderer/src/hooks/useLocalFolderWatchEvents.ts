import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { LocalFolderTreeResult, NotebookStatus } from '../types/note'
import {
  buildNotebookStatusToastKey,
  clearStatusToastEntriesByNotebookId,
} from './localNotebookScopedState'
import { toast } from '../utils/toast'

interface AllViewLocalEditorTarget {
  noteId: string
  notebookId: string
  relativePath: string
}

interface UseLocalFolderWatchEventsOptions {
  allViewLocalEditorTarget: AllViewLocalEditorTarget | null
  localNotebookIdsRef: MutableRefObject<Set<string>>
  selectedNotebookId: string | null
  isLocalFolderNotebookSelected: boolean
  localFolderMissingText: string
  localFolderPermissionRequiredText: string
  refreshLocalFolderTree: (notebookId: string, options?: { showLoading?: boolean }) => Promise<LocalFolderTreeResult | null>
  refreshOpenLocalFileFromDisk: (options?: { changedRelativePath?: string | null }) => Promise<void>
  onLocalMountUnavailable: (notebookId: string) => void
  localWatchRefreshTimersRef: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>
  localWatchRefreshSuppressUntilRef: MutableRefObject<Map<string, number>>
  localStatusToastAtRef: MutableRefObject<Map<string, number>>
  localWatchSequenceRef: MutableRefObject<Map<string, number>>
  setLocalFolderStatuses: Dispatch<SetStateAction<Record<string, NotebookStatus>>>
  setLocalFolderTreeDirty: Dispatch<SetStateAction<Record<string, boolean>>>
  setLocalFolderTreeCache: Dispatch<SetStateAction<Record<string, LocalFolderTreeResult>>>
  setLocalNotebookNoteCounts: Dispatch<SetStateAction<Record<string, number>>>
  setLocalNotebookHasChildFolders: Dispatch<SetStateAction<Record<string, boolean>>>
}

const LOCAL_STATUS_TOAST_COOLDOWN_MS = 4000
const LOCAL_WATCH_REFRESH_DEBOUNCE_MS = 180

export function useLocalFolderWatchEvents(options: UseLocalFolderWatchEventsOptions): void {
  const {
    allViewLocalEditorTarget,
    localNotebookIdsRef,
    selectedNotebookId,
    isLocalFolderNotebookSelected,
    localFolderMissingText,
    localFolderPermissionRequiredText,
    refreshLocalFolderTree,
    refreshOpenLocalFileFromDisk,
    onLocalMountUnavailable,
    localWatchRefreshTimersRef,
    localWatchRefreshSuppressUntilRef,
    localStatusToastAtRef,
    localWatchSequenceRef,
    setLocalFolderStatuses,
    setLocalFolderTreeDirty,
    setLocalFolderTreeCache,
    setLocalNotebookNoteCounts,
    setLocalNotebookHasChildFolders,
  } = options

  useEffect(() => {
    const localWatchRefreshTimers = localWatchRefreshTimersRef.current
    const unsubscribe = window.electron.localFolder.onChanged((event) => {
      if (!localNotebookIdsRef.current.has(event.notebook_id)) {
        const pendingRefreshTimer = localWatchRefreshTimers.get(event.notebook_id)
        if (pendingRefreshTimer) {
          clearTimeout(pendingRefreshTimer)
          localWatchRefreshTimers.delete(event.notebook_id)
        }
        localWatchRefreshSuppressUntilRef.current.delete(event.notebook_id)
        localWatchSequenceRef.current.delete(event.notebook_id)
        clearStatusToastEntriesByNotebookId(localStatusToastAtRef.current, event.notebook_id)
        return
      }

      const incomingSequence = typeof event.sequence === 'number' ? event.sequence : null
      if (incomingSequence !== null) {
        const lastSequence = localWatchSequenceRef.current.get(event.notebook_id) ?? 0
        if (incomingSequence <= lastSequence) {
          return
        }
        localWatchSequenceRef.current.set(event.notebook_id, incomingSequence)
      }

      setLocalFolderStatuses((prev) => {
        if (prev[event.notebook_id] === event.status) return prev
        return { ...prev, [event.notebook_id]: event.status }
      })
      if (event.status === 'active') {
        setLocalFolderTreeDirty((prev) => {
          if (prev[event.notebook_id] === true) return prev
          return { ...prev, [event.notebook_id]: true }
        })
      } else {
        setLocalFolderTreeCache((prev) => {
          if (!(event.notebook_id in prev)) return prev
          const next = { ...prev }
          delete next[event.notebook_id]
          return next
        })
        setLocalFolderTreeDirty((prev) => {
          if (!(event.notebook_id in prev)) return prev
          const next = { ...prev }
          delete next[event.notebook_id]
          return next
        })
        setLocalNotebookNoteCounts((prev) => {
          if (!(event.notebook_id in prev)) return prev
          const next = { ...prev }
          delete next[event.notebook_id]
          return next
        })
        setLocalNotebookHasChildFolders((prev) => {
          if (!(event.notebook_id in prev)) return prev
          const next = { ...prev }
          delete next[event.notebook_id]
          return next
        })
      }

      if (event.status !== 'active') {
        const pendingRefreshTimer = localWatchRefreshTimers.get(event.notebook_id)
        if (pendingRefreshTimer) {
          clearTimeout(pendingRefreshTimer)
          localWatchRefreshTimers.delete(event.notebook_id)
        }
        localWatchRefreshSuppressUntilRef.current.delete(event.notebook_id)
      }

      const isActiveSelectedLocalNotebook = event.notebook_id === selectedNotebookId
      const isActiveAllViewLocalNotebook = Boolean(
        !selectedNotebookId
        && allViewLocalEditorTarget
        && allViewLocalEditorTarget.notebookId === event.notebook_id
      )
      if (!isActiveSelectedLocalNotebook && !isActiveAllViewLocalNotebook) return

      if (event.status !== 'active') {
        const toastKey = buildNotebookStatusToastKey(event.notebook_id, event.status)
        const now = Date.now()
        const lastToastAt = localStatusToastAtRef.current.get(toastKey) ?? 0
        if (now - lastToastAt > LOCAL_STATUS_TOAST_COOLDOWN_MS) {
          localStatusToastAtRef.current.set(toastKey, now)
          toast(
            event.status === 'permission_required'
              ? localFolderPermissionRequiredText
              : localFolderMissingText,
            { type: 'error' }
          )
        }

        onLocalMountUnavailable(event.notebook_id)
        return
      }

      if (!isLocalFolderNotebookSelected && !isActiveAllViewLocalNotebook) return
      const suppressUntil = localWatchRefreshSuppressUntilRef.current.get(event.notebook_id) ?? 0
      const now = Date.now()
      if (suppressUntil > now) {
        // Don't silently drop: schedule a compensating refresh after the
        // suppression window expires so external changes aren't lost.
        const existingTimer = localWatchRefreshTimers.get(event.notebook_id)
        if (existingTimer) {
          clearTimeout(existingTimer)
        }
        const delayMs = suppressUntil - now + LOCAL_WATCH_REFRESH_DEBOUNCE_MS
        const deferredTimer = setTimeout(() => {
          localWatchRefreshTimers.delete(event.notebook_id)
          void refreshLocalFolderTree(event.notebook_id, { showLoading: false })
          void refreshOpenLocalFileFromDisk({ changedRelativePath: null })
        }, delayMs)
        localWatchRefreshTimers.set(event.notebook_id, deferredTimer)
        return
      }

      const existingTimer = localWatchRefreshTimers.get(event.notebook_id)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }
      const refreshTimer = setTimeout(() => {
        const eventReason = event.reason || 'content_changed'
        const shouldRefreshOpenFile = eventReason !== 'status_changed' || event.status === 'active'
        localWatchRefreshTimers.delete(event.notebook_id)
        void refreshLocalFolderTree(event.notebook_id, { showLoading: false })
        if (shouldRefreshOpenFile) {
          void refreshOpenLocalFileFromDisk({
            changedRelativePath: event.changed_relative_path ?? null,
          })
        }
      }, LOCAL_WATCH_REFRESH_DEBOUNCE_MS)
      localWatchRefreshTimers.set(event.notebook_id, refreshTimer)
    })

    return () => {
      unsubscribe()
      for (const timer of localWatchRefreshTimers.values()) {
        clearTimeout(timer)
      }
      localWatchRefreshTimers.clear()
    }
  }, [
    allViewLocalEditorTarget,
    localNotebookIdsRef,
    isLocalFolderNotebookSelected,
    localFolderMissingText,
    localFolderPermissionRequiredText,
    localStatusToastAtRef,
    localWatchRefreshSuppressUntilRef,
    localWatchRefreshTimersRef,
    localWatchSequenceRef,
    onLocalMountUnavailable,
    refreshOpenLocalFileFromDisk,
    refreshLocalFolderTree,
    selectedNotebookId,
    setLocalFolderStatuses,
    setLocalFolderTreeCache,
    setLocalFolderTreeDirty,
    setLocalNotebookHasChildFolders,
    setLocalNotebookNoteCounts,
  ])
}
