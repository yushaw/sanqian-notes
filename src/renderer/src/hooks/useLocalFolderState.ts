import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useLocalFolderSearch } from './useLocalFolderSearch'
import { useLocalFolderWatchEvents } from './useLocalFolderWatchEvents'
import { useLocalFolderDialogs } from '../components/app/LocalFolderDialogs'
import { toast } from '../utils/toast'
import {
  applyLocalNoteMetadataToNote,
  findFolderNodeByPath,
  getRelativePathDisplayName,
  hasLocalFolderNodes,
  normalizeLocalPreferredFileName,
} from '../utils/localFolderNavigation'
import {
  type Note,
  type Notebook,
  type SmartViewId,
  type LocalFolderFileContent,
  type LocalFolderFileErrorCode,
  type LocalFolderTreeResult,
  type LocalFolderFileEntry,
  type NotebookStatus,
  type LocalNoteMetadata,
} from '../types/note'
import { createLocalResourceId, getLocalResourceFileTitle, parseLocalResourceId } from '../utils/localResourceId'
import type { Translations } from '../i18n'

// ---------------------------------------------------------------------------
// Helper functions (moved from top of App.tsx)
// ---------------------------------------------------------------------------

function toLocalNoteTags(tagNames?: string[] | null): Note['tags'] {
  if (!Array.isArray(tagNames) || tagNames.length === 0) return []
  const seen = new Set<string>()
  const tags: Note['tags'] = []

  for (const rawName of tagNames) {
    if (typeof rawName !== 'string') continue
    const name = rawName.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push({
      id: `local-tag:${encodeURIComponent(key)}`,
      name,
      source: 'user',
    })
  }

  return tags
}

const STORAGE_KEY_LOCAL_NOTE_COUNTS = 'sanqian-notes-local-note-counts'
const LOCAL_FILE_CREATE_RETRY_LIMIT = 128
const LOCAL_WATCH_SUPPRESS_MS = 1200

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface LocalSaveConflictDialogState {
  relativePath: string
  displayName: string
  pendingContent: string
  conflict: { size: number; mtime_ms: number; etag?: string }
}

interface LocalAutoDraftState {
  notebookId: string
  relativePath: string
  initialContent: string
  initialMeta: { size: number; mtimeMs: number }
  touched: boolean
}

// ---------------------------------------------------------------------------
// Hook options
// ---------------------------------------------------------------------------

export interface UseLocalFolderStateOptions {
  notebooks: Notebook[]
  selectedNotebookId: string | null
  selectedSmartView: SmartViewId | null
  allViewLocalEditorTarget: { noteId: string; notebookId: string; relativePath: string } | null
  setNotebooks: Dispatch<SetStateAction<Notebook[]>>
  setAllViewLocalEditorTarget: Dispatch<SetStateAction<{ noteId: string; notebookId: string; relativePath: string } | null>>
  setSelectedNotebookId: Dispatch<SetStateAction<string | null>>
  setSelectedSmartView: Dispatch<SetStateAction<SmartViewId | null>>
  setIsTypewriterMode: Dispatch<SetStateAction<boolean>>
  setSelectedNoteIds: Dispatch<SetStateAction<string[]>>
  setAnchorNoteId: Dispatch<SetStateAction<string | null>>
  t: Translations
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLocalFolderState(options: UseLocalFolderStateOptions) {
  const {
    notebooks,
    selectedNotebookId,
    selectedSmartView,
    allViewLocalEditorTarget,
    setNotebooks,
    setAllViewLocalEditorTarget,
    setSelectedNotebookId,
    setSelectedSmartView,
    setIsTypewriterMode,
    setSelectedNoteIds,
    setAnchorNoteId,
    t,
  } = options

  // ---------------------------------------------------------------------------
  // useState
  // ---------------------------------------------------------------------------

  const [localFolderTree, setLocalFolderTree] = useState<LocalFolderTreeResult | null>(null)
  const [localFolderTreeCache, setLocalFolderTreeCache] = useState<Record<string, LocalFolderTreeResult>>({})
  const [localFolderTreeDirty, setLocalFolderTreeDirty] = useState<Record<string, boolean>>({})
  const [localNoteMetadataById, setLocalNoteMetadataById] = useState<Record<string, LocalNoteMetadata>>({})
  const [localNotebookNoteCounts, setLocalNotebookNoteCounts] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LOCAL_NOTE_COUNTS)
      if (!raw) return {}

      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object') return {}

      const sanitized: Record<string, number> = {}
      for (const [notebookId, count] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) continue
        sanitized[notebookId] = Math.floor(count)
      }
      return sanitized
    } catch {
      return {}
    }
  })
  const [localFolderTreeLoading, setLocalFolderTreeLoading] = useState(false)
  const [localFolderStatuses, setLocalFolderStatuses] = useState<Record<string, NotebookStatus>>({})
  const [localNotebookHasChildFolders, setLocalNotebookHasChildFolders] = useState<Record<string, boolean>>({})
  const [selectedLocalFolderPath, setSelectedLocalFolderPath] = useState<string | null>(null)
  const [selectedLocalFilePath, setSelectedLocalFilePath] = useState<string | null>(null)
  const [localEditorNote, setLocalEditorNote] = useState<Note | null>(null)
  const [localEditorLoading, setLocalEditorLoading] = useState(false)
  const [localSaveConflictDialog, setLocalSaveConflictDialog] = useState<LocalSaveConflictDialogState | null>(null)
  const [localSaveConflictSubmitting, setLocalSaveConflictSubmitting] = useState(false)

  // ---------------------------------------------------------------------------
  // useRef
  // ---------------------------------------------------------------------------

  const localNoteMetadataByIdRef = useRef<Record<string, LocalNoteMetadata>>(localNoteMetadataById)
  localNoteMetadataByIdRef.current = localNoteMetadataById
  const localFolderTreeCacheRef = useRef<Record<string, LocalFolderTreeResult>>(localFolderTreeCache)
  localFolderTreeCacheRef.current = localFolderTreeCache
  const localFolderTreeDirtyRef = useRef<Record<string, boolean>>(localFolderTreeDirty)
  localFolderTreeDirtyRef.current = localFolderTreeDirty
  const localOpenFileRef = useRef<{ notebookId: string; relativePath: string } | null>(null)
  const localOpeningFileRef = useRef<{ notebookId: string; relativePath: string } | null>(null)
  const localOpeningFileTaskRef = useRef<Promise<LocalFolderFileContent | null> | null>(null)
  const localOpenFileMetaRef = useRef<{ size: number; mtimeMs: number; contentHash?: string; etag?: string } | null>(null)
  const localEditorNoteRef = useRef<Note | null>(localEditorNote)
  localEditorNoteRef.current = localEditorNote
  const localAutoDraftRef = useRef<LocalAutoDraftState | null>(null)
  const localSaveBlockedByConflictRef = useRef(false)
  const localPendingContentRef = useRef<{ content: string; notebookId: string; relativePath: string } | null>(null)
  const localSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localSaveTaskRef = useRef<Promise<void> | null>(null)
  const localFileReadVersionRef = useRef(0)
  const localTreeLoadVersionRef = useRef(0)
  const localWatchRefreshTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const localWatchRefreshSuppressUntilRef = useRef<Map<string, number>>(new Map())
  const localStatusToastAtRef = useRef<Map<string, number>>(new Map())
  const localWatchSequenceRef = useRef<Map<string, number>>(new Map())
  const localFileErrorMessageResolverRef = useRef<(errorCode: LocalFolderFileErrorCode) => string>(null!)
  const flushLocalFileSaveRef = useRef<() => Promise<void>>(null!)
  const localRenameInFlightRef = useRef(false)
  const localFolderDialogsResetRef = useRef<() => void>(() => {})

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const selectedLocalSearchSourceType = useMemo(() => {
    if (!selectedNotebookId) return null
    const selectedNotebook = notebooks.find((notebook) => notebook.id === selectedNotebookId)
    return selectedNotebook?.source_type ?? null
  }, [notebooks, selectedNotebookId])

  const selectedLocalSearchStatus: NotebookStatus = selectedNotebookId
    ? (localFolderStatuses[selectedNotebookId] || 'active')
    : 'active'

  const isLocalFolderNotebookSelected = useMemo(() => {
    if (!selectedNotebookId) return false
    const contextNotebook = notebooks.find((nb) => nb.id === selectedNotebookId)
    return contextNotebook?.source_type === 'local-folder'
  }, [notebooks, selectedNotebookId])

  const isAllSourceViewActive = !selectedNotebookId && (selectedSmartView === 'all' || selectedSmartView === null)
  const isGlobalLocalAwareView = !selectedNotebookId && selectedSmartView !== 'trash'
  const isAllViewLocalEditorActive = isAllSourceViewActive && Boolean(allViewLocalEditorTarget)
  const shouldRenderLocalEditor = isLocalFolderNotebookSelected || isAllViewLocalEditorActive

  const activeLocalNotebookId = isLocalFolderNotebookSelected
    ? selectedNotebookId
    : allViewLocalEditorTarget?.notebookId ?? null

  const activeLocalNotebookStatus = useMemo<NotebookStatus>(() => {
    if (!activeLocalNotebookId) return 'active'
    return localFolderStatuses[activeLocalNotebookId] || 'active'
  }, [activeLocalNotebookId, localFolderStatuses])

  const selectedLocalNotebookStatus = useMemo<NotebookStatus>(() => {
    if (!selectedNotebookId) return 'active'
    return localFolderStatuses[selectedNotebookId] || 'active'
  }, [localFolderStatuses, selectedNotebookId])

  // ---------------------------------------------------------------------------
  // useCallback: suppressLocalWatchRefresh
  // ---------------------------------------------------------------------------

  const suppressLocalWatchRefresh = useCallback((notebookId: string, ttlMs: number = LOCAL_WATCH_SUPPRESS_MS) => {
    localWatchRefreshSuppressUntilRef.current.set(notebookId, Date.now() + Math.max(0, ttlMs))
  }, [])

  // ---------------------------------------------------------------------------
  // useCallback: resolveLocalFileErrorMessage
  // ---------------------------------------------------------------------------

  const resolveLocalFileErrorMessage = useCallback((errorCode: LocalFolderFileErrorCode): string => {
    switch (errorCode) {
      case 'LOCAL_FILE_TOO_LARGE':
        return t.notebook.fileTooLarge
      case 'LOCAL_FILE_INVALID_NAME':
        return t.notebook.createErrorInvalidName
      case 'LOCAL_FILE_ALREADY_EXISTS':
      case 'LOCAL_FOLDER_ALREADY_EXISTS':
        return t.notebook.createErrorAlreadyExists
      case 'LOCAL_FOLDER_DEPTH_LIMIT':
        return t.notebook.createErrorDepthLimit
      case 'LOCAL_FOLDER_NOT_FOUND':
      case 'LOCAL_FOLDER_NOT_A_DIRECTORY':
        return t.notebook.createErrorParentMissing
      case 'LOCAL_FILE_UNSUPPORTED_TYPE':
        return t.notebook.createErrorUnsupportedType
      case 'LOCAL_FILE_DELETE_FAILED':
        return t.notebook.deleteFailed
      case 'LOCAL_FILE_NOT_FOUND':
      case 'LOCAL_FILE_NOT_A_FILE':
      case 'LOCAL_FILE_OUT_OF_ROOT':
      case 'LOCAL_FILE_UNREADABLE':
        return t.notebook.fileOpenFailed
      case 'LOCAL_FILE_WRITE_FAILED':
        return t.notebook.fileSaveFailed
      case 'LOCAL_FILE_INVALID_IF_MATCH':
      case 'LOCAL_FILE_CONFLICT':
        return t.notebook.fileConflictDetected
      default:
        return t.notebook.createErrorGeneric
    }
  }, [t.notebook])

  localFileErrorMessageResolverRef.current = resolveLocalFileErrorMessage

  // ---------------------------------------------------------------------------
  // Local folder search (delegated to useLocalFolderSearch)
  // ---------------------------------------------------------------------------

  const {
    localSearchQuery,
    localSearchMatchedPathSet,
    localSearchListLoading,
    handleLocalSearchQueryChange,
    beginLocalSearchComposition,
    endLocalSearchComposition,
    cancelLocalSearch,
    resetLocalSearch,
  } = useLocalFolderSearch({
    selectedNotebookId,
    selectedLocalSearchSourceType,
    selectedLocalSearchStatus,
    selectedLocalFolderPath,
    localFolderTreeScannedAt: localFolderTree?.scanned_at,
    localStatusToastAtRef,
    resolveLocalFileErrorMessage,
  })

  // ---------------------------------------------------------------------------
  // useCallback: refreshLocalFolderStatuses
  // ---------------------------------------------------------------------------

  const refreshLocalFolderStatuses = useCallback(async () => {
    try {
      const mounts = await window.electron.localFolder.list()
      const nextStatuses: Record<string, NotebookStatus> = {}
      for (const mount of mounts) {
        nextStatuses[mount.notebook.id] = mount.mount.status
      }
      setLocalFolderStatuses(nextStatuses)
    } catch (error) {
      console.error('Failed to refresh local folder statuses:', error)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // useCallback: warmupLocalNotebookSummaries
  // ---------------------------------------------------------------------------

  const warmupLocalNotebookSummaries = useCallback(async (
    mounts: Awaited<ReturnType<typeof window.electron.localFolder.list>>,
    warmupOptions?: { notebookIds?: string[] }
  ) => {
    const activeNotebookIdSet = new Set(
      mounts
        .filter((mount) => mount.mount.status === 'active')
        .map((mount) => mount.notebook.id)
    )
    const targetNotebookIds = warmupOptions?.notebookIds
      ? warmupOptions.notebookIds.filter((notebookId) => activeNotebookIdSet.has(notebookId))
      : Array.from(activeNotebookIdSet)

    if (targetNotebookIds.length === 0) return

    const scannedTrees: Record<string, LocalFolderTreeResult> = {}
    const items = targetNotebookIds
    const concurrency = 2
    if (items.length > 0) {
      const maxConcurrency = Math.max(1, Math.min(concurrency, items.length))
      let index = 0
      await Promise.all(
        Array.from({ length: maxConcurrency }, async () => {
          while (true) {
            const currentIndex = index++
            if (currentIndex >= items.length) break
            const notebookId = items[currentIndex]
            try {
              const tree = await window.electron.localFolder.getTree(notebookId)
              if (!tree) continue
              scannedTrees[notebookId] = tree
            } catch (error) {
              console.warn('[local-folder] warmup failed for notebook:', notebookId, error)
            }
          }
        })
      )
    }

    const scannedEntries = Object.entries(scannedTrees)
    if (scannedEntries.length === 0) return

    setLocalFolderTreeCache((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [notebookId, tree] of scannedEntries) {
        const prevTree = prev[notebookId]
        if (
          prevTree
          && prevTree.scanned_at === tree.scanned_at
          && prevTree.files.length === tree.files.length
        ) {
          continue
        }
        next[notebookId] = tree
        changed = true
      }
      return changed ? next : prev
    })

    setLocalNotebookNoteCounts((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [notebookId, tree] of scannedEntries) {
        const nextCount = tree.files.length
        if (next[notebookId] === nextCount) continue
        next[notebookId] = nextCount
        changed = true
      }
      return changed ? next : prev
    })

    setLocalNotebookHasChildFolders((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [notebookId, tree] of scannedEntries) {
        const hasChildFolders = hasLocalFolderNodes(tree.tree)
        if (next[notebookId] === hasChildFolders) continue
        next[notebookId] = hasChildFolders
        changed = true
      }
      return changed ? next : prev
    })

    setLocalFolderTreeDirty((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [notebookId] of scannedEntries) {
        if (next[notebookId] === false) continue
        next[notebookId] = false
        changed = true
      }
      return changed ? next : prev
    })
  }, [])

  // ---------------------------------------------------------------------------
  // useCallback: refreshLocalFolderTree
  // ---------------------------------------------------------------------------

  const refreshLocalFolderTree = useCallback(async (
    notebookId: string,
    refreshOptions?: { showLoading?: boolean }
  ): Promise<LocalFolderTreeResult | null> => {
    const requestVersion = localTreeLoadVersionRef.current + 1
    localTreeLoadVersionRef.current = requestVersion
    const hasCachedTree = Boolean(localFolderTreeCacheRef.current[notebookId])
    const shouldShowLoading = refreshOptions?.showLoading ?? !hasCachedTree
    if (shouldShowLoading) {
      setLocalFolderTreeLoading(true)
    }

    try {
      const tree = await window.electron.localFolder.getTree(notebookId)
      if (requestVersion !== localTreeLoadVersionRef.current) {
        return null
      }
      setLocalFolderTree(tree)
      if (tree) {
        setLocalFolderTreeCache((prev) => ({ ...prev, [notebookId]: tree }))
        setLocalNotebookNoteCounts((prev) => {
          const nextCount = tree.files.length
          if (prev[notebookId] === nextCount) return prev
          return { ...prev, [notebookId]: nextCount }
        })
      }
      setLocalFolderTreeDirty((prev) => {
        if (prev[notebookId] === false) return prev
        return { ...prev, [notebookId]: false }
      })
      setLocalNotebookHasChildFolders((prev) => {
        const hasChildFolders = Boolean(tree && hasLocalFolderNodes(tree.tree))
        if (prev[notebookId] === hasChildFolders) return prev
        return { ...prev, [notebookId]: hasChildFolders }
      })
      if (tree) {
        setLocalFolderStatuses((prev) => {
          if (prev[notebookId] === 'active') return prev
          return { ...prev, [notebookId]: 'active' }
        })
      } else {
        void refreshLocalFolderStatuses()
      }
      return tree
    } catch (error) {
      if (requestVersion === localTreeLoadVersionRef.current) {
        console.error('Failed to load local folder tree:', error)
        setLocalFolderTree(null)
        setLocalFolderTreeDirty((prev) => ({ ...prev, [notebookId]: true }))
        setLocalNotebookHasChildFolders((prev) => {
          if (prev[notebookId] === false) return prev
          return { ...prev, [notebookId]: false }
        })
      }
      void refreshLocalFolderStatuses()
      return null
    } finally {
      if (requestVersion === localTreeLoadVersionRef.current) {
        setLocalFolderTreeLoading(false)
      }
    }
  }, [refreshLocalFolderStatuses])

  // ---------------------------------------------------------------------------
  // useCallback: processLocalFileSaveQueue
  // ---------------------------------------------------------------------------

  const processLocalFileSaveQueue = useCallback((): Promise<void> => {
    if (localSaveTaskRef.current) {
      return localSaveTaskRef.current
    }

    const task = (async () => {
      while (true) {
        if (localSaveBlockedByConflictRef.current) {
          break
        }
        const pending = localPendingContentRef.current
        const openFile = localOpenFileRef.current
        if (!pending || !openFile) {
          break
        }

        // Guard: discard stale content from a previously open file (race between
        // the editor's 300ms debounce and openLocalFile switching localOpenFileRef).
        if (pending.notebookId !== openFile.notebookId || pending.relativePath !== openFile.relativePath) {
          localPendingContentRef.current = null
          break
        }

        localPendingContentRef.current = null
        const expectedMeta = localOpenFileMetaRef.current

        const result = await window.electron.localFolder.saveFile({
          notebook_id: pending.notebookId,
          relative_path: pending.relativePath,
          tiptap_content: pending.content,
          if_match: expectedMeta?.etag,
          expected_mtime_ms: expectedMeta?.mtimeMs,
          expected_size: expectedMeta?.size,
          expected_content_hash: expectedMeta?.contentHash,
        })

        if (!result.success) {
          if (result.errorCode === 'LOCAL_FILE_CONFLICT') {
            localSaveBlockedByConflictRef.current = true
            setLocalSaveConflictDialog({
              relativePath: pending.relativePath,
              displayName: getRelativePathDisplayName(pending.relativePath),
              pendingContent: pending.content,
              conflict: result.conflict,
            })
            toast(t.notebook.fileConflictDetected, { type: 'error' })
            break
          }
          toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
          break
        }

        localOpenFileMetaRef.current = {
          size: result.result.size,
          mtimeMs: result.result.mtime_ms,
          contentHash: result.result.content_hash,
          etag: result.result.etag,
        }
        suppressLocalWatchRefresh(pending.notebookId)
      }
    })().finally(() => {
      localSaveTaskRef.current = null
      if (localPendingContentRef.current && !localSaveBlockedByConflictRef.current) {
        void processLocalFileSaveQueue()
      }
    })

    localSaveTaskRef.current = task
    return task
  }, [resolveLocalFileErrorMessage, suppressLocalWatchRefresh, t.notebook.fileConflictDetected])

  // ---------------------------------------------------------------------------
  // useCallback: scheduleLocalFileSave
  // ---------------------------------------------------------------------------

  const scheduleLocalFileSave = useCallback(() => {
    if (localSaveTimerRef.current) {
      clearTimeout(localSaveTimerRef.current)
    }
    localSaveTimerRef.current = setTimeout(() => {
      localSaveTimerRef.current = null
      void processLocalFileSaveQueue()
    }, 1000)
  }, [processLocalFileSaveQueue])

  // ---------------------------------------------------------------------------
  // useCallback: flushLocalFileSave
  // ---------------------------------------------------------------------------

  const flushLocalFileSave = useCallback(async () => {
    if (localSaveTimerRef.current) {
      clearTimeout(localSaveTimerRef.current)
      localSaveTimerRef.current = null
    }
    await processLocalFileSaveQueue()
  }, [processLocalFileSaveQueue])

  flushLocalFileSaveRef.current = flushLocalFileSave

  // ---------------------------------------------------------------------------
  // useCallback: buildLocalEditorNote
  // ---------------------------------------------------------------------------

  const buildLocalEditorNote = useCallback((file: LocalFolderFileContent): Note => {
    const time = new Date(file.mtime_ms).toISOString()
    const localId = createLocalResourceId(file.notebook_id, file.relative_path)
    const metadata = localNoteMetadataByIdRef.current[localId]
    return {
      id: localId,
      title: file.name,
      content: file.tiptap_content,
      notebook_id: file.notebook_id,
      folder_path: null,
      is_daily: false,
      daily_date: null,
      is_favorite: metadata?.is_favorite ?? false,
      is_pinned: metadata?.is_pinned ?? false,
      revision: 0,
      created_at: time,
      updated_at: time,
      deleted_at: null,
      ai_summary: metadata?.ai_summary ?? null,
      tags: toLocalNoteTags(metadata?.tags),
    }
  }, [])

  // ---------------------------------------------------------------------------
  // useCallback: clearLocalAutoDraft / markLocalAutoDraftTouched
  // ---------------------------------------------------------------------------

  const clearLocalAutoDraft = useCallback(() => {
    localAutoDraftRef.current = null
  }, [])

  const markLocalAutoDraftTouched = useCallback((notebookId: string, relativePath: string) => {
    const draft = localAutoDraftRef.current
    if (!draft) return
    if (draft.notebookId !== notebookId || draft.relativePath !== relativePath) return
    if (draft.touched) return
    draft.touched = true
  }, [])

  // ---------------------------------------------------------------------------
  // useCallback: cleanupLocalAutoDraftIfNeeded
  // ---------------------------------------------------------------------------

  const cleanupLocalAutoDraftIfNeeded = useCallback(async (
    nextOpenFile: { notebookId: string; relativePath: string } | null,
    cleanupOptions?: { skipFlush?: boolean }
  ) => {
    const draft = localAutoDraftRef.current
    if (!draft) return
    if (
      nextOpenFile
      && nextOpenFile.notebookId === draft.notebookId
      && nextOpenFile.relativePath === draft.relativePath
    ) {
      return
    }

    if (draft.touched) {
      clearLocalAutoDraft()
      return
    }

    try {
      if (!cleanupOptions?.skipFlush) {
        await flushLocalFileSave()
      }

      const current = await window.electron.localFolder.readFile({
        notebook_id: draft.notebookId,
        relative_path: draft.relativePath,
      })
      if (!current.success) {
        clearLocalAutoDraft()
        return
      }

      const metaUnchanged = current.result.size === draft.initialMeta.size
        && Math.abs(current.result.mtime_ms - draft.initialMeta.mtimeMs) <= 1
      const contentUnchanged = current.result.tiptap_content === draft.initialContent
      if (!metaUnchanged || !contentUnchanged) {
        clearLocalAutoDraft()
        return
      }

      const deleted = await window.electron.localFolder.deleteEntry({
        notebook_id: draft.notebookId,
        relative_path: draft.relativePath,
        kind: 'file',
      })
      if (!deleted.success) {
        console.warn('[local-auto-draft] failed to delete empty draft:', deleted.errorCode)
        clearLocalAutoDraft()
        return
      }
      suppressLocalWatchRefresh(draft.notebookId)

      if (
        localOpenFileRef.current
        && localOpenFileRef.current.notebookId === draft.notebookId
        && localOpenFileRef.current.relativePath === draft.relativePath
      ) {
        const keepNextSelection = Boolean(
          nextOpenFile
          && nextOpenFile.notebookId === draft.notebookId
          && nextOpenFile.relativePath !== draft.relativePath
        )
        localOpenFileRef.current = null
        localOpenFileMetaRef.current = null
        localPendingContentRef.current = null
        localSaveBlockedByConflictRef.current = false
        setLocalSaveConflictDialog(null)
        if (!keepNextSelection) {
          setLocalEditorNote(null)
          setSelectedLocalFilePath(null)
        }
      }
      if (selectedNotebookId === draft.notebookId) {
        await refreshLocalFolderTree(draft.notebookId, { showLoading: false })
      } else {
        setLocalFolderTreeDirty((prev) => ({ ...prev, [draft.notebookId]: true }))
      }
    } catch (error) {
      console.error('[local-auto-draft] cleanup failed:', error)
    } finally {
      clearLocalAutoDraft()
    }
  }, [clearLocalAutoDraft, flushLocalFileSave, refreshLocalFolderTree, selectedNotebookId, suppressLocalWatchRefresh])

  // ---------------------------------------------------------------------------
  // useCallback: resetLocalEditorState
  // ---------------------------------------------------------------------------

  const resetLocalEditorState = useCallback(() => {
    localFileReadVersionRef.current += 1
    localTreeLoadVersionRef.current += 1
    if (localSaveTimerRef.current) {
      clearTimeout(localSaveTimerRef.current)
      localSaveTimerRef.current = null
    }
    setSelectedLocalFolderPath(null)
    setSelectedLocalFilePath(null)
    setLocalEditorNote(null)
    setLocalEditorLoading(false)
    localFolderDialogsResetRef.current()
    setLocalSaveConflictDialog(null)
    setLocalSaveConflictSubmitting(false)
    resetLocalSearch()
    localSaveBlockedByConflictRef.current = false
    localOpenFileRef.current = null
    localOpeningFileRef.current = null
    localOpeningFileTaskRef.current = null
    localOpenFileMetaRef.current = null
    localPendingContentRef.current = null
    localAutoDraftRef.current = null
  }, [resetLocalSearch])

  // ---------------------------------------------------------------------------
  // useCallback: handleUpdateLocalFile
  // ---------------------------------------------------------------------------

  const handleUpdateLocalFile = useCallback((_id: string, updates: { title?: string; content?: string }) => {
    if (updates.content === undefined) return

    const nextContent = updates.content
    const currentLocalNote = localEditorNoteRef.current
    if (currentLocalNote && currentLocalNote.content === nextContent) return

    const openFile = localOpenFileRef.current
    if (openFile && nextContent !== localAutoDraftRef.current?.initialContent) {
      markLocalAutoDraftTouched(openFile.notebookId, openFile.relativePath)
    }
    setLocalEditorNote((prev) => {
      if (!prev) return prev
      if (prev.content === nextContent) return prev
      return {
        ...prev,
        content: nextContent,
        updated_at: new Date().toISOString(),
      }
    })
    if (openFile) {
      localPendingContentRef.current = {
        content: nextContent,
        notebookId: openFile.notebookId,
        relativePath: openFile.relativePath,
      }
    }
    if (!localSaveBlockedByConflictRef.current) {
      scheduleLocalFileSave()
    }
  }, [markLocalAutoDraftTouched, scheduleLocalFileSave])

  // ---------------------------------------------------------------------------
  // useCallback: openLocalFile
  // ---------------------------------------------------------------------------

  const openLocalFile = useCallback(async (
    relativePath: string,
    notebookIdOverride?: string
  ): Promise<LocalFolderFileContent | null> => {
    const targetNotebookId = notebookIdOverride || selectedNotebookId
    if (!targetNotebookId) return null
    const selectedNotebook = notebooks.find((item) => item.id === targetNotebookId)
    if (!selectedNotebook || selectedNotebook.source_type !== 'local-folder') return null

    const currentOpeningFile = localOpeningFileRef.current
    const isSameInFlightRequest = Boolean(
      currentOpeningFile
      && currentOpeningFile.notebookId === targetNotebookId
      && currentOpeningFile.relativePath === relativePath
    )
    if (isSameInFlightRequest) {
      const inFlightTask = localOpeningFileTaskRef.current
      if (inFlightTask) return inFlightTask
      // Recover from stale in-flight marker.
      localOpeningFileRef.current = null
    }
    localOpeningFileRef.current = { notebookId: targetNotebookId, relativePath }

    const openTaskHolder: { task: Promise<LocalFolderFileContent | null> | null } = { task: null }
    const openTask = (async (): Promise<LocalFolderFileContent | null> => {
      const currentOpenFile = localOpenFileRef.current
      const isSwitchingFile = Boolean(
        currentOpenFile
        && (
          currentOpenFile.notebookId !== targetNotebookId
          || currentOpenFile.relativePath !== relativePath
        )
      )
      if (isSwitchingFile) {
        (document.activeElement as HTMLElement | null)?.blur?.()
      }

      const requestVersion = localFileReadVersionRef.current + 1
      localFileReadVersionRef.current = requestVersion
      setSelectedLocalFilePath(relativePath)
      setLocalEditorLoading(true)

      try {
        await flushLocalFileSave()
        if (requestVersion !== localFileReadVersionRef.current) return null
        await cleanupLocalAutoDraftIfNeeded(
          { notebookId: targetNotebookId, relativePath },
          { skipFlush: true }
        )
        if (requestVersion !== localFileReadVersionRef.current) return null

        const result = await window.electron.localFolder.readFile({
          notebook_id: targetNotebookId,
          relative_path: relativePath,
        })
        if (requestVersion !== localFileReadVersionRef.current) return null

        if (!result.success) {
          toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
          setLocalEditorNote(null)
          localOpenFileRef.current = null
          localOpenFileMetaRef.current = null
          localPendingContentRef.current = null
          return null
        }

        setLocalEditorNote(buildLocalEditorNote(result.result))
        localOpenFileRef.current = {
          notebookId: targetNotebookId,
          relativePath,
        }
        localOpenFileMetaRef.current = {
          size: result.result.size,
          mtimeMs: result.result.mtime_ms,
          contentHash: result.result.content_hash,
          etag: result.result.etag,
        }
        localSaveBlockedByConflictRef.current = false
        setLocalSaveConflictDialog(null)
        localPendingContentRef.current = null
        return result.result
      } catch (error) {
        if (requestVersion !== localFileReadVersionRef.current) return null
        console.error('Failed to open local file:', error)
        toast(t.notebook.fileOpenFailed, { type: 'error' })
        setLocalEditorNote(null)
        localOpenFileRef.current = null
        localOpenFileMetaRef.current = null
        localPendingContentRef.current = null
        return null
      } finally {
        const currentOpening = localOpeningFileRef.current
        if (
          currentOpening
          && currentOpening.notebookId === targetNotebookId
          && currentOpening.relativePath === relativePath
          && localOpeningFileTaskRef.current === openTaskHolder.task
        ) {
          localOpeningFileRef.current = null
          localOpeningFileTaskRef.current = null
        }
        if (requestVersion === localFileReadVersionRef.current) {
          setLocalEditorLoading(false)
        }
      }
    })()

    openTaskHolder.task = openTask
    localOpeningFileTaskRef.current = openTask
    return openTask
  }, [
    buildLocalEditorNote,
    cleanupLocalAutoDraftIfNeeded,
    flushLocalFileSave,
    notebooks,
    resolveLocalFileErrorMessage,
    selectedNotebookId,
    t.notebook.fileOpenFailed,
  ])

  // ---------------------------------------------------------------------------
  // useCallback: handleSelectLocalFile
  // ---------------------------------------------------------------------------

  const handleSelectLocalFile = useCallback(async (file: LocalFolderFileEntry) => {
    const isSameSelectionLoading = Boolean(
      localEditorLoading
      && selectedLocalFilePath === file.relative_path
    )
    if (isSameSelectionLoading) {
      return
    }

    const currentOpenFile = localOpenFileRef.current
    const isSameAlreadyOpen = Boolean(
      currentOpenFile
      && currentOpenFile.notebookId === selectedNotebookId
      && currentOpenFile.relativePath === file.relative_path
      && localEditorNote
    )
    if (isSameAlreadyOpen) {
      return
    }
    await openLocalFile(file.relative_path)
  }, [localEditorLoading, localEditorNote, openLocalFile, selectedLocalFilePath, selectedNotebookId])

  // ---------------------------------------------------------------------------
  // useCallback: getDefaultLocalCreateName
  // ---------------------------------------------------------------------------

  const getDefaultLocalCreateName = useCallback((kind: 'file' | 'folder', parentRelativePath: string | null): string => {
    const baseName = kind === 'file' ? t.notebook.defaultNewFile : t.notebook.defaultNewFolder
    const normalizedParentPath = parentRelativePath || ''

    if (kind === 'file') {
      const existingFileNames = new Set(
        (localFolderTree?.files || [])
          .filter((file) => file.folder_relative_path === normalizedParentPath)
          .map((file) => file.file_name.toLowerCase())
      )
      for (let index = 1; index <= 10000; index += 1) {
        const candidateBase = index === 1 ? baseName : `${baseName} ${index}`
        const candidateFileName = `${candidateBase}.md`.toLowerCase()
        if (!existingFileNames.has(candidateFileName)) {
          return candidateBase
        }
      }
      return `${baseName} ${Date.now()}`
    }

    const existingFolderNames = new Set<string>()
    if (!parentRelativePath) {
      for (const node of localFolderTree?.tree || []) {
        if (node.kind === 'folder') {
          existingFolderNames.add(node.name.toLowerCase())
        }
      }
    } else {
      const parentFolderNode = findFolderNodeByPath(localFolderTree?.tree || [], parentRelativePath)
      for (const child of parentFolderNode?.children || []) {
        if (child.kind === 'folder') {
          existingFolderNames.add(child.name.toLowerCase())
        }
      }
    }

    for (let index = 1; index <= 10000; index += 1) {
      const candidate = index === 1 ? baseName : `${baseName} ${index}`
      if (!existingFolderNames.has(candidate.toLowerCase())) {
        return candidate
      }
    }
    return `${baseName} ${Date.now()}`
  }, [localFolderTree, t.notebook.defaultNewFile, t.notebook.defaultNewFolder])

  // ---------------------------------------------------------------------------
  // useCallback: resolveLocalCreateParentPath
  // ---------------------------------------------------------------------------

  const resolveLocalCreateParentPath = useCallback((resolveOptions?: {
    parentRelativePath?: string | null
    fileRelativePath?: string | null
  }): string | null => {
    const selectedFilePath = resolveOptions?.fileRelativePath ?? selectedLocalFilePath
    const selectedFile = selectedFilePath
      ? (localFolderTree?.files || []).find((file) => file.relative_path === selectedFilePath) || null
      : null
    const hasExplicitParent = Boolean(resolveOptions && Object.prototype.hasOwnProperty.call(resolveOptions, 'parentRelativePath'))
    return hasExplicitParent
      ? resolveOptions?.parentRelativePath ?? null
      : (selectedLocalFolderPath !== null
        ? selectedLocalFolderPath
        : (selectedFile?.folder_relative_path || null))
  }, [localFolderTree, selectedLocalFilePath, selectedLocalFolderPath])

  // ---------------------------------------------------------------------------
  // useCallback: createLocalFileWithoutDialog
  // ---------------------------------------------------------------------------

  const createLocalFileWithoutDialog = useCallback(async (createOptions?: {
    parentRelativePath?: string | null
    preferredName?: string
    autoDraft?: boolean
    openAfterCreate?: boolean
  }): Promise<{ relativePath: string; file?: LocalFolderFileContent } | null> => {
    if (!selectedNotebookId) return null
    const selectedNotebook = notebooks.find((item) => item.id === selectedNotebookId)
    if (!selectedNotebook || selectedNotebook.source_type !== 'local-folder') return null

    const parentRelativePath = createOptions && Object.prototype.hasOwnProperty.call(createOptions, 'parentRelativePath')
      ? resolveLocalCreateParentPath({ parentRelativePath: createOptions.parentRelativePath ?? null })
      : resolveLocalCreateParentPath()
    const normalizedPreferredName = normalizeLocalPreferredFileName(createOptions?.preferredName || '')
    const fallbackName = getDefaultLocalCreateName('file', parentRelativePath)
    const baseName = normalizedPreferredName || fallbackName

    let createdPath: string | null = null
    for (let attempt = 1; attempt <= LOCAL_FILE_CREATE_RETRY_LIMIT; attempt += 1) {
      const candidateName = attempt === 1 ? baseName : `${baseName} ${attempt}`
      const result = await window.electron.localFolder.createFile({
        notebook_id: selectedNotebookId,
        parent_relative_path: parentRelativePath,
        file_name: candidateName,
      })
      if (result.success) {
        createdPath = result.result.relative_path
        break
      }
      if (result.errorCode === 'LOCAL_FILE_ALREADY_EXISTS') {
        continue
      }
      toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
      return null
    }

    if (!createdPath) {
      toast(t.notebook.createErrorAlreadyExists, { type: 'error' })
      return null
    }

    suppressLocalWatchRefresh(selectedNotebookId)
    await refreshLocalFolderTree(selectedNotebookId, { showLoading: false })

    if (createOptions?.openAfterCreate === false) {
      return { relativePath: createdPath }
    }

    setSelectedLocalFolderPath(parentRelativePath)
    const openedFile = await openLocalFile(createdPath)
    if (createOptions?.autoDraft && openedFile) {
      localAutoDraftRef.current = {
        notebookId: selectedNotebookId,
        relativePath: createdPath,
        initialContent: openedFile.tiptap_content,
        initialMeta: {
          size: openedFile.size,
          mtimeMs: openedFile.mtime_ms,
        },
        touched: false,
      }
    } else if (!createOptions?.autoDraft) {
      clearLocalAutoDraft()
    }

    return openedFile
      ? { relativePath: createdPath, file: openedFile }
      : { relativePath: createdPath }
  }, [
    clearLocalAutoDraft,
    getDefaultLocalCreateName,
    notebooks,
    openLocalFile,
    refreshLocalFolderTree,
    resolveLocalCreateParentPath,
    resolveLocalFileErrorMessage,
    selectedNotebookId,
    suppressLocalWatchRefresh,
    t.notebook.createErrorAlreadyExists,
  ])

  // ---------------------------------------------------------------------------
  // useCallback: applyLocalNoteMetadataResult
  // ---------------------------------------------------------------------------

  const applyLocalNoteMetadataResult = useCallback((metadata: LocalNoteMetadata) => {
    const localId = createLocalResourceId(metadata.notebook_id, metadata.relative_path)
    setLocalNoteMetadataById((prev) => {
      const shouldDrop = !metadata.is_favorite && !metadata.is_pinned && !metadata.ai_summary
      if (shouldDrop) {
        if (!prev[localId]) return prev
        const next = { ...prev }
        delete next[localId]
        return next
      }

      const existing = prev[localId]
      if (
        existing
        && existing.is_favorite === metadata.is_favorite
        && existing.is_pinned === metadata.is_pinned
        && existing.ai_summary === metadata.ai_summary
      ) {
        return prev
      }
      return {
        ...prev,
        [localId]: metadata,
      }
    })

    setLocalEditorNote((prev) => {
      if (!prev) return prev
      if (prev.id !== localId) return prev
      return {
        ...prev,
        is_favorite: metadata.is_favorite,
        is_pinned: metadata.is_pinned,
        ai_summary: metadata.ai_summary ?? null,
      }
    })
  }, [])

  // ---------------------------------------------------------------------------
  // useCallback: migrateLocalNoteMetadataInState
  // ---------------------------------------------------------------------------

  const migrateLocalNoteMetadataInState = useCallback((
    notebookId: string,
    fromRelativePath: string,
    toRelativePath: string,
    kind: 'file' | 'folder'
  ) => {
    if (fromRelativePath === toRelativePath) return

    setLocalNoteMetadataById((prev) => {
      let changed = false
      const next: Record<string, LocalNoteMetadata> = { ...prev }
      const fromPrefix = `${fromRelativePath}/`

      for (const [localId, metadata] of Object.entries(prev)) {
        if (metadata.notebook_id !== notebookId) continue
        const isAffected = kind === 'file'
          ? metadata.relative_path === fromRelativePath
          : (metadata.relative_path === fromRelativePath || metadata.relative_path.startsWith(fromPrefix))
        if (!isAffected) continue

        changed = true
        delete next[localId]

        const suffix = metadata.relative_path === fromRelativePath
          ? ''
          : metadata.relative_path.slice(fromRelativePath.length + 1)
        const nextRelativePath = kind === 'file'
          ? toRelativePath
          : (suffix ? `${toRelativePath}/${suffix}` : toRelativePath)
        const nextId = createLocalResourceId(notebookId, nextRelativePath)
        const existing = next[nextId]
        const merged: LocalNoteMetadata = existing
          ? {
            ...existing,
            is_favorite: existing.is_favorite || metadata.is_favorite,
            is_pinned: existing.is_pinned || metadata.is_pinned,
            ai_summary: existing.ai_summary || metadata.ai_summary || null,
            updated_at: metadata.updated_at > existing.updated_at ? metadata.updated_at : existing.updated_at,
          }
          : {
            ...metadata,
            relative_path: nextRelativePath,
          }

        if (!merged.is_favorite && !merged.is_pinned && !merged.ai_summary) {
          delete next[nextId]
          continue
        }

        next[nextId] = merged
      }

      return changed ? next : prev
    })
  }, [])

  // ---------------------------------------------------------------------------
  // useCallback: removeLocalNoteMetadataInState
  // ---------------------------------------------------------------------------

  const removeLocalNoteMetadataInState = useCallback((
    notebookId: string,
    relativePath: string,
    kind: 'file' | 'folder'
  ) => {
    setLocalNoteMetadataById((prev) => {
      let changed = false
      const next: Record<string, LocalNoteMetadata> = { ...prev }
      const prefix = `${relativePath}/`
      for (const [localId, metadata] of Object.entries(prev)) {
        if (metadata.notebook_id !== notebookId) continue
        const shouldDelete = kind === 'file'
          ? metadata.relative_path === relativePath
          : (metadata.relative_path === relativePath || metadata.relative_path.startsWith(prefix))
        if (!shouldDelete) continue
        changed = true
        delete next[localId]
      }
      return changed ? next : prev
    })
  }, [])

  // ---------------------------------------------------------------------------
  // useCallback: updateLocalNoteBusinessMetadata
  // ---------------------------------------------------------------------------

  const updateLocalNoteBusinessMetadata = useCallback(async (
    id: string,
    patch: { is_favorite?: boolean; is_pinned?: boolean; ai_summary?: string | null }
  ): Promise<LocalNoteMetadata | null> => {
    const localRef = parseLocalResourceId(id)
    if (!localRef || !localRef.relativePath) return null

    const result = await window.electron.localFolder.updateNoteMetadata({
      notebook_id: localRef.notebookId,
      relative_path: localRef.relativePath,
      is_favorite: patch.is_favorite,
      is_pinned: patch.is_pinned,
      ai_summary: patch.ai_summary,
    })
    if (!result.success) {
      toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
      return null
    }

    applyLocalNoteMetadataResult(result.result)
    return result.result
  }, [applyLocalNoteMetadataResult, resolveLocalFileErrorMessage])

  // ---------------------------------------------------------------------------
  // useCallback: handleSelectLocalFolder
  // ---------------------------------------------------------------------------

  const handleSelectLocalFolder = useCallback((folderPath: string | null) => {
    void (async () => {
      await flushLocalFileSave()
      await cleanupLocalAutoDraftIfNeeded(null, { skipFlush: true })
      setSelectedLocalFolderPath(folderPath)
      setSelectedLocalFilePath(null)
      setLocalEditorNote(null)
      setLocalEditorLoading(false)
      localFileReadVersionRef.current += 1
      localOpenFileRef.current = null
      localOpeningFileRef.current = null
      localOpeningFileTaskRef.current = null
      localOpenFileMetaRef.current = null
      localSaveBlockedByConflictRef.current = false
      setLocalSaveConflictDialog(null)
      localPendingContentRef.current = null
      clearLocalAutoDraft()
    })()
  }, [cleanupLocalAutoDraftIfNeeded, clearLocalAutoDraft, flushLocalFileSave])

  // ---------------------------------------------------------------------------
  // useLocalFolderDialogs
  // ---------------------------------------------------------------------------

  const localFolderDialogs = useLocalFolderDialogs({
    selectedNotebookId,
    notebooks,
    localFolderTree,
    selectedLocalFilePath,
    selectedLocalFolderPath,
    resolveLocalCreateParentPath,
    getDefaultLocalCreateName,
    resolveLocalFileErrorMessage,
    openLocalFile,
    flushLocalFileSave,
    suppressLocalWatchRefresh,
    refreshLocalFolderTree,
    getOpenFileInfo: () => localOpenFileRef.current,
    onSelectionChange: (updates) => {
      if ('localFilePath' in updates) setSelectedLocalFilePath(updates.localFilePath ?? null)
      if ('localFolderPath' in updates) setSelectedLocalFolderPath(updates.localFolderPath ?? null)
    },
    onMetadataMigrate: migrateLocalNoteMetadataInState,
    onMetadataRemove: removeLocalNoteMetadataInState,
    onAutoDraftClearIfNeeded: (notebookId, relativePath, kind) => {
      const autoDraft = localAutoDraftRef.current
      if (
        autoDraft
        && autoDraft.notebookId === notebookId
        && (
          kind === 'file'
            ? autoDraft.relativePath === relativePath
            : autoDraft.relativePath === relativePath
              || autoDraft.relativePath.startsWith(`${relativePath}/`)
        )
      ) {
        clearLocalAutoDraft()
      }
    },
    onLocalEditorClear: () => {
      setLocalEditorNote(null)
      setLocalEditorLoading(false)
      localFileReadVersionRef.current += 1
      localOpenFileRef.current = null
      localOpeningFileRef.current = null
      localOpeningFileTaskRef.current = null
      localOpenFileMetaRef.current = null
      localSaveBlockedByConflictRef.current = false
      setLocalSaveConflictDialog(null)
      localPendingContentRef.current = null
    },
    allViewLocalEditorTarget,
    setAllViewLocalEditorTarget,
  })
  localFolderDialogsResetRef.current = localFolderDialogs.resetDialogs

  // ---------------------------------------------------------------------------
  // useCallback: handleResolveLocalSaveConflictReload
  // ---------------------------------------------------------------------------

  const handleResolveLocalSaveConflictReload = useCallback(async () => {
    if (!selectedNotebookId || !localSaveConflictDialog) return

    setLocalSaveConflictSubmitting(true)
    try {
      const result = await window.electron.localFolder.readFile({
        notebook_id: selectedNotebookId,
        relative_path: localSaveConflictDialog.relativePath,
      })
      if (!result.success) {
        toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
        return
      }

      setLocalEditorNote(buildLocalEditorNote(result.result))
      localOpenFileRef.current = {
        notebookId: selectedNotebookId,
        relativePath: localSaveConflictDialog.relativePath,
      }
      localOpenFileMetaRef.current = {
        size: result.result.size,
        mtimeMs: result.result.mtime_ms,
        contentHash: result.result.content_hash,
        etag: result.result.etag,
      }
      localPendingContentRef.current = null
      localSaveBlockedByConflictRef.current = false
      setLocalSaveConflictDialog(null)
    } catch (error) {
      console.error('Failed to reload local file after conflict:', error)
      toast(t.notebook.fileOpenFailed, { type: 'error' })
    } finally {
      setLocalSaveConflictSubmitting(false)
    }
  }, [
    buildLocalEditorNote,
    localSaveConflictDialog,
    resolveLocalFileErrorMessage,
    selectedNotebookId,
    t.notebook.fileOpenFailed,
  ])

  // ---------------------------------------------------------------------------
  // useCallback: handleResolveLocalSaveConflictOverwrite
  // ---------------------------------------------------------------------------

  const handleResolveLocalSaveConflictOverwrite = useCallback(async () => {
    if (!selectedNotebookId || !localSaveConflictDialog) return

    setLocalSaveConflictSubmitting(true)
    try {
      const result = await window.electron.localFolder.saveFile({
        notebook_id: selectedNotebookId,
        relative_path: localSaveConflictDialog.relativePath,
        tiptap_content: localSaveConflictDialog.pendingContent,
        force: true,
      })
      if (!result.success) {
        toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
        return
      }

      localOpenFileMetaRef.current = {
        size: result.result.size,
        mtimeMs: result.result.mtime_ms,
        contentHash: result.result.content_hash,
        etag: result.result.etag,
      }
      localPendingContentRef.current = null
      localSaveBlockedByConflictRef.current = false
      setLocalSaveConflictDialog(null)
      suppressLocalWatchRefresh(selectedNotebookId)
    } catch (error) {
      console.error('Failed to overwrite local file after conflict:', error)
      toast(t.notebook.fileSaveFailed, { type: 'error' })
    } finally {
      setLocalSaveConflictSubmitting(false)
    }
  }, [localSaveConflictDialog, resolveLocalFileErrorMessage, selectedNotebookId, suppressLocalWatchRefresh, t.notebook.fileSaveFailed])

  // ---------------------------------------------------------------------------
  // useCallback: handleResolveLocalSaveConflictSaveAsCopy
  // ---------------------------------------------------------------------------

  const handleResolveLocalSaveConflictSaveAsCopy = useCallback(async () => {
    if (!selectedNotebookId || !localSaveConflictDialog) return

    const currentFile = (localFolderTree?.files || []).find((file) => file.relative_path === localSaveConflictDialog.relativePath) || null
    if (!currentFile) {
      toast(t.notebook.fileOpenFailed, { type: 'error' })
      return
    }

    const parentRelativePath = currentFile.folder_relative_path || null
    const siblingNames = new Set(
      (localFolderTree?.files || [])
        .filter((file) => file.folder_relative_path === (currentFile.folder_relative_path || ''))
        .map((file) => file.file_name.toLowerCase())
    )

    let candidateIndex = 1
    let candidateFileName = ''
    while (true) {
      const suffix = candidateIndex === 1 ? ' copy' : ` copy ${candidateIndex}`
      candidateFileName = `${currentFile.name}${suffix}.${currentFile.extension}`
      if (!siblingNames.has(candidateFileName.toLowerCase())) {
        break
      }
      candidateIndex += 1
    }

    setLocalSaveConflictSubmitting(true)
    try {
      const created = await window.electron.localFolder.createFile({
        notebook_id: selectedNotebookId,
        parent_relative_path: parentRelativePath,
        file_name: candidateFileName,
      })
      if (!created.success) {
        toast(resolveLocalFileErrorMessage(created.errorCode), { type: 'error' })
        return
      }

      const saved = await window.electron.localFolder.saveFile({
        notebook_id: selectedNotebookId,
        relative_path: created.result.relative_path,
        tiptap_content: localSaveConflictDialog.pendingContent,
        force: true,
      })
      if (!saved.success) {
        toast(resolveLocalFileErrorMessage(saved.errorCode), { type: 'error' })
        return
      }

      localPendingContentRef.current = null
      localSaveBlockedByConflictRef.current = false
      setLocalSaveConflictDialog(null)

      suppressLocalWatchRefresh(selectedNotebookId)
      await refreshLocalFolderTree(selectedNotebookId, { showLoading: false })
      await openLocalFile(created.result.relative_path)
      toast(t.notebook.fileConflictSavedAsCopy, { type: 'success' })
    } catch (error) {
      console.error('Failed to save conflict copy:', error)
      toast(t.notebook.fileSaveFailed, { type: 'error' })
    } finally {
      setLocalSaveConflictSubmitting(false)
    }
  }, [
    localFolderTree,
    localSaveConflictDialog,
    openLocalFile,
    refreshLocalFolderTree,
    resolveLocalFileErrorMessage,
    selectedNotebookId,
    suppressLocalWatchRefresh,
    t.notebook.fileConflictSavedAsCopy,
    t.notebook.fileOpenFailed,
    t.notebook.fileSaveFailed,
  ])

  // ---------------------------------------------------------------------------
  // useCallback: refreshOpenLocalFileFromDisk
  // ---------------------------------------------------------------------------

  const refreshOpenLocalFileFromDisk = useCallback(async (refreshFileOptions?: { changedRelativePath?: string | null }): Promise<void> => {
    const openFile = localOpenFileRef.current
    if (!openFile) return
    const changedRelativePath = refreshFileOptions?.changedRelativePath ?? null
    if (changedRelativePath && openFile.relativePath !== changedRelativePath) return
    if (
      localPendingContentRef.current
      || localSaveTaskRef.current
      || localSaveTimerRef.current
      || localSaveBlockedByConflictRef.current
    ) {
      return
    }

    const isSelectedNotebookLocalTarget = Boolean(
      isLocalFolderNotebookSelected && selectedNotebookId === openFile.notebookId
    )
    const isAllViewLocalTarget = Boolean(
      isAllViewLocalEditorActive
      && allViewLocalEditorTarget
      && allViewLocalEditorTarget.notebookId === openFile.notebookId
      && allViewLocalEditorTarget.relativePath === openFile.relativePath
    )
    if (!isSelectedNotebookLocalTarget && !isAllViewLocalTarget) {
      return
    }

    try {
      const result = await window.electron.localFolder.readFile({
        notebook_id: openFile.notebookId,
        relative_path: openFile.relativePath,
      })

      const latestOpenFile = localOpenFileRef.current
      const stillSameFile = Boolean(
        latestOpenFile
        && latestOpenFile.notebookId === openFile.notebookId
        && latestOpenFile.relativePath === openFile.relativePath
      )
      if (!stillSameFile) return
      if (
        localPendingContentRef.current
        || localSaveTaskRef.current
        || localSaveTimerRef.current
        || localSaveBlockedByConflictRef.current
      ) {
        return
      }
      if (!result.success) return

      const currentMeta = localOpenFileMetaRef.current
      const unchangedMeta = Boolean(
        currentMeta
        && currentMeta.size === result.result.size
        && Math.abs(currentMeta.mtimeMs - result.result.mtime_ms) <= 1
        && (
          !currentMeta.contentHash
          || !result.result.content_hash
          || currentMeta.contentHash === result.result.content_hash
        )
      )
      const unchangedContent = localEditorNoteRef.current?.content === result.result.tiptap_content
      if (unchangedMeta && unchangedContent) {
        return
      }

      setLocalEditorNote(buildLocalEditorNote(result.result))
      localOpenFileMetaRef.current = {
        size: result.result.size,
        mtimeMs: result.result.mtime_ms,
        contentHash: result.result.content_hash,
        etag: result.result.etag,
      }
    } catch (error) {
      console.error('Failed to refresh open local file from disk:', error)
    }
  }, [
    allViewLocalEditorTarget,
    buildLocalEditorNote,
    isAllViewLocalEditorActive,
    isLocalFolderNotebookSelected,
    selectedNotebookId,
  ])

  // ---------------------------------------------------------------------------
  // useCallback: handleLocalMountUnavailable
  // ---------------------------------------------------------------------------

  const handleLocalMountUnavailable = useCallback((notebookId: string) => {
    setLocalFolderTree(null)
    setSelectedLocalFilePath(null)
    setLocalEditorNote(null)
    setLocalEditorLoading(false)
    localOpenFileRef.current = null
    localOpenFileMetaRef.current = null
    localPendingContentRef.current = null
    localSaveBlockedByConflictRef.current = false
    setLocalSaveConflictDialog(null)
    clearLocalAutoDraft()
    setAllViewLocalEditorTarget((prev) => (
      prev && prev.notebookId === notebookId ? null : prev
    ))
  }, [clearLocalAutoDraft, setAllViewLocalEditorTarget])

  // ---------------------------------------------------------------------------
  // useCallback: resolveLocalFolderMountErrorMessage
  // ---------------------------------------------------------------------------

  const resolveLocalFolderMountErrorMessage = useCallback((errorCode: string): string => {
    switch (errorCode) {
      case 'LOCAL_MOUNT_PATH_PERMISSION_DENIED':
        return t.notebook.mountErrorPermissionDenied
      case 'LOCAL_MOUNT_PATH_NOT_FOUND':
        return t.notebook.mountErrorNotFound
      case 'LOCAL_NOTEBOOK_NOT_FOUND':
        return t.notebook.localFolderMissing
      case 'LOCAL_MOUNT_ALREADY_EXISTS':
        return t.notebook.mountErrorAlreadyExists
      case 'LOCAL_MOUNT_PATH_UNREACHABLE':
        return t.notebook.mountErrorUnreachable
      case 'LOCAL_MOUNT_INVALID_PATH':
      default:
        return t.notebook.mountErrorInvalidPath
    }
  }, [t.notebook])

  // ---------------------------------------------------------------------------
  // useCallback: handleOpenLocalFolderInFileManager
  // ---------------------------------------------------------------------------

  const handleOpenLocalFolderInFileManager = useCallback(async (notebookId: string) => {
    try {
      const opened = await window.electron.localFolder.openInFileManager(notebookId)
      if (!opened) {
        toast(t.notebook.mountErrorNotFound, { type: 'error' })
      }
    } catch (error) {
      console.error('Failed to open local folder in file manager:', error)
      toast(t.notebook.mountErrorUnreachable, { type: 'error' })
    }
  }, [
    t.notebook.mountErrorNotFound,
    t.notebook.mountErrorUnreachable,
  ])

  // ---------------------------------------------------------------------------
  // useCallback: handleAddLocalFolder
  // ---------------------------------------------------------------------------

  const handleAddLocalFolder = useCallback(async () => {
    try {
      await flushLocalFileSave()
      await cleanupLocalAutoDraftIfNeeded(null, { skipFlush: true })
      const rootPath = await window.electron.localFolder.selectRoot()
      if (!rootPath) return

      const mounted = await window.electron.localFolder.mount({ root_path: rootPath })
      if (!mounted.success) {
        toast(resolveLocalFolderMountErrorMessage(mounted.errorCode), { type: 'error' })
        return
      }

      const notebooksData = await window.electron.notebook.getAll()
      setNotebooks(notebooksData as Notebook[])
      setLocalFolderStatuses((prev) => ({ ...prev, [mounted.result.notebook.id]: 'active' }))
      setSelectedNotebookId(mounted.result.notebook.id)
      setSelectedSmartView(null)
      setIsTypewriterMode(false)
      setSelectedNoteIds([])
      setAnchorNoteId(null)
      resetLocalEditorState()
    } catch (error) {
      console.error('Failed to mount local folder:', error)
      toast(resolveLocalFolderMountErrorMessage('LOCAL_MOUNT_PATH_UNREACHABLE'), { type: 'error' })
    }
  }, [
    cleanupLocalAutoDraftIfNeeded,
    flushLocalFileSave,
    resetLocalEditorState,
    resolveLocalFolderMountErrorMessage,
    setNotebooks,
    setSelectedNotebookId,
    setSelectedSmartView,
    setIsTypewriterMode,
    setSelectedNoteIds,
    setAnchorNoteId,
  ])

  // ---------------------------------------------------------------------------
  // useCallback: handleRecoverLocalFolderAccess
  // ---------------------------------------------------------------------------

  const handleRecoverLocalFolderAccess = useCallback(async (notebookIdOverride?: string) => {
    const targetNotebookId = notebookIdOverride || selectedNotebookId
    if (!targetNotebookId) return
    try {
      const rootPath = await window.electron.localFolder.selectRoot()
      if (!rootPath) return

      const relinked = await window.electron.localFolder.relink({
        notebook_id: targetNotebookId,
        root_path: rootPath,
      })
      if (!relinked.success) {
        toast(resolveLocalFolderMountErrorMessage(relinked.errorCode), { type: 'error' })
        return
      }

      setLocalFolderStatuses((prev) => ({ ...prev, [targetNotebookId]: 'active' }))
      await refreshLocalFolderTree(targetNotebookId)
      await refreshOpenLocalFileFromDisk()
      toast(t.notebook.localFolderRecovered, { type: 'success' })
    } catch (error) {
      console.error('Failed to relink local folder mount:', error)
      toast(resolveLocalFolderMountErrorMessage('LOCAL_MOUNT_PATH_UNREACHABLE'), { type: 'error' })
    }
  }, [
    refreshOpenLocalFileFromDisk,
    refreshLocalFolderTree,
    resolveLocalFolderMountErrorMessage,
    selectedNotebookId,
    t.notebook.localFolderRecovered,
  ])

  // ---------------------------------------------------------------------------
  // cleanupUnmountedLocalNotebook
  // ---------------------------------------------------------------------------

  const cleanupUnmountedLocalNotebook = useCallback((notebookId: string) => {
    setLocalFolderStatuses((prev) => {
      const next = { ...prev }
      delete next[notebookId]
      return next
    })
    setLocalNotebookHasChildFolders((prev) => {
      if (!(notebookId in prev)) return prev
      const next = { ...prev }
      delete next[notebookId]
      return next
    })
    setLocalFolderTreeCache((prev) => {
      if (!(notebookId in prev)) return prev
      const next = { ...prev }
      delete next[notebookId]
      return next
    })
    setLocalFolderTreeDirty((prev) => {
      if (!(notebookId in prev)) return prev
      const next = { ...prev }
      delete next[notebookId]
      return next
    })
    setLocalNotebookNoteCounts((prev) => {
      if (!(notebookId in prev)) return prev
      const next = { ...prev }
      delete next[notebookId]
      return next
    })
    setLocalNoteMetadataById((prev) => {
      let changed = false
      const next: Record<string, LocalNoteMetadata> = {}
      for (const [localId, metadata] of Object.entries(prev)) {
        if (metadata.notebook_id === notebookId) {
          changed = true
          continue
        }
        next[localId] = metadata
      }
      return changed ? next : prev
    })
  }, [])

  // ---------------------------------------------------------------------------
  // useLocalFolderWatchEvents
  // ---------------------------------------------------------------------------

  useLocalFolderWatchEvents({
    allViewLocalEditorTarget,
    selectedNotebookId,
    isLocalFolderNotebookSelected,
    localFolderMissingText: t.notebook.localFolderMissing,
    localFolderPermissionRequiredText: t.notebook.localFolderPermissionRequired,
    refreshLocalFolderTree,
    refreshOpenLocalFileFromDisk,
    onLocalMountUnavailable: handleLocalMountUnavailable,
    localWatchRefreshTimersRef,
    localWatchRefreshSuppressUntilRef,
    localStatusToastAtRef,
    localWatchSequenceRef,
    setLocalFolderStatuses,
    setLocalFolderTreeDirty,
    setLocalFolderTreeCache,
    setLocalNotebookNoteCounts,
    setLocalNotebookHasChildFolders,
  })

  // ---------------------------------------------------------------------------
  // useEffect: Persist localNotebookNoteCounts to localStorage
  // ---------------------------------------------------------------------------

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_LOCAL_NOTE_COUNTS, JSON.stringify(localNotebookNoteCounts))
    } catch {
      // ignore storage errors
    }
  }, [localNotebookNoteCounts])

  // ---------------------------------------------------------------------------
  // useEffect: Cleanup stale localNotebookNoteCounts entries when notebooks change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const localNotebookIds = new Set(
      notebooks
        .filter((notebook) => notebook.source_type === 'local-folder')
        .map((notebook) => notebook.id)
    )
    setLocalNotebookNoteCounts((prev) => {
      let changed = false
      const next: Record<string, number> = {}
      for (const [notebookId, count] of Object.entries(prev)) {
        if (!localNotebookIds.has(notebookId)) {
          changed = true
          continue
        }
        next[notebookId] = count
      }
      return changed ? next : prev
    })

    const sequenceMap = localWatchSequenceRef.current
    for (const notebookId of Array.from(sequenceMap.keys())) {
      if (!localNotebookIds.has(notebookId)) {
        sequenceMap.delete(notebookId)
      }
    }
  }, [notebooks])

  // ---------------------------------------------------------------------------
  // useEffect: Clear allViewLocalEditorTarget when leaving all-source view
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (isAllSourceViewActive) return
    if (!allViewLocalEditorTarget) return
    setAllViewLocalEditorTarget(null)
  }, [allViewLocalEditorTarget, isAllSourceViewActive, setAllViewLocalEditorTarget])

  // ---------------------------------------------------------------------------
  // useEffect: Apply localNoteMetadataById to localEditorNote
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setLocalEditorNote((prev) => {
      if (!prev) return prev
      return applyLocalNoteMetadataToNote(prev, localNoteMetadataById)
    })
  }, [localNoteMetadataById])

  // ---------------------------------------------------------------------------
  // useEffect: Load local folder tree when selecting local notebook
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedNotebookId || !isLocalFolderNotebookSelected) {
      localTreeLoadVersionRef.current += 1
      setLocalFolderTree(null)
      setLocalFolderTreeLoading(false)
      return
    }
    const cachedTree = localFolderTreeCache[selectedNotebookId]
    const isDirty = localFolderTreeDirty[selectedNotebookId] ?? !cachedTree
    if (cachedTree) {
      setLocalFolderTree(cachedTree)
      if (!isDirty) {
        setLocalFolderTreeLoading(false)
        return
      }
      void refreshLocalFolderTree(selectedNotebookId, { showLoading: false })
      return
    }
    void refreshLocalFolderTree(selectedNotebookId)
  }, [
    selectedNotebookId,
    isLocalFolderNotebookSelected,
    localFolderTreeCache,
    localFolderTreeDirty,
    refreshLocalFolderTree,
  ])

  // ---------------------------------------------------------------------------
  // useEffect: Warmup stale local folder summaries in all-source view
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isGlobalLocalAwareView) return

    const staleNotebookIds = notebooks
      .filter((notebook) => notebook.source_type === 'local-folder')
      .map((notebook) => notebook.id)
      .filter((notebookId) => (
        localFolderStatuses[notebookId] === 'active'
        && ((localFolderTreeDirty[notebookId] ?? false) || !localFolderTreeCache[notebookId])
      ))

    if (staleNotebookIds.length === 0) return

    let cancelled = false
    const refreshAllViewLocalSummaries = async () => {
      try {
        const mounts = await window.electron.localFolder.list()
        if (cancelled) return
        await warmupLocalNotebookSummaries(mounts, { notebookIds: staleNotebookIds })
      } catch (error) {
        console.warn('[local-folder] all-view warmup failed:', error)
      }
    }

    void refreshAllViewLocalSummaries()
    return () => {
      cancelled = true
    }
  }, [
    isGlobalLocalAwareView,
    notebooks,
    localFolderStatuses,
    localFolderTreeDirty,
    localFolderTreeCache,
    warmupLocalNotebookSummaries,
  ])

  // ---------------------------------------------------------------------------
  // useEffect: Cancel local search when not in local folder notebook
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (selectedNotebookId && isLocalFolderNotebookSelected && selectedLocalNotebookStatus === 'active') {
      return
    }
    cancelLocalSearch()
  }, [
    cancelLocalSearch,
    isLocalFolderNotebookSelected,
    selectedLocalNotebookStatus,
    selectedNotebookId,
  ])

  // ---------------------------------------------------------------------------
  // useEffect: Validate local folder/file selections against tree
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!localFolderTree) return

    if (selectedLocalFolderPath) {
      const folderExists = Boolean(findFolderNodeByPath(localFolderTree.tree, selectedLocalFolderPath))
      if (!folderExists) {
        setSelectedLocalFolderPath(null)
      }
    }

    if (selectedLocalFilePath) {
      const fileExists = localFolderTree.files.some((file) => file.relative_path === selectedLocalFilePath)
      if (!fileExists) {
        setSelectedLocalFilePath(null)
        if (localOpenFileRef.current?.relativePath === selectedLocalFilePath) {
          setLocalEditorNote(null)
          setLocalEditorLoading(false)
          localFileReadVersionRef.current += 1
          localOpenFileRef.current = null
          localOpenFileMetaRef.current = null
          localSaveBlockedByConflictRef.current = false
          setLocalSaveConflictDialog(null)
          localPendingContentRef.current = null
          clearLocalAutoDraft()
        }
      }
    }
  }, [clearLocalAutoDraft, localFolderTree, selectedLocalFilePath, selectedLocalFolderPath])

  // ---------------------------------------------------------------------------
  // useEffect: Cleanup local auto-draft when leaving local folder editor
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (isLocalFolderNotebookSelected || isAllViewLocalEditorActive) return
    void (async () => {
      await cleanupLocalAutoDraftIfNeeded(null)
      resetLocalEditorState()
    })()
  }, [
    cleanupLocalAutoDraftIfNeeded,
    isAllViewLocalEditorActive,
    isLocalFolderNotebookSelected,
    resetLocalEditorState,
  ])

  // ---------------------------------------------------------------------------
  // useEffect: Local save timer cleanup (on unmount)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const localWatchRefreshTimers = localWatchRefreshTimersRef.current
    return () => {
      if (localSaveTimerRef.current) {
        clearTimeout(localSaveTimerRef.current)
        localSaveTimerRef.current = null
      }
      for (const timer of localWatchRefreshTimers.values()) {
        clearTimeout(timer)
      }
      localWatchRefreshTimers.clear()
      void flushLocalFileSave()
    }
  }, [flushLocalFileSave])

  // ---------------------------------------------------------------------------
  // useCallback: commitLocalFileTitleRename
  // ---------------------------------------------------------------------------

  const commitLocalFileTitleRename = useCallback(async (noteId: string, newTitle: string) => {
    const openFile = localOpenFileRef.current
    if (!openFile) return
    const { notebookId, relativePath } = openFile

    // Must match the currently open file
    const currentNoteId = createLocalResourceId(notebookId, relativePath)
    if (currentNoteId !== noteId) return

    // Guard: no concurrent rename, no conflict, no loading
    if (localRenameInFlightRef.current) return
    if (localSaveBlockedByConflictRef.current) return

    const originalTitle = getLocalResourceFileTitle(relativePath)
    const trimmedTitle = newTitle.trim()

    // No-op if title unchanged
    if (trimmedTitle === originalTitle) return

    // Empty title -> revert
    if (!trimmedTitle) {
      setLocalEditorNote((prev) => {
        if (!prev || prev.id !== currentNoteId) return prev
        if (prev.title === originalTitle) return prev
        return { ...prev, title: originalTitle }
      })
      return
    }

    localRenameInFlightRef.current = true
    try {
      // Flush pending content save to old path first
      await flushLocalFileSave()

      const result = await window.electron.localFolder.renameEntry({
        notebook_id: notebookId,
        relative_path: relativePath,
        kind: 'file',
        new_name: trimmedTitle,
      })

      if (!result.success) {
        toast(resolveLocalFileErrorMessage(result.errorCode), { type: 'error' })
        // Revert title
        setLocalEditorNote((prev) => {
          if (!prev || prev.id !== currentNoteId) return prev
          return { ...prev, title: originalTitle }
        })
        return
      }

      const newRelativePath = result.result.relative_path

      // Stale check: user may have navigated to a different file during the async IPC.
      // If so, skip in-place state swap to avoid corrupting the new file's state.
      const currentRef = localOpenFileRef.current
      const isStale = !currentRef
        || currentRef.notebookId !== notebookId
        || currentRef.relativePath !== relativePath
      if (isStale) {
        // Rename succeeded on disk but we can't do in-place swap.
        // Just refresh tree and migrate metadata so the sidebar reflects the new name.
        migrateLocalNoteMetadataInState(notebookId, relativePath, newRelativePath, 'file')
        suppressLocalWatchRefresh(notebookId)
        void refreshLocalFolderTree(notebookId, { showLoading: false })
        return
      }

      // In-place state swap (no openLocalFile re-read needed)
      migrateLocalNoteMetadataInState(notebookId, relativePath, newRelativePath, 'file')
      setSelectedLocalFilePath(newRelativePath)
      localOpenFileRef.current = { notebookId, relativePath: newRelativePath }
      // Restore conflict-detection meta from rename response so the next save
      // can detect external changes instead of skipping the check entirely.
      if (result.result.mtime_ms != null && result.result.size != null) {
        localOpenFileMetaRef.current = {
          mtimeMs: result.result.mtime_ms,
          size: result.result.size,
          // etag/contentHash are invalidated (etag contains old path, content unchanged)
        }
      } else {
        localOpenFileMetaRef.current = null
      }

      const newNoteId = createLocalResourceId(notebookId, newRelativePath)
      setLocalEditorNote((prev) => {
        if (!prev || prev.id !== currentNoteId) return prev
        return { ...prev, id: newNoteId, title: trimmedTitle }
      })

      setAllViewLocalEditorTarget((prev) =>
        prev && prev.notebookId === notebookId && prev.relativePath === relativePath
          ? { noteId: newNoteId, notebookId, relativePath: newRelativePath }
          : prev
      )

      // Clear auto draft if it references the old path
      const autoDraft = localAutoDraftRef.current
      if (autoDraft && autoDraft.notebookId === notebookId && autoDraft.relativePath === relativePath) {
        localAutoDraftRef.current = null
      }

      suppressLocalWatchRefresh(notebookId)
      void refreshLocalFolderTree(notebookId, { showLoading: false })
    } catch (error) {
      console.error('Failed to rename local file via title edit:', error)
      toast(t.notebook.renameFailed, { type: 'error' })
      // Revert title
      setLocalEditorNote((prev) => {
        if (!prev || prev.id !== currentNoteId) return prev
        return { ...prev, title: originalTitle }
      })
    } finally {
      localRenameInFlightRef.current = false
    }
  }, [
    flushLocalFileSave,
    migrateLocalNoteMetadataInState,
    refreshLocalFolderTree,
    resolveLocalFileErrorMessage,
    setAllViewLocalEditorTarget,
    suppressLocalWatchRefresh,
    t.notebook.renameFailed,
  ])

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    // State
    localFolderTree,
    localFolderTreeCache,
    localFolderTreeDirty,
    localNoteMetadataById,
    localNotebookNoteCounts,
    localFolderTreeLoading,
    localFolderStatuses,
    localNotebookHasChildFolders,
    selectedLocalFolderPath,
    selectedLocalFilePath,
    localEditorNote,
    localEditorLoading,
    localSaveConflictDialog,
    localSaveConflictSubmitting,

    // State setters (exposed for App.tsx loadData effect and useNoteDataChangedReload)
    setLocalNoteMetadataById,
    setLocalFolderStatuses,

    // Refs (only those consumed by external hooks / App.tsx)
    localOpenFileRef,
    localEditorNoteRef,
    localAutoDraftRef,
    flushLocalFileSaveRef,

    // Derived values
    isLocalFolderNotebookSelected,
    isAllSourceViewActive,
    isGlobalLocalAwareView,
    isAllViewLocalEditorActive,
    shouldRenderLocalEditor,
    activeLocalNotebookId,
    activeLocalNotebookStatus,
    selectedLocalNotebookStatus,
    localSearchMatchedPathSet,
    localSearchListLoading,

    // Search (public API)
    localSearchQuery,
    handleLocalSearchQueryChange,
    beginLocalSearchComposition,
    endLocalSearchComposition,

    // Callbacks (public API)
    warmupLocalNotebookSummaries,
    refreshLocalFolderTree,
    flushLocalFileSave,
    cleanupLocalAutoDraftIfNeeded,
    handleUpdateLocalFile,
    openLocalFile,
    handleSelectLocalFile,
    createLocalFileWithoutDialog,
    updateLocalNoteBusinessMetadata,
    handleSelectLocalFolder,
    handleResolveLocalSaveConflictReload,
    handleResolveLocalSaveConflictOverwrite,
    handleResolveLocalSaveConflictSaveAsCopy,
    refreshOpenLocalFileFromDisk,
    handleOpenLocalFolderInFileManager,
    handleAddLocalFolder,
    handleRecoverLocalFolderAccess,
    resetLocalEditorState,
    cleanupUnmountedLocalNotebook,
    commitLocalFileTitleRename,

    // Dialog hook
    localFolderDialogs,
  }
}
