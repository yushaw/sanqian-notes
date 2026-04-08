import type { IpcMain } from 'electron'
import { basename, posix, resolve, sep } from 'path'
import { promises as fsPromises } from 'fs'
import { normalizeComparablePathForFileSystem } from '../path-compat'
import { getStartupPhaseState } from '../startup-phase'
import {
  parseRequiredNotebookIdInput,
} from '../notebook-id'
import { applyLocalFolderMountStatusTransition } from '../local-folder-mount-transition'
import { resolvePersistedUnavailableMountStatus } from '../local-folder-mount-convergence'
import { resolveUnavailableMountStatusFromFsError } from '../local-folder-mount-fs-error'
import {
  createLocalFolderIpcConcurrencyRuntime,
  type LocalFolderIpcConcurrencyRuntime,
} from '../local-folder-ipc-runtime'
import {
  isLocalFolderTreeRootMatched,
  resolveLocalFolderCanonicalOrRootPath,
} from '../local-folder-root-match'
import { emitLocalFolderUnmountAudit } from '../local-folder-audit'
import { createSafeHandler } from './safe-handler'
import type { IfMatchCheckResult } from '../note-gateway'
import type {
  LocalFolderMountCreatePersistResult,
  LocalFolderMountStatusPersistResult,
  LocalFolderAffectedMount,
  LocalFolderAnalyzeDeleteResponse,
  LocalFolderCreateFileInput,
  LocalFolderCreateFileResponse,
  LocalFolderCreateFolderInput,
  LocalFolderCreateFolderResponse,
  LocalFolderDeleteEntryInput,
  LocalFolderDeleteEntryResponse,
  LocalFolderNotebookMount,
  LocalFolderReadFileErrorCode,
  LocalFolderReadFileInput,
  LocalFolderReadFileResponse,
  LocalFolderRenameEntryInput,
  LocalFolderRenameEntryResponse,
  LocalFolderListNoteMetadataResponse,
  LocalFolderUpdateNoteMetadataInput,
  LocalFolderUpdateNoteMetadataResponse,
  LocalFolderSaveFileInput,
  LocalFolderSaveFileResponse,
  LocalFolderFileErrorCode,
  LocalFolderMountErrorCode,
  LocalFolderMountInput,
  LocalFolderListResponse,
  LocalFolderMountRootPersistResult,
  LocalFolderMountResponse,
  LocalFolderGetTreeResponse,
  LocalFolderOpenInFileManagerResponse,
  LocalFolderRelinkInput,
  LocalFolderRelinkResponse,
  LocalFolderSelectRootResponse,
  LocalFolderUnmountResponse,
  LocalFolderTreeResult,
  NotebookStatus,
  Result,
} from '../../shared/types'
import { hasOwnDefinedProperty } from '../../shared/property-guards'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>
type LocalFolderUnavailableFileErrorCode =
  | 'LOCAL_FILE_NOT_FOUND'
  | 'LOCAL_FOLDER_NOT_FOUND'
  | 'LOCAL_FILE_UNREADABLE'
type LocalFolderMountAvailabilityProbeErrorCode =
  | 'LOCAL_FILE_NOT_FOUND'
  | 'LOCAL_FOLDER_NOT_FOUND'
  | 'LOCAL_FILE_UNREADABLE'
const LOCAL_FOLDER_POST_COMMIT_DEFER_ENABLED = process.env.NODE_ENV !== 'test'
  && process.env.LOCAL_FOLDER_POST_COMMIT_DEFER_ENABLED !== '0'
const LOCAL_FOLDER_POST_COMMIT_DEFER_DELAY_MS = Number.isFinite(
  Number(process.env.LOCAL_FOLDER_POST_COMMIT_DEFER_DELAY_MS)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_FOLDER_POST_COMMIT_DEFER_DELAY_MS)))
  : 0
const LOCAL_FOLDER_GET_TREE_FAST_LOAD_ENABLED = process.env.NODE_ENV !== 'test'
  && process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_ENABLED !== '0'
// Long-term default: fast-load should cover newly mounted large folders too,
// not only startup. Restrict to startup only when explicitly enabled.
const LOCAL_FOLDER_GET_TREE_FAST_LOAD_STARTUP_ONLY = process.env.LOCAL_FOLDER_GET_TREE_FAST_LOAD_STARTUP_ONLY === '1'
const LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_ENABLED = process.env.NODE_ENV !== 'test'
  && process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_ENABLED !== '0'
const LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_DELAY_MS = Number.isFinite(
  Number(process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_DELAY_MS)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_DELAY_MS)))
  : 120
const LOCAL_FOLDER_GET_TREE_CACHE_MAX_AGE_MS = Number.isFinite(
  Number(process.env.LOCAL_FOLDER_GET_TREE_CACHE_MAX_AGE_MS)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_FOLDER_GET_TREE_CACHE_MAX_AGE_MS)))
  : (process.env.NODE_ENV === 'test' ? 0 : 1500)
const LOCAL_FOLDER_PREVIEW_WARMUP_READY_KEYS_MAX = 512
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i
const SUMMARY_CONTENT_HASH_HEX_PATTERN = /^[a-f0-9]{32}$/i
const LOCAL_FOLDER_ROOT_PATH_MAX_LENGTH = 4096
const LOCAL_FOLDER_RELATIVE_PATH_MAX_LENGTH = 4096
const LOCAL_FOLDER_ENTRY_NAME_MAX_LENGTH = 255
const LOCAL_FOLDER_NOTEBOOK_NAME_MAX_LENGTH = 200
const LOCAL_FOLDER_NOTEBOOK_ICON_MAX_LENGTH = 64
const LOCAL_FOLDER_NOTEBOOK_ID_MAX_LENGTH = 1024
const LOCAL_FOLDER_IF_MATCH_MAX_LENGTH = 1024
const LOCAL_FOLDER_LIST_NOTE_METADATA_MAX_NOTEBOOK_IDS = 2000
const LOCAL_FOLDER_NOTE_METADATA_TEXT_MAX_LENGTH = 16 * 1024
const LOCAL_FOLDER_NOTE_METADATA_TAGS_MAX_ITEMS = 256
const LOCAL_FOLDER_NOTE_METADATA_TAG_MAX_LENGTH = 256

// --- Helper functions (moved from index.ts, only used by local folder IPC) ---

async function canonicalizeLocalFolderPathAsync(rootPath: string): Promise<{ ok: true; canonicalPath: string } | { ok: false; errorCode: LocalFolderMountErrorCode }> {
  const trimmedPath = rootPath.trim()
  if (!trimmedPath) {
    return { ok: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' }
  }

  try {
    const absolutePath = resolve(trimmedPath)
    const realPath = await fsPromises.realpath(absolutePath)
    const stat = await fsPromises.stat(realPath)
    if (!stat.isDirectory()) {
      return { ok: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' }
    }
    const canonicalPath = normalizeComparablePathForFileSystem(realPath, realPath)

    return { ok: true, canonicalPath }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'EACCES' || code === 'EPERM') {
      return { ok: false, errorCode: 'LOCAL_MOUNT_PATH_PERMISSION_DENIED' }
    }
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { ok: false, errorCode: 'LOCAL_MOUNT_PATH_NOT_FOUND' }
    }
    return { ok: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
  }
}

function isSameOrChildPath(targetPath: string, candidatePath: string): boolean {
  if (candidatePath === targetPath) return true
  const prefix = targetPath.endsWith(sep) ? targetPath : `${targetPath}${sep}`
  return candidatePath.startsWith(prefix)
}

export interface LocalFolderIpcDeps {
  // Mount queries
  getLocalFolderMounts: () => LocalFolderNotebookMount[]
  getLocalFolderMountByCanonicalPath: (
    canonicalPath: string,
    options?: { activeOnly?: boolean; excludeNotebookId?: string }
  ) => { notebook_id: string; status: NotebookStatus } | null
  getLocalFolderMountByNotebookId: (notebookId: string) => { root_path: string; status?: NotebookStatus } | null
  // Mount mutations
  createLocalFolderNotebookMountSafe: (input: {
    name: string
    icon?: string
    root_path: string
    canonical_root_path: string
    status?: NotebookStatus
  }) => LocalFolderMountCreatePersistResult
  updateLocalFolderMountRoot: (input: {
    notebook_id: string
    root_path: string
    canonical_root_path: string
    status?: NotebookStatus
  }) => LocalFolderMountRootPersistResult
  updateLocalFolderMountStatus: (
    notebookId: string,
    status: NotebookStatus
  ) => LocalFolderMountStatusPersistResult
  // File operations (async versions -- avoid blocking main process)
  readLocalFolderFileAsync: (mount: LocalFolderNotebookMount, relativePath: string) => Promise<LocalFolderReadFileResponse>
  saveLocalFolderFileAsync: (
    mount: LocalFolderNotebookMount,
    relativePath: string,
    tiptapContent: string,
    options?: {
      expectedMtimeMs?: number
      expectedSize?: number
      expectedContentHash?: string
      force?: boolean
    }
  ) => Promise<LocalFolderSaveFileResponse>
  createLocalFolderFileAsync: (mount: LocalFolderNotebookMount, parentRelativePath: string | null, fileName: string) => Promise<LocalFolderCreateFileResponse>
  createLocalFolderAsync: (mount: LocalFolderNotebookMount, parentRelativePath: string | null, folderName: string) => Promise<LocalFolderCreateFolderResponse>
  renameLocalFolderEntryAsync: (mount: LocalFolderNotebookMount, input: LocalFolderRenameEntryInput) => Promise<LocalFolderRenameEntryResponse>
  resolveLocalFolderDeleteTargetAsync: (mount: LocalFolderNotebookMount, input: LocalFolderDeleteEntryInput) => Promise<{
    success: true
    result: { absolute_path: string; relative_path: string }
  } | { success: false; errorCode: LocalFolderFileErrorCode }>
  resolveLocalFolderFilePathAsync: (mount: LocalFolderNotebookMount, relativePath: string) => Promise<{
    success: true
    relative_path: string
  } | { success: false; errorCode: LocalFolderFileErrorCode }>
  // File operations (sync versions -- for non-IPC callers that need sync)
  readLocalFolderFile: (mount: LocalFolderNotebookMount, relativePath: string) => LocalFolderReadFileResponse
  // Note identity
  ensureLocalNoteIdentity: (input: { notebook_id: string; relative_path: string }) => void
  renameLocalNoteIdentityPath: (input: { notebook_id: string; from_relative_path: string; to_relative_path: string }) => void
  renameLocalNoteIdentityFolderPath: (input: { notebook_id: string; from_relative_folder_path: string; to_relative_folder_path: string }) => void
  deleteLocalNoteIdentityByPath: (input: { notebook_id: string; relative_path: string; kind: 'file' | 'folder' }) => void
  getLocalNoteIdentityByPath: (input: { notebook_id: string; relative_path: string }) => { note_uid: string } | null
  // Note metadata
  listLocalNoteMetadata: (options: { notebookIds?: string[] }) => unknown
  updateLocalNoteMetadata: (input: {
    notebook_id: string
    relative_path: string
    is_favorite?: boolean
    is_pinned?: boolean
    ai_summary?: string | null
    summary_content_hash?: string | null
    tags?: string[] | null
    ai_tags?: string[] | null
  }) => unknown
  renameLocalNoteMetadataPath: (input: { notebook_id: string; from_relative_path: string; to_relative_path: string }) => void
  renameLocalNoteMetadataFolderPath: (input: { notebook_id: string; from_relative_folder_path: string; to_relative_folder_path: string }) => void
  deleteLocalNoteMetadataByPath: (input: { notebook_id: string; relative_path: string; kind: 'file' | 'folder' }) => void
  // Etag
  buildLocalEtag: (input: { notebookId: string; relativePath: string; mtimeMs: number; size: number; contentHash?: string }) => string
  resolveIfMatchForLocal: (
    current: { notebookId: string; relativePath: string; mtimeMs: number; size: number; contentHash?: string },
    ifMatch: unknown
  ) => IfMatchCheckResult
  normalizeLocalRelativePathForEtag: (relativePath: string) => string
  // Index
  deleteIndexedLocalNotesByNotebook: (notebookId: string) => void
  deleteIndexForLocalPath: (notebookId: string, relativePath: string, options?: { noteUid?: string | null }) => void
  syncLocalNoteTagsMetadata: (notebookId: string, relativePath: string, tiptapContent: string) => void
  syncLocalNotePopupRefs: (notebookId: string, relativePath: string, tiptapContent: string) => void
  enqueueLocalNotebookIndexSync: (notebookId: string, options: { full?: boolean; immediate?: boolean; changedRelativePath?: string }) => void
  clearLocalNotebookIndexSyncForNotebook: (notebookId: string) => void
  // Tree cache
  scanAndCacheLocalFolderTree: (mount: LocalFolderNotebookMount) => LocalFolderTreeResult
  scanAndCacheLocalFolderTreeAsync: (
    mount: LocalFolderNotebookMount,
    options?: { includePreview?: boolean; sortEntries?: boolean }
  ) => Promise<LocalFolderTreeResult>
  scanLocalFolderTreeAsync?: (
    mount: LocalFolderNotebookMount,
    options?: { includePreview?: boolean; sortEntries?: boolean }
  ) => Promise<LocalFolderTreeResult>
  cacheLocalFolderTree?: (tree: LocalFolderTreeResult) => void
  getCachedLocalFolderTree?: (notebookId: string, maxAgeMs: number) => LocalFolderTreeResult | null
  invalidateLocalFolderTreeCache: (notebookId: string) => void
  // Watcher
  ensureLocalFolderWatcher: (
    notebookId: string,
    rootPath: string,
    canonicalRootPath?: string
  ) => void
  stopLocalFolderWatcher: (notebookId: string, options?: { clearPendingEvent?: boolean }) => void
  syncLocalFolderWatchers: () => void
  scheduleLocalFolderWatchEvent: (event: {
    notebook_id: string
    status: NotebookStatus
    reason?: 'status_changed' | 'content_changed' | 'rescan_required'
    changed_relative_path: string | null
  }) => void
  resolveMountStatusFromFsError: (error: unknown) => NotebookStatus
  selectLocalFolderRoot: () => Promise<string | null>
  // Shell
  trashItem: (path: string) => Promise<void>
  openPath: (path: string) => Promise<string>
  // Notebook
  deleteLocalFolderNotebook: (notebookId: string) => Result<void, 'notebook_not_found' | 'notebook_not_local_folder'>
}

export interface LocalFolderIpcRuntime {
  waitForLocalFolderMutationTails: (notebookIds?: string[]) => Promise<void> | null
  runWithLocalFolderTopologyReadScope: <T>(task: () => Promise<T>) => Promise<T>
  runWithLocalFolderConsistentRead: <T>(
    task: () => Promise<T>,
    notebookIds?: string[]
  ) => Promise<T>
}

export function registerLocalFolderIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: LocalFolderIpcDeps,
  runtime: LocalFolderIpcConcurrencyRuntime = createLocalFolderIpcConcurrencyRuntime()
): LocalFolderIpcRuntime {
  const localFolderTreeLoadInFlight = new Map<string, Promise<LocalFolderGetTreeResponse>>()
  const localFolderTreePreviewWarmupInFlight = new Map<string, Promise<void>>()
  const localFolderTreePreviewWarmupReadyKeys = new Set<string>()
  const localFolderFileReadInFlight = new Map<string, Promise<LocalFolderReadFileResponse>>()
  const localFolderFileSaveQueueTail = new Map<string, Promise<void>>()
  const {
    waitForLocalFolderMutationTails,
    runWithLocalFolderTopologyReadScope,
    runWithLocalFolderConsistentRead,
    runLocalFolderGlobalMutationSerialized,
    runLocalFolderNotebookMutationSerialized,
    tryAcquireLocalFolderNotebookSaveScope,
    waitAndAcquireLocalFolderNotebookSaveScope,
    releaseLocalFolderNotebookSaveScope,
  } = runtime

  function buildOperationCompositeKey(parts: readonly string[]): string {
    return JSON.stringify(parts)
  }

  function resolveMountCanonicalOrRootPath(
    mountLike: { root_path: string; canonical_root_path?: string | null }
  ): string {
    return resolveLocalFolderCanonicalOrRootPath(mountLike)
  }

  function buildLocalFolderTreeLoadKey(mount: LocalFolderNotebookMount): string {
    return buildOperationCompositeKey([
      'tree',
      mount.notebook.id,
      resolveMountCanonicalOrRootPath(mount.mount),
      mount.mount.status,
    ])
  }

  function buildLocalFolderTreePreviewWarmupKey(mount: LocalFolderNotebookMount): string {
    return buildOperationCompositeKey([
      'tree_preview',
      mount.notebook.id,
      resolveMountCanonicalOrRootPath(mount.mount),
    ])
  }

  function markLocalFolderTreePreviewWarmupReady(previewKey: string): void {
    if (localFolderTreePreviewWarmupReadyKeys.has(previewKey)) return
    if (localFolderTreePreviewWarmupReadyKeys.size >= LOCAL_FOLDER_PREVIEW_WARMUP_READY_KEYS_MAX) {
      const oldest = localFolderTreePreviewWarmupReadyKeys.values().next().value
      if (oldest) {
        localFolderTreePreviewWarmupReadyKeys.delete(oldest)
      }
    }
    localFolderTreePreviewWarmupReadyKeys.add(previewKey)
  }

  function shouldUseFastLocalFolderTreeLoad(mount: LocalFolderNotebookMount): boolean {
    if (!LOCAL_FOLDER_GET_TREE_FAST_LOAD_ENABLED) return false
    const previewKey = buildLocalFolderTreePreviewWarmupKey(mount)
    if (localFolderTreePreviewWarmupReadyKeys.has(previewKey)) {
      return false
    }
    if (!LOCAL_FOLDER_GET_TREE_FAST_LOAD_STARTUP_ONLY) return true
    return getStartupPhaseState().inStartupPhase
  }

  function resolveCachedLocalFolderTree(mount: LocalFolderNotebookMount): LocalFolderTreeResult | null {
    if (LOCAL_FOLDER_GET_TREE_CACHE_MAX_AGE_MS <= 0) return null
    if (typeof deps.getCachedLocalFolderTree !== 'function') return null
    const cached = deps.getCachedLocalFolderTree(
      mount.notebook.id,
      LOCAL_FOLDER_GET_TREE_CACHE_MAX_AGE_MS
    )
    if (!cached) return null
    if (!isLocalFolderTreeRootMatched(cached, mount.mount)) {
      try {
        deps.invalidateLocalFolderTreeCache(mount.notebook.id)
      } catch (invalidateError) {
        console.error(
          '[localFolder:getTree] failed to invalidate stale local folder tree cache:',
          mount.notebook.id,
          invalidateError
        )
      }
      return null
    }
    return cached
  }

  function scheduleLocalFolderTreePreviewWarmup(mount: LocalFolderNotebookMount): void {
    if (!LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_ENABLED) return
    const warmupInflightKey = mount.notebook.id
    if (localFolderTreePreviewWarmupInFlight.has(warmupInflightKey)) return
    const scanTreeWithoutCache = deps.scanLocalFolderTreeAsync
    const cacheTree = deps.cacheLocalFolderTree
    const canCommitWarmupTreeAfterValidation =
      typeof scanTreeWithoutCache === 'function'
      && typeof cacheTree === 'function'

    const warmTask = (async () => {
      if (LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_DELAY_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, LOCAL_FOLDER_GET_TREE_PREVIEW_WARMUP_DELAY_MS))
      }
      const latestMounts = loadLocalFolderMounts('localFolder:getTree')
      if (!latestMounts) return
      const latestMount = latestMounts.find((item) => item.notebook.id === mount.notebook.id)
      if (!latestMount || latestMount.mount.status !== 'active') return
      const scannedPreviewKey = buildLocalFolderTreePreviewWarmupKey(latestMount)
      const latestMountCanonicalOrRootPath = resolveMountCanonicalOrRootPath(latestMount.mount)
      const scannedMountComparablePath = normalizeComparablePathForFileSystem(
        latestMountCanonicalOrRootPath,
        latestMountCanonicalOrRootPath
      )

      const warmTree = canCommitWarmupTreeAfterValidation
        ? await scanTreeWithoutCache(latestMount, { includePreview: true })
        : await deps.scanAndCacheLocalFolderTreeAsync(latestMount, { includePreview: true })
      if (warmTree.notebook_id !== latestMount.notebook.id) return
      const warmTreeRootPath = typeof warmTree.root_path === 'string' && warmTree.root_path.trim()
        ? warmTree.root_path
        : latestMount.mount.root_path
      if (
        normalizeComparablePathForFileSystem(
          warmTreeRootPath,
          latestMountCanonicalOrRootPath
        ) !== scannedMountComparablePath
      ) {
        if (!canCommitWarmupTreeAfterValidation) {
          deps.invalidateLocalFolderTreeCache(latestMount.notebook.id)
        }
        return
      }
      const dispatchMounts = loadLocalFolderMounts('localFolder:getTree')
      if (!dispatchMounts) return
      const dispatchMount = dispatchMounts.find((item) => item.notebook.id === latestMount.notebook.id)
      if (!dispatchMount || dispatchMount.mount.status !== 'active') {
        if (!canCommitWarmupTreeAfterValidation) {
          deps.invalidateLocalFolderTreeCache(latestMount.notebook.id)
        }
        return
      }
      const dispatchMountCanonicalOrRootPath = resolveMountCanonicalOrRootPath(dispatchMount.mount)
      const dispatchMountComparablePath = normalizeComparablePathForFileSystem(
        dispatchMountCanonicalOrRootPath,
        dispatchMountCanonicalOrRootPath
      )
      if (dispatchMountComparablePath !== scannedMountComparablePath) {
        if (!canCommitWarmupTreeAfterValidation) {
          deps.invalidateLocalFolderTreeCache(latestMount.notebook.id)
        }
        return
      }
      if (canCommitWarmupTreeAfterValidation) {
        cacheTree(warmTree)
      }
      markLocalFolderTreePreviewWarmupReady(scannedPreviewKey)

      deps.scheduleLocalFolderWatchEvent({
        notebook_id: dispatchMount.notebook.id,
        status: 'active',
        reason: 'content_changed',
        changed_relative_path: null,
      })
    })()
      .catch((error) => {
        console.error('[localFolder:getTree] failed to warm local folder tree previews:', mount.notebook.id, error)
      })
      .finally(() => {
        if (localFolderTreePreviewWarmupInFlight.get(warmupInflightKey) === warmTask) {
          localFolderTreePreviewWarmupInFlight.delete(warmupInflightKey)
        }
      })

    localFolderTreePreviewWarmupInFlight.set(warmupInflightKey, warmTask)
  }

  function buildLocalFolderFileReadKey(
    mount: LocalFolderNotebookMount,
    relativePath: string
  ): string {
    const mountPathKey = resolveMountCanonicalOrRootPath(mount.mount)
    const normalizedRelativePath = normalizeRelativePathForOperationKey(
      relativePath,
      mount.mount.root_path
    )
    return buildOperationCompositeKey([
      'read',
      mount.notebook.id,
      mountPathKey,
      mount.mount.status,
      normalizedRelativePath,
    ])
  }

  function buildLocalFolderFileSaveKey(
    mount: LocalFolderNotebookMount,
    relativePath: string
  ): string {
    const mountPathKey = resolveMountCanonicalOrRootPath(mount.mount)
    const normalizedRelativePath = normalizeRelativePathForOperationKey(
      relativePath,
      mount.mount.root_path
    )
    return buildOperationCompositeKey([
      'save',
      mount.notebook.id,
      mountPathKey,
      normalizedRelativePath,
    ])
  }

  function normalizeRelativePathForOperationKey(relativePath: string, mountRootPath: string): string {
    const rawRelativePath = relativePath
    try {
      const normalizedRelativePath = deps.normalizeLocalRelativePathForEtag(rawRelativePath)
      const toComparable = (pathValue: string): string =>
        normalizeComparablePathForFileSystem(pathValue, mountRootPath)
      const normalizedSegments = normalizedRelativePath
        .split('/')
        .filter((segment) => segment.length > 0)
      if (normalizedSegments.includes('..')) {
        return toComparable(normalizedRelativePath || rawRelativePath)
      }
      const canonicalizedRelativePath = posix.normalize(normalizedRelativePath)
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
      if (
        !canonicalizedRelativePath
        || canonicalizedRelativePath === '.'
        || canonicalizedRelativePath === '..'
        || canonicalizedRelativePath.startsWith('../')
      ) {
        return toComparable(normalizedRelativePath || rawRelativePath)
      }
      return toComparable(canonicalizedRelativePath)
    } catch (error) {
      console.warn(
        '[localFolder:ipc] failed to normalize relative path for operation key, fallback to raw path:',
        error
      )
      return normalizeComparablePathForFileSystem(rawRelativePath, mountRootPath)
    }
  }

  function parseRequiredRelativePathInput(relativePathInput: unknown): string | null {
    if (typeof relativePathInput !== 'string') return null
    if (!relativePathInput.trim()) return null
    if (relativePathInput.includes('\0')) return null
    if (relativePathInput.length > LOCAL_FOLDER_RELATIVE_PATH_MAX_LENGTH) return null
    return relativePathInput
  }

  function parseBoundedStringInput(
    input: unknown,
    options: { maxLength: number; trim?: boolean; allowEmpty?: boolean }
  ): string | null {
    if (typeof input !== 'string') return null
    if (input.includes('\0')) return null
    if (input.length > options.maxLength) return null
    const value = options.trim ? input.trim() : input
    if (options.allowEmpty === false && !value) return null
    return value
  }

  function parseOptionalParentRelativePathInput(relativePathInput: unknown): string | null | undefined {
    if (relativePathInput == null) return null
    if (typeof relativePathInput !== 'string') return undefined
    if (!relativePathInput.trim()) return null
    if (relativePathInput.includes('\0')) return undefined
    if (relativePathInput.length > LOCAL_FOLDER_RELATIVE_PATH_MAX_LENGTH) return undefined
    return relativePathInput
  }

  const INVALID_METADATA_FIELD = Symbol('invalid-metadata-field')

  function parseOptionalBooleanMetadataInput(
    input: unknown
  ): boolean | undefined | typeof INVALID_METADATA_FIELD {
    if (input === undefined) return undefined
    if (typeof input === 'boolean') return input
    return INVALID_METADATA_FIELD
  }

  function parseOptionalNullableStringMetadataInput(
    input: unknown
  ): string | null | undefined | typeof INVALID_METADATA_FIELD {
    if (input === undefined) return undefined
    if (input === null) return null
    if (typeof input !== 'string') return INVALID_METADATA_FIELD
    if (input.includes('\0')) return INVALID_METADATA_FIELD
    if (input.length > LOCAL_FOLDER_NOTE_METADATA_TEXT_MAX_LENGTH) return INVALID_METADATA_FIELD
    return input
  }

  function parseListNotebookIdsInput(
    input: unknown
  ): string[] | undefined | null {
    if (!Array.isArray(input)) return undefined
    if (input.length > LOCAL_FOLDER_LIST_NOTE_METADATA_MAX_NOTEBOOK_IDS) return null
    const notebookIds: string[] = []
    for (const notebookIdInput of input) {
      const notebookId = parseRequiredNotebookIdInput(notebookIdInput)
      if (!notebookId) continue
      if (notebookId.length > LOCAL_FOLDER_NOTEBOOK_ID_MAX_LENGTH) return null
      if (notebookId.includes('\0')) return null
      notebookIds.push(notebookId)
    }
    return notebookIds
  }

  function parseTagValueInput(input: unknown): string | null {
    if (typeof input !== 'string') return null
    if (input.includes('\0')) return null
    if (input.length > LOCAL_FOLDER_NOTE_METADATA_TAG_MAX_LENGTH) return null
    return input
  }

  function parseOptionalNullableStringArrayMetadataInput(
    input: unknown
  ): string[] | null | undefined | typeof INVALID_METADATA_FIELD {
    if (input === undefined) return undefined
    if (input === null) return null
    if (!Array.isArray(input)) return INVALID_METADATA_FIELD
    if (input.length > LOCAL_FOLDER_NOTE_METADATA_TAGS_MAX_ITEMS) return INVALID_METADATA_FIELD
    const values: string[] = []
    for (const item of input) {
      const value = parseTagValueInput(item)
      if (value === null) {
        return INVALID_METADATA_FIELD
      }
      values.push(value)
    }
    return values
  }

  function parseListNoteMetadataInput(
    input: unknown
  ): { notebook_ids?: unknown } | undefined | null {
    if (input === undefined) return undefined
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
    return input as { notebook_ids?: unknown }
  }

  function parseOptionalNullableSummaryContentHashMetadataInput(
    input: unknown
  ): string | null | undefined | typeof INVALID_METADATA_FIELD {
    if (input === undefined) return undefined
    if (input === null) return null
    if (typeof input !== 'string') return INVALID_METADATA_FIELD
    const normalized = input.trim().toLowerCase()
    if (!normalized) return null
    if (!SUMMARY_CONTENT_HASH_HEX_PATTERN.test(normalized)) return INVALID_METADATA_FIELD
    return normalized
  }

  function normalizeUpdateNoteMetadataInput(
    input: LocalFolderUpdateNoteMetadataInput | null | undefined
  ): { ok: true; value: LocalFolderUpdateNoteMetadataInput } | { ok: false; errorCode: Exclude<LocalFolderFileErrorCode, 'LOCAL_FILE_CONFLICT'> } {
    const notebookId = parseRequiredNotebookIdInput(input?.notebook_id)
    const relativePath = parseRequiredRelativePathInput(input?.relative_path)
    if (!notebookId || !relativePath) {
      return { ok: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
    }
    if (notebookId.length > LOCAL_FOLDER_NOTEBOOK_ID_MAX_LENGTH || notebookId.includes('\0')) {
      return { ok: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
    }

    const isFavorite = parseOptionalBooleanMetadataInput(input?.is_favorite)
    const isPinned = parseOptionalBooleanMetadataInput(input?.is_pinned)
    const aiSummary = parseOptionalNullableStringMetadataInput(input?.ai_summary)
    const summaryContentHash = parseOptionalNullableSummaryContentHashMetadataInput(input?.summary_content_hash)
    const tags = parseOptionalNullableStringArrayMetadataInput(input?.tags)
    const aiTags = parseOptionalNullableStringArrayMetadataInput(input?.ai_tags)
    if (
      isFavorite === INVALID_METADATA_FIELD
      || isPinned === INVALID_METADATA_FIELD
      || aiSummary === INVALID_METADATA_FIELD
      || summaryContentHash === INVALID_METADATA_FIELD
      || tags === INVALID_METADATA_FIELD
      || aiTags === INVALID_METADATA_FIELD
    ) {
      return { ok: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
    }

    if (
      isFavorite === undefined
      && isPinned === undefined
      && aiSummary === undefined
      && summaryContentHash === undefined
      && tags === undefined
      && aiTags === undefined
    ) {
      return { ok: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
    }

    return {
      ok: true,
      value: {
        notebook_id: notebookId,
        relative_path: relativePath,
        is_favorite: isFavorite,
        is_pinned: isPinned,
        ai_summary: aiSummary,
        summary_content_hash: summaryContentHash,
        tags,
        ai_tags: aiTags,
      },
    }
  }

  async function readLocalFolderFileWithSingleFlight(
    mount: LocalFolderNotebookMount,
    relativePath: string
  ): Promise<LocalFolderReadFileResponse> {
    const readKey = buildLocalFolderFileReadKey(mount, relativePath)
    const inFlightTask = localFolderFileReadInFlight.get(readKey)
    if (inFlightTask) {
      return inFlightTask
    }

    const readTask = Promise.resolve(deps.readLocalFolderFileAsync(mount, relativePath))
    localFolderFileReadInFlight.set(readKey, readTask)
    try {
      return await readTask
    } finally {
      if (localFolderFileReadInFlight.get(readKey) === readTask) {
        localFolderFileReadInFlight.delete(readKey)
      }
    }
  }

  async function runLocalFolderFileSaveSerialized<T>(
    mount: LocalFolderNotebookMount,
    relativePath: string,
    task: () => Promise<T>
  ): Promise<T> {
    const saveKey = buildLocalFolderFileSaveKey(mount, relativePath)
    const previousTail = localFolderFileSaveQueueTail.get(saveKey) ?? Promise.resolve()
    let releaseCurrent: () => void = () => {}
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const nextTail = previousTail.then(
      () => current,
      () => current
    )
    localFolderFileSaveQueueTail.set(saveKey, nextTail)

    await previousTail.catch(() => undefined)
    try {
      return await task()
    } finally {
      releaseCurrent()
      if (localFolderFileSaveQueueTail.get(saveKey) === nextTail) {
        localFolderFileSaveQueueTail.delete(saveKey)
      }
    }
  }

  function loadLocalFolderMounts(
    context: string,
    options?: { throwOnError?: boolean }
  ): LocalFolderNotebookMount[] | null {
    try {
      return deps.getLocalFolderMounts()
    } catch (error) {
      console.error(`[${context}] failed to load mounts:`, error)
      if (options?.throwOnError) {
        throw error
      }
      return null
    }
  }

  function runBestEffort(
    context: string,
    label: string,
    fn: () => void,
    details?: unknown
  ): void {
    try {
      fn()
    } catch (error) {
      if (details === undefined) {
        console.error(`[${context}] ${label} failed:`, error)
      } else {
        console.error(`[${context}] ${label} failed:`, details, error)
      }
    }
  }

  function runBestEffortPostCommit(
    context: string,
    label: string,
    fn: () => void,
    details?: unknown
  ): void {
    if (!LOCAL_FOLDER_POST_COMMIT_DEFER_ENABLED) {
      runBestEffort(context, label, fn, details)
      return
    }
    const timer = setTimeout(() => {
      runBestEffort(context, label, fn, details)
    }, LOCAL_FOLDER_POST_COMMIT_DEFER_DELAY_MS)
    if (
      typeof timer === 'object'
      && timer !== null
      && 'unref' in timer
      && typeof timer.unref === 'function'
    ) {
      timer.unref()
    }
  }

  function resolveUnavailableMountFileError(
    mount: LocalFolderNotebookMount,
    missingKind: 'file' | 'folder'
  ): LocalFolderUnavailableFileErrorCode | null {
    if (mount.mount.status === 'permission_required') {
      return 'LOCAL_FILE_UNREADABLE'
    }
    if (mount.mount.status === 'missing') {
      return missingKind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND'
    }
    return null
  }

  function shouldProbeMountAvailabilityFromFileError(
    errorCode: LocalFolderFileErrorCode
  ): errorCode is LocalFolderMountAvailabilityProbeErrorCode {
    return (
      errorCode === 'LOCAL_FILE_UNREADABLE'
      || errorCode === 'LOCAL_FILE_NOT_FOUND'
      || errorCode === 'LOCAL_FOLDER_NOT_FOUND'
    )
  }

  function resolveUnavailableStatusFromMountProbeError(
    errorCode: LocalFolderMountErrorCode
  ): Extract<NotebookStatus, 'missing' | 'permission_required'> | null {
    if (errorCode === 'LOCAL_MOUNT_PATH_PERMISSION_DENIED') return 'permission_required'
    if (errorCode === 'LOCAL_MOUNT_PATH_NOT_FOUND' || errorCode === 'LOCAL_MOUNT_INVALID_PATH') return 'missing'
    return null
  }

  async function convergeUnavailableMountFromFileError(
    context: string,
    mount: LocalFolderNotebookMount,
    errorCode: LocalFolderFileErrorCode
  ): Promise<void> {
    if (mount.mount.status !== 'active') return
    if (!shouldProbeMountAvailabilityFromFileError(errorCode)) return

    let probeResult: Awaited<ReturnType<typeof canonicalizeLocalFolderPathAsync>>
    try {
      probeResult = await canonicalizeLocalFolderPathAsync(mount.mount.root_path)
    } catch (probeError) {
      console.error(`[${context}] failed to probe mount root availability: notebook=${mount.notebook.id}`, probeError)
      return
    }
    if (probeResult.ok) return

    const nextStatus = resolveUnavailableStatusFromMountProbeError(probeResult.errorCode)
    if (!nextStatus) return

    try {
      applyLocalFolderMountStatusTransition({
        updateLocalFolderMountStatus: deps.updateLocalFolderMountStatus,
        notebookId: mount.notebook.id,
        status: nextStatus,
        context,
        enqueueLocalNotebookIndexSync: deps.enqueueLocalNotebookIndexSync,
        scheduleLocalFolderWatchEvent: deps.scheduleLocalFolderWatchEvent,
        enqueue: { full: true, immediate: true },
        event: {
          reason: 'status_changed',
          changed_relative_path: null,
        },
      })
    } catch (transitionError) {
      console.error(`[${context}] failed to persist mount status during file error convergence: notebook=${mount.notebook.id}`, transitionError)
    }

    try {
      deps.invalidateLocalFolderTreeCache(mount.notebook.id)
    } catch (invalidateError) {
      console.error(`[${context}] failed to invalidate local folder tree cache during file error convergence: notebook=${mount.notebook.id}`, invalidateError)
    }
    try {
      deps.stopLocalFolderWatcher(mount.notebook.id, { clearPendingEvent: false })
    } catch (stopError) {
      console.error(`[${context}] failed to stop local folder watcher during file error convergence: notebook=${mount.notebook.id}`, stopError)
    }
  }

  function logLocalFolderUnmountAudit(input: {
    notebookId: string
    success: boolean
    durationMs: number
    errorCode?: string
  }): void {
    emitLocalFolderUnmountAudit(console, input)
  }

  function normalizeCreateFileInput(
    input: LocalFolderCreateFileInput | null | undefined
  ): { ok: true; value: LocalFolderCreateFileInput } | { ok: false; errorCode: LocalFolderFileErrorCode } {
    const notebookId = parseRequiredNotebookIdInput(input?.notebook_id)
    if (!notebookId) {
      return { ok: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
    }

    const parentRelativePath = parseOptionalParentRelativePathInput(input?.parent_relative_path)
    if (parentRelativePath === undefined) {
      return { ok: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
    }

    const fileName = parseBoundedStringInput(input?.file_name, {
      maxLength: LOCAL_FOLDER_ENTRY_NAME_MAX_LENGTH,
      trim: true,
      allowEmpty: false,
    })
    if (!fileName) {
      return { ok: false, errorCode: 'LOCAL_FILE_INVALID_NAME' }
    }

    return {
      ok: true,
      value: {
        notebook_id: notebookId,
        parent_relative_path: parentRelativePath,
        file_name: fileName,
      },
    }
  }

  function normalizeReadFileInput(
    input: LocalFolderReadFileInput | null | undefined
  ): { ok: true; value: LocalFolderReadFileInput } | { ok: false; errorCode: LocalFolderReadFileErrorCode } {
    const notebookId = parseRequiredNotebookIdInput(input?.notebook_id)
    const relativePath = parseRequiredRelativePathInput(input?.relative_path)
    if (!notebookId || !relativePath) {
      return { ok: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
    }
    return {
      ok: true,
      value: {
        notebook_id: notebookId,
        relative_path: relativePath,
      },
    }
  }

  function normalizeSaveFileInput(
    input: LocalFolderSaveFileInput | null | undefined
  ): { ok: true; value: LocalFolderSaveFileInput } | { ok: false; errorCode: Exclude<LocalFolderFileErrorCode, 'LOCAL_FILE_CONFLICT'> } {
    const notebookId = parseRequiredNotebookIdInput(input?.notebook_id)
    const relativePath = parseRequiredRelativePathInput(input?.relative_path)
    if (!notebookId || !relativePath) {
      return { ok: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
    }

    const tiptapContent = input?.tiptap_content
    if (typeof tiptapContent !== 'string') {
      return { ok: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
    }

    const expectedMtimeMs = input?.expected_mtime_ms
    const expectedSize = input?.expected_size
    const expectedContentHashInput = input?.expected_content_hash
    const forceInput = input?.force

    if (expectedMtimeMs !== undefined && !Number.isFinite(expectedMtimeMs)) {
      return { ok: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' }
    }
    if (expectedSize !== undefined && (!Number.isFinite(expectedSize) || expectedSize < 0)) {
      return { ok: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' }
    }
    if (expectedContentHashInput !== undefined && typeof expectedContentHashInput !== 'string') {
      return { ok: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' }
    }
    if (forceInput !== undefined && typeof forceInput !== 'boolean') {
      return { ok: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
    }

    const rawIfMatch = input?.if_match
    if (
      rawIfMatch !== undefined
      && rawIfMatch !== null
      && typeof rawIfMatch !== 'string'
      && typeof rawIfMatch !== 'number'
    ) {
      return { ok: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' }
    }
    if (typeof rawIfMatch === 'string' && rawIfMatch.length > LOCAL_FOLDER_IF_MATCH_MAX_LENGTH) {
      return { ok: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' }
    }
    const ifMatch = typeof rawIfMatch === 'string' ? rawIfMatch.trim() : rawIfMatch
    if (typeof ifMatch === 'string' && (!ifMatch || ifMatch.includes('\0'))) {
      return { ok: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' }
    }

    const expectedContentHash = typeof expectedContentHashInput === 'string'
      ? expectedContentHashInput.trim()
      : undefined
    if (expectedContentHash && !SHA256_HEX_PATTERN.test(expectedContentHash)) {
      return { ok: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' }
    }
    return {
      ok: true,
      value: {
        notebook_id: notebookId,
        relative_path: relativePath,
        tiptap_content: tiptapContent,
        if_match: ifMatch,
        expected_mtime_ms: expectedMtimeMs,
        expected_size: expectedSize,
        expected_content_hash: expectedContentHash ? expectedContentHash.toLowerCase() : undefined,
        force: forceInput,
      },
    }
  }

  function normalizeCreateFolderInput(
    input: LocalFolderCreateFolderInput | null | undefined
  ): { ok: true; value: LocalFolderCreateFolderInput } | { ok: false; errorCode: LocalFolderFileErrorCode } {
    const notebookId = parseRequiredNotebookIdInput(input?.notebook_id)
    if (!notebookId) {
      return { ok: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
    }

    const parentRelativePath = parseOptionalParentRelativePathInput(input?.parent_relative_path)
    if (parentRelativePath === undefined) {
      return { ok: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
    }

    const folderName = parseBoundedStringInput(input?.folder_name, {
      maxLength: LOCAL_FOLDER_ENTRY_NAME_MAX_LENGTH,
      trim: true,
      allowEmpty: false,
    })
    if (!folderName) {
      return { ok: false, errorCode: 'LOCAL_FILE_INVALID_NAME' }
    }

    return {
      ok: true,
      value: {
        notebook_id: notebookId,
        parent_relative_path: parentRelativePath,
        folder_name: folderName,
      },
    }
  }

  function normalizeRenameEntryInput(
    input: LocalFolderRenameEntryInput | null | undefined
  ): { ok: true; value: LocalFolderRenameEntryInput } | { ok: false; errorCode: LocalFolderFileErrorCode } {
    const kind = input?.kind
    if (kind !== 'file' && kind !== 'folder') {
      return { ok: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
    }

    const notebookId = parseRequiredNotebookIdInput(input?.notebook_id)
    if (!notebookId) {
      return {
        ok: false,
        errorCode: kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
      }
    }

    const relativePath = parseRequiredRelativePathInput(input?.relative_path)
    if (!relativePath) {
      return {
        ok: false,
        errorCode: kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
      }
    }

    const newName = parseBoundedStringInput(input?.new_name, {
      maxLength: LOCAL_FOLDER_ENTRY_NAME_MAX_LENGTH,
      trim: true,
      allowEmpty: false,
    })
    if (!newName) {
      return { ok: false, errorCode: 'LOCAL_FILE_INVALID_NAME' }
    }

    return {
      ok: true,
      value: {
        notebook_id: notebookId,
        relative_path: relativePath,
        kind,
        new_name: newName,
      },
    }
  }

  function normalizeDeleteEntryInput(
    input: LocalFolderDeleteEntryInput | null | undefined
  ): { ok: true; value: LocalFolderDeleteEntryInput } | { ok: false; errorCode: LocalFolderFileErrorCode } {
    const kind = input?.kind
    if (kind !== 'file' && kind !== 'folder') {
      return { ok: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' }
    }

    const notebookId = parseRequiredNotebookIdInput(input?.notebook_id)
    const relativePath = parseRequiredRelativePathInput(input?.relative_path)
    if (!notebookId || !relativePath) {
      return {
        ok: false,
        errorCode: kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
      }
    }

    return {
      ok: true,
      value: {
        notebook_id: notebookId,
        relative_path: relativePath,
        kind,
      },
    }
  }

  async function analyzeLocalFolderDeleteImpact(
    sourceNotebookId: string,
    targetAbsolutePath: string,
    kind: 'file' | 'folder',
    options?: { strictMountLoad?: boolean }
  ): Promise<LocalFolderAffectedMount[]> {
    if (kind !== 'folder') return []

    const canonicalTarget = await canonicalizeLocalFolderPathAsync(targetAbsolutePath)
    if (!canonicalTarget.ok) return []
    const targetPath = normalizeComparablePathForFileSystem(
      canonicalTarget.canonicalPath,
      canonicalTarget.canonicalPath
    )

    const affected: LocalFolderAffectedMount[] = []
    const mounts = loadLocalFolderMounts('localFolder:deleteImpact', {
      throwOnError: options?.strictMountLoad,
    })
    if (!mounts) return []

    for (const mount of mounts) {
      if (mount.notebook.id === sourceNotebookId) continue
      if (mount.mount.status !== 'active') continue
      const mountCanonical = mount.mount.canonical_root_path
        ? normalizeComparablePathForFileSystem(mount.mount.canonical_root_path, mount.mount.canonical_root_path)
        : null
      if (mountCanonical && isSameOrChildPath(targetPath, mountCanonical)) {
        affected.push({
          notebook_id: mount.notebook.id,
          notebook_name: mount.notebook.name,
          root_path: mount.mount.root_path,
        })
      }
    }
    return affected
  }

  ipcMainLike.handle('localFolder:list', (): LocalFolderListResponse | Promise<LocalFolderListResponse> => {
    const runList = (): LocalFolderListResponse => {
      const mounts = loadLocalFolderMounts('localFolder:list')
      if (!mounts) {
        return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
      }
      return {
        success: true,
        result: {
          mounts,
        },
      }
    }
    return runWithLocalFolderConsistentRead(async () => runList())
  })

  ipcMainLike.handle('localFolder:getTree', async (_, notebookId: string): Promise<LocalFolderGetTreeResponse> => {
    const parsedNotebookId = parseRequiredNotebookIdInput(notebookId)
    if (!parsedNotebookId) {
      return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' }
    }
    return runWithLocalFolderConsistentRead(async () => {
      const mounts = loadLocalFolderMounts('localFolder:getTree')
      if (!mounts) return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
      const mount = mounts.find((item) => item.notebook.id === parsedNotebookId)
      if (!mount) return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' }
      const treeLoadKey = buildLocalFolderTreeLoadKey(mount)
      const inFlightTask = localFolderTreeLoadInFlight.get(treeLoadKey)
      if (inFlightTask) {
        return inFlightTask
      }
      const useFastTreeLoad = shouldUseFastLocalFolderTreeLoad(mount)
      if (mount.mount.status === 'active') {
        const cachedTree = resolveCachedLocalFolderTree(mount)
        if (cachedTree) {
          if (useFastTreeLoad) {
            scheduleLocalFolderTreePreviewWarmup(mount)
          }
          deps.ensureLocalFolderWatcher(
            parsedNotebookId,
            mount.mount.root_path,
            resolveMountCanonicalOrRootPath(mount.mount)
          )
          return { success: true, result: cachedTree }
        }
      }

      const treeLoadTask = (async (): Promise<LocalFolderGetTreeResponse> => {
        try {
          const tree = await deps.scanAndCacheLocalFolderTreeAsync(
            mount,
            useFastTreeLoad ? { includePreview: false, sortEntries: false } : undefined
          )
          if (mount.mount.status !== 'active') {
            // When mount is currently unavailable, scan success alone is insufficient.
            // We only expose the tree after the status is actually promoted to active.
            const promoted = applyLocalFolderMountStatusTransition({
              updateLocalFolderMountStatus: deps.updateLocalFolderMountStatus,
              notebookId: parsedNotebookId,
              status: 'active',
              context: 'localFolder:getTree',
              enqueueLocalNotebookIndexSync: deps.enqueueLocalNotebookIndexSync,
              scheduleLocalFolderWatchEvent: deps.scheduleLocalFolderWatchEvent,
              enqueue: { full: true, immediate: true },
              event: {
                reason: 'status_changed',
                changed_relative_path: null,
              },
            })

            if (!promoted.ok) {
              deps.invalidateLocalFolderTreeCache(parsedNotebookId)
              deps.stopLocalFolderWatcher(parsedNotebookId, { clearPendingEvent: false })
              if (promoted.updateResult === 'not_found') {
                return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' }
              }
              const unavailableStatus = resolvePersistedUnavailableMountStatus({
                getLocalFolderMountByNotebookId: deps.getLocalFolderMountByNotebookId,
                notebookId: parsedNotebookId,
                fallback: mount.mount.status === 'permission_required' ? 'permission_required' : 'missing',
                context: 'localFolder:getTree',
              })
              return {
                success: false,
                errorCode: 'LOCAL_MOUNT_UNAVAILABLE',
                mount_status: unavailableStatus,
              }
            }
          }
          if (useFastTreeLoad) {
            scheduleLocalFolderTreePreviewWarmup(mount)
          } else {
            markLocalFolderTreePreviewWarmupReady(buildLocalFolderTreePreviewWarmupKey(mount))
          }
          deps.ensureLocalFolderWatcher(
            parsedNotebookId,
            mount.mount.root_path,
            resolveMountCanonicalOrRootPath(mount.mount)
          )
          return { success: true, result: tree }
        } catch (error) {
          let unavailableStatus: Extract<NotebookStatus, 'missing' | 'permission_required'> | null = null
          try {
            unavailableStatus = resolveUnavailableMountStatusFromFsError(
              error,
              deps.resolveMountStatusFromFsError
            )
          } catch (resolveStatusError) {
            console.error('[localFolder:getTree] failed to resolve mount status from scan error:', resolveStatusError)
            unavailableStatus = 'missing'
          }
          if (!unavailableStatus) {
            console.error('[localFolder:getTree] failed with non-fs scan error:', error)
            return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
          }
          const nextStatus: NotebookStatus = unavailableStatus
          let statusTransitionResult: ReturnType<typeof applyLocalFolderMountStatusTransition> | null = null
          if (mount.mount.status !== nextStatus) {
            statusTransitionResult = applyLocalFolderMountStatusTransition({
              updateLocalFolderMountStatus: deps.updateLocalFolderMountStatus,
              notebookId: parsedNotebookId,
              status: nextStatus,
              context: 'localFolder:getTree',
              enqueueLocalNotebookIndexSync: deps.enqueueLocalNotebookIndexSync,
              scheduleLocalFolderWatchEvent: deps.scheduleLocalFolderWatchEvent,
              enqueue: { full: true, immediate: true },
              event: {
                reason: 'status_changed',
                changed_relative_path: null,
              },
            })
          }
          deps.invalidateLocalFolderTreeCache(parsedNotebookId)
          deps.stopLocalFolderWatcher(parsedNotebookId, { clearPendingEvent: false })
          if (statusTransitionResult?.updateResult === 'not_found') {
            return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' }
          }
          const resolvedUnavailableStatus = resolvePersistedUnavailableMountStatus({
            getLocalFolderMountByNotebookId: deps.getLocalFolderMountByNotebookId,
            notebookId: parsedNotebookId,
            fallback: unavailableStatus,
            context: 'localFolder:getTree',
          })
          console.error('[localFolder:getTree] failed:', error)
          return {
            success: false,
            errorCode: 'LOCAL_MOUNT_UNAVAILABLE',
            mount_status: resolvedUnavailableStatus,
          }
        }
      })()
      localFolderTreeLoadInFlight.set(treeLoadKey, treeLoadTask)
      try {
        return await treeLoadTask
      } finally {
        if (localFolderTreeLoadInFlight.get(treeLoadKey) === treeLoadTask) {
          localFolderTreeLoadInFlight.delete(treeLoadKey)
        }
      }
    }, [parsedNotebookId])
  })

  ipcMainLike.handle('localFolder:readFile', createSafeHandler('localFolder:readFile', async (_, input: LocalFolderReadFileInput): Promise<LocalFolderReadFileResponse> => {
    const normalizedInput = normalizeReadFileInput(input)
    if (!normalizedInput.ok) {
      return { success: false, errorCode: normalizedInput.errorCode }
    }
    const readInput = normalizedInput.value
    return runWithLocalFolderConsistentRead(async () => {
      const mounts = loadLocalFolderMounts('localFolder:readFile')
      if (!mounts) return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
      const mount = mounts.find((item) => item.notebook.id === readInput.notebook_id)
      if (!mount) {
        return { success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
      }
      const unavailableError = resolveUnavailableMountFileError(mount, 'file')
      if (unavailableError) {
        return { success: false, errorCode: unavailableError }
      }
      let result: LocalFolderReadFileResponse
      try {
        result = await readLocalFolderFileWithSingleFlight(mount, readInput.relative_path)
      } catch (error) {
        console.error('[localFolder:readFile] failed to read local file:', error)
        await convergeUnavailableMountFromFileError('localFolder:readFile', mount, 'LOCAL_FILE_UNREADABLE')
        return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
      }
      if (!result.success) {
        await convergeUnavailableMountFromFileError('localFolder:readFile', mount, result.errorCode)
        return result as LocalFolderReadFileResponse
      }
      let etag: string | undefined
      try {
        etag = deps.buildLocalEtag({
          notebookId: result.result.notebook_id,
          relativePath: result.result.relative_path,
          mtimeMs: result.result.mtime_ms,
          size: result.result.size,
          contentHash: result.result.content_hash,
        })
      } catch (error) {
        console.error('[localFolder:readFile] failed to build etag:', error)
      }
      return {
        success: true,
        result: {
          ...result.result,
          etag,
        },
      } as LocalFolderReadFileResponse
    }, [readInput.notebook_id])
  }))

  ipcMainLike.handle('localFolder:saveFile', createSafeHandler('localFolder:saveFile', async (_, input: LocalFolderSaveFileInput): Promise<LocalFolderSaveFileResponse> => {
    const normalizedInput = normalizeSaveFileInput(input)
    if (!normalizedInput.ok) {
      return { success: false, errorCode: normalizedInput.errorCode }
    }
    const saveInput = normalizedInput.value
    const saveScopeKeyCandidate = tryAcquireLocalFolderNotebookSaveScope(saveInput.notebook_id)
    const saveScopeKey = saveScopeKeyCandidate === null
      ? await waitAndAcquireLocalFolderNotebookSaveScope(saveInput.notebook_id)
      : saveScopeKeyCandidate
    try {
      const mounts = loadLocalFolderMounts('localFolder:saveFile')
      if (!mounts) return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
      const mount = mounts.find((item) => item.notebook.id === saveInput.notebook_id)
      if (!mount) {
        return { success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
      }
      const unavailableError = resolveUnavailableMountFileError(mount, 'file')
      if (unavailableError) {
        return { success: false, errorCode: unavailableError }
      }
      let normalizedRelativePath = saveInput.relative_path
      try {
        normalizedRelativePath = deps.normalizeLocalRelativePathForEtag(saveInput.relative_path)
      } catch (error) {
        console.error('[localFolder:saveFile] failed to normalize relative path for etag:', error)
      }

      return await runLocalFolderFileSaveSerialized(mount, saveInput.relative_path, async () => {
        let expectedMtimeMs = saveInput.expected_mtime_ms
        let expectedSize = saveInput.expected_size
        let expectedContentHash = typeof saveInput.expected_content_hash === 'string'
          ? saveInput.expected_content_hash.toLowerCase()
          : undefined

        if (!saveInput.force && saveInput.if_match !== undefined && saveInput.if_match !== null) {
          let current: LocalFolderReadFileResponse
          try {
            current = await readLocalFolderFileWithSingleFlight(mount, saveInput.relative_path)
          } catch (error) {
            console.error('[localFolder:saveFile] failed to read current local file for if_match:', error)
            await convergeUnavailableMountFromFileError('localFolder:saveFile', mount, 'LOCAL_FILE_UNREADABLE')
            return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
          }
          if (!current.success) {
            await convergeUnavailableMountFromFileError('localFolder:saveFile', mount, current.errorCode)
            return current as LocalFolderSaveFileResponse
          }

          let ifMatchCheck: IfMatchCheckResult
          try {
            ifMatchCheck = deps.resolveIfMatchForLocal(
              {
                notebookId: current.result.notebook_id,
                relativePath: current.result.relative_path,
                mtimeMs: current.result.mtime_ms,
                size: current.result.size,
                contentHash: current.result.content_hash,
              },
              saveInput.if_match
            )
          } catch (error) {
            console.error('[localFolder:saveFile] failed to resolve if_match:', error)
            return { success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' }
          }
          if (!ifMatchCheck.ok) {
            if (ifMatchCheck.error === 'invalid_if_match') {
              return { success: false, errorCode: 'LOCAL_FILE_INVALID_IF_MATCH' }
            }
            let conflictEtag: string | undefined
            try {
              conflictEtag = deps.buildLocalEtag({
                notebookId: current.result.notebook_id,
                relativePath: current.result.relative_path,
                mtimeMs: current.result.mtime_ms,
                size: current.result.size,
                contentHash: current.result.content_hash,
              })
            } catch (error) {
              console.error('[localFolder:saveFile] failed to build etag for if_match conflict:', error)
            }
            return {
              success: false,
              errorCode: 'LOCAL_FILE_CONFLICT',
              conflict: {
                size: current.result.size,
                mtime_ms: current.result.mtime_ms,
                content_hash: current.result.content_hash,
                etag: conflictEtag,
              },
            } as LocalFolderSaveFileResponse
          }

          expectedMtimeMs = ifMatchCheck.expectedMtimeMs
          expectedSize = ifMatchCheck.expectedSize
          expectedContentHash = ifMatchCheck.expectedContentHash || expectedContentHash
        }

        let result: LocalFolderSaveFileResponse
        try {
          result = await deps.saveLocalFolderFileAsync(mount, saveInput.relative_path, saveInput.tiptap_content, {
            expectedMtimeMs,
            expectedSize,
            expectedContentHash,
            force: saveInput.force,
          })
        } catch (error) {
          console.error('[localFolder:saveFile] failed to save local file:', error)
          await convergeUnavailableMountFromFileError('localFolder:saveFile', mount, 'LOCAL_FILE_UNREADABLE')
          return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
        }
        if (result.success) {
          runBestEffortPostCommit('localFolder:saveFile', 'invalidate local folder tree cache after save commit', () => {
            deps.invalidateLocalFolderTreeCache(saveInput.notebook_id)
          })
          runBestEffortPostCommit('localFolder:saveFile', 'ensure local note identity after save commit', () => {
            deps.ensureLocalNoteIdentity({
              notebook_id: saveInput.notebook_id,
              relative_path: normalizedRelativePath,
            })
          })
          runBestEffortPostCommit('localFolder:saveFile', 'sync local note tags metadata after save commit', () => {
            deps.syncLocalNoteTagsMetadata(saveInput.notebook_id, normalizedRelativePath, saveInput.tiptap_content)
          })
          runBestEffortPostCommit('localFolder:saveFile', 'sync local note popup refs after save commit', () => {
            deps.syncLocalNotePopupRefs(saveInput.notebook_id, normalizedRelativePath, saveInput.tiptap_content)
          })

          let etag: string | undefined
          try {
            etag = deps.buildLocalEtag({
              notebookId: saveInput.notebook_id,
              relativePath: normalizedRelativePath,
              mtimeMs: result.result.mtime_ms,
              size: result.result.size,
              contentHash: result.result.content_hash,
            })
          } catch (error) {
            console.error('[localFolder:saveFile] failed to build etag after save commit:', error)
          }
          return {
            success: true,
            result: {
              ...result.result,
              etag,
            },
          } as LocalFolderSaveFileResponse
        }
        if (result.errorCode === 'LOCAL_FILE_CONFLICT' && result.conflict) {
          let etag: string | undefined
          try {
            etag = deps.buildLocalEtag({
              notebookId: saveInput.notebook_id,
              relativePath: normalizedRelativePath,
              mtimeMs: result.conflict.mtime_ms,
              size: result.conflict.size,
              contentHash: result.conflict.content_hash,
            })
          } catch (error) {
            console.error('[localFolder:saveFile] failed to build etag for conflict result:', error)
          }
          return {
            success: false,
            errorCode: 'LOCAL_FILE_CONFLICT',
            conflict: {
              ...result.conflict,
              etag,
            },
          } as LocalFolderSaveFileResponse
        }
        await convergeUnavailableMountFromFileError('localFolder:saveFile', mount, result.errorCode)
        return result as LocalFolderSaveFileResponse
      })
    } finally {
      releaseLocalFolderNotebookSaveScope(saveScopeKey)
    }
  }))

  ipcMainLike.handle('localFolder:createFile', createSafeHandler('localFolder:createFile', async (_, input: LocalFolderCreateFileInput): Promise<LocalFolderCreateFileResponse> => {
    const normalizedInput = normalizeCreateFileInput(input)
    if (!normalizedInput.ok) {
      return { success: false, errorCode: normalizedInput.errorCode }
    }
    const createInput = normalizedInput.value

    return runLocalFolderNotebookMutationSerialized(createInput.notebook_id, async () => {
      const mounts = loadLocalFolderMounts('localFolder:createFile')
      if (!mounts) return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
      const mount = mounts.find((item) => item.notebook.id === createInput.notebook_id)
      if (!mount) {
        return { success: false, errorCode: 'LOCAL_FILE_NOT_FOUND' }
      }
      const unavailableError = resolveUnavailableMountFileError(mount, 'file')
      if (unavailableError) {
        return { success: false, errorCode: unavailableError }
      }
      let result: LocalFolderCreateFileResponse
      try {
        result = await deps.createLocalFolderFileAsync(
          mount,
          createInput.parent_relative_path,
          createInput.file_name
        )
      } catch (error) {
        console.error('[localFolder:createFile] failed to create file:', error)
        await convergeUnavailableMountFromFileError('localFolder:createFile', mount, 'LOCAL_FILE_UNREADABLE')
        return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
      }
      if (result.success) {
        runBestEffort('localFolder:createFile', 'invalidate local folder tree cache after create commit', () => {
          deps.invalidateLocalFolderTreeCache(createInput.notebook_id)
        })
        runBestEffort('localFolder:createFile', 'ensure local note identity after create commit', () => {
          deps.ensureLocalNoteIdentity({
            notebook_id: createInput.notebook_id,
            relative_path: result.result.relative_path,
          })
        })
        runBestEffort('localFolder:createFile', 'enqueue incremental notebook sync after create commit', () => {
          deps.enqueueLocalNotebookIndexSync(createInput.notebook_id, {
            changedRelativePath: result.result.relative_path,
            immediate: true,
          })
        })
      }
      if (!result.success) {
        await convergeUnavailableMountFromFileError('localFolder:createFile', mount, result.errorCode)
      }
      return result
    })
  }))

  ipcMainLike.handle('localFolder:createFolder', createSafeHandler('localFolder:createFolder', async (_, input: LocalFolderCreateFolderInput): Promise<LocalFolderCreateFolderResponse> => {
    const normalizedInput = normalizeCreateFolderInput(input)
    if (!normalizedInput.ok) {
      return { success: false, errorCode: normalizedInput.errorCode }
    }
    const createInput = normalizedInput.value

    return runLocalFolderNotebookMutationSerialized(createInput.notebook_id, async () => {
      const mounts = loadLocalFolderMounts('localFolder:createFolder')
      if (!mounts) return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
      const mount = mounts.find((item) => item.notebook.id === createInput.notebook_id)
      if (!mount) {
        return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
      }
      const unavailableError = resolveUnavailableMountFileError(mount, 'folder')
      if (unavailableError) {
        return { success: false, errorCode: unavailableError }
      }
      let result: LocalFolderCreateFolderResponse
      try {
        result = await deps.createLocalFolderAsync(
          mount,
          createInput.parent_relative_path,
          createInput.folder_name
        )
      } catch (error) {
        console.error('[localFolder:createFolder] failed to create folder:', error)
        await convergeUnavailableMountFromFileError('localFolder:createFolder', mount, 'LOCAL_FILE_UNREADABLE')
        return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
      }
      if (result.success) {
        runBestEffort('localFolder:createFolder', 'invalidate local folder tree cache after create commit', () => {
          deps.invalidateLocalFolderTreeCache(createInput.notebook_id)
        })
      }
      if (!result.success) {
        await convergeUnavailableMountFromFileError('localFolder:createFolder', mount, result.errorCode)
      }
      return result
    })
  }))

  ipcMainLike.handle('localFolder:renameEntry', createSafeHandler('localFolder:renameEntry', async (_, input: LocalFolderRenameEntryInput): Promise<LocalFolderRenameEntryResponse> => {
    const normalizedInput = normalizeRenameEntryInput(input)
    if (!normalizedInput.ok) {
      return { success: false, errorCode: normalizedInput.errorCode }
    }
    const renameInput = normalizedInput.value

    const runRename = async (): Promise<LocalFolderRenameEntryResponse> => {
      const mounts = loadLocalFolderMounts('localFolder:renameEntry')
      if (!mounts) return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
      const mount = mounts.find((item) => item.notebook.id === renameInput.notebook_id)
      if (!mount) {
        return {
          success: false,
          errorCode: renameInput.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
        }
      }
      const unavailableError = resolveUnavailableMountFileError(mount, renameInput.kind)
      if (unavailableError) {
        return { success: false, errorCode: unavailableError }
      }
      let affectedMounts: LocalFolderAffectedMount[] = []
      if (renameInput.kind === 'folder') {
        let target: Awaited<ReturnType<LocalFolderIpcDeps['resolveLocalFolderDeleteTargetAsync']>>
        try {
          target = await deps.resolveLocalFolderDeleteTargetAsync(mount, {
            notebook_id: renameInput.notebook_id,
            relative_path: renameInput.relative_path,
            kind: 'folder',
          })
        } catch (error) {
          console.error('[localFolder:renameEntry] failed to resolve folder rename target:', error)
          await convergeUnavailableMountFromFileError('localFolder:renameEntry', mount, 'LOCAL_FILE_UNREADABLE')
          return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
        }
        if (!target.success) {
          await convergeUnavailableMountFromFileError('localFolder:renameEntry', mount, target.errorCode)
          return { success: false, errorCode: target.errorCode }
        }
        try {
          affectedMounts = await analyzeLocalFolderDeleteImpact(
            renameInput.notebook_id,
            target.result.absolute_path,
            'folder'
          )
        } catch (error) {
          console.error('[localFolder:renameEntry] failed to analyze affected mounts for folder rename impact:', error)
        }
      }
      let result: LocalFolderRenameEntryResponse
      try {
        result = await deps.renameLocalFolderEntryAsync(mount, renameInput)
      } catch (error) {
        console.error('[localFolder:renameEntry] failed to rename entry:', error)
        await convergeUnavailableMountFromFileError('localFolder:renameEntry', mount, 'LOCAL_FILE_UNREADABLE')
        return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
      }
      if (result.success) {
        let metadataWarning: string | undefined
        try {
          if (renameInput.kind === 'file') {
            deps.renameLocalNoteMetadataPath({
              notebook_id: renameInput.notebook_id,
              from_relative_path: renameInput.relative_path,
              to_relative_path: result.result.relative_path,
            })
            deps.renameLocalNoteIdentityPath({
              notebook_id: renameInput.notebook_id,
              from_relative_path: renameInput.relative_path,
              to_relative_path: result.result.relative_path,
            })
          } else {
            deps.renameLocalNoteMetadataFolderPath({
              notebook_id: renameInput.notebook_id,
              from_relative_folder_path: renameInput.relative_path,
              to_relative_folder_path: result.result.relative_path,
            })
            deps.renameLocalNoteIdentityFolderPath({
              notebook_id: renameInput.notebook_id,
              from_relative_folder_path: renameInput.relative_path,
              to_relative_folder_path: result.result.relative_path,
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          metadataWarning = `metadata/identity migration failed: ${message}`
          console.warn('[localFolder:renameEntry]', metadataWarning)
        }
        if (metadataWarning) {
          result.metadataWarning = metadataWarning
        }
        runBestEffort('localFolder:renameEntry', 'invalidate local folder tree cache after rename commit', () => {
          deps.invalidateLocalFolderTreeCache(renameInput.notebook_id)
        })
        if (renameInput.kind === 'file') {
          runBestEffort('localFolder:renameEntry', 'delete stale local path index after rename commit', () => {
            deps.deleteIndexForLocalPath(renameInput.notebook_id, renameInput.relative_path)
          })
          runBestEffort('localFolder:renameEntry', 'enqueue incremental notebook sync after rename commit', () => {
            deps.enqueueLocalNotebookIndexSync(renameInput.notebook_id, {
              changedRelativePath: result.result.relative_path,
              immediate: true,
            })
          })
        } else {
          runBestEffort('localFolder:renameEntry', 'enqueue full notebook sync after rename commit', () => {
            deps.enqueueLocalNotebookIndexSync(renameInput.notebook_id, {
              full: true,
              immediate: true,
            })
          })
          if (affectedMounts.length > 0) {
            for (const affectedMount of affectedMounts) {
              runBestEffort('localFolder:renameEntry', 'affected mount convergence: stop watcher', () => {
                deps.stopLocalFolderWatcher(affectedMount.notebook_id)
              }, affectedMount)

              runBestEffort('localFolder:renameEntry', 'affected mount convergence: invalidate local folder tree cache', () => {
                deps.invalidateLocalFolderTreeCache(affectedMount.notebook_id)
              }, affectedMount)

              runBestEffort('localFolder:renameEntry', 'affected mount convergence: persist missing status and broadcast', () => {
                applyLocalFolderMountStatusTransition({
                  updateLocalFolderMountStatus: deps.updateLocalFolderMountStatus,
                  notebookId: affectedMount.notebook_id,
                  status: 'missing',
                  context: 'localFolder:renameEntry',
                  enqueueLocalNotebookIndexSync: deps.enqueueLocalNotebookIndexSync,
                  scheduleLocalFolderWatchEvent: deps.scheduleLocalFolderWatchEvent,
                  enqueue: { full: true, immediate: true },
                  event: {
                    reason: 'status_changed',
                    changed_relative_path: null,
                  },
                })
              }, affectedMount)
            }
          }
        }
      }
      if (!result.success) {
        await convergeUnavailableMountFromFileError('localFolder:renameEntry', mount, result.errorCode)
      }
      return result
    }

    if (renameInput.kind === 'folder') {
      return runLocalFolderGlobalMutationSerialized(runRename)
    }
    return runLocalFolderNotebookMutationSerialized(renameInput.notebook_id, runRename)
  }))

  ipcMainLike.handle(
    'localFolder:listNoteMetadata',
    (_, inputInput?: unknown): LocalFolderListNoteMetadataResponse | Promise<LocalFolderListNoteMetadataResponse> => {
      const input = parseListNoteMetadataInput(inputInput)
      if (inputInput !== undefined && input === null) {
        return { success: true, result: { items: [] } }
      }
      const hasExplicitNotebookFilter = hasOwnDefinedProperty(input, 'notebook_ids')
      const notebookIds = parseListNotebookIdsInput(input?.notebook_ids)
      if (hasExplicitNotebookFilter && (notebookIds === null || !notebookIds || notebookIds.length === 0)) {
        return { success: true, result: { items: [] } }
      }
      const runList = (): LocalFolderListNoteMetadataResponse => {
        try {
          const items = deps.listLocalNoteMetadata({ notebookIds: notebookIds ?? undefined })
          return { success: true, result: { items } } as LocalFolderListNoteMetadataResponse
        } catch (error) {
          console.error('[localFolder:listNoteMetadata] failed:', error)
          return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
        }
      }
      return runWithLocalFolderConsistentRead(async () => runList(), notebookIds ?? undefined)
    }
  )

  ipcMainLike.handle(
    'localFolder:updateNoteMetadata',
    async (_, input: LocalFolderUpdateNoteMetadataInput | null | undefined): Promise<LocalFolderUpdateNoteMetadataResponse> => {
      const normalizedInput = normalizeUpdateNoteMetadataInput(input)
      if (!normalizedInput.ok) {
        return { success: false, errorCode: normalizedInput.errorCode }
      }
      const updateInput = normalizedInput.value
      const notebookId = updateInput.notebook_id
      const relativePath = updateInput.relative_path
      return runWithLocalFolderConsistentRead(async () => {
        const mounts = loadLocalFolderMounts('localFolder:updateNoteMetadata')
        if (!mounts) return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
        const mount = mounts.find((item) => item.notebook.id === notebookId)
        if (!mount) {
          return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
        }
        const unavailableError = resolveUnavailableMountFileError(mount, 'folder')
        if (unavailableError) {
          return { success: false, errorCode: unavailableError }
        }

        let resolved: Awaited<ReturnType<LocalFolderIpcDeps['resolveLocalFolderFilePathAsync']>>
        try {
          resolved = await deps.resolveLocalFolderFilePathAsync(mount, relativePath)
        } catch (error) {
          console.error('[localFolder:updateNoteMetadata] failed to resolve local file path:', error)
          await convergeUnavailableMountFromFileError('localFolder:updateNoteMetadata', mount, 'LOCAL_FILE_UNREADABLE')
          return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
        }
        if (!resolved.success) {
          await convergeUnavailableMountFromFileError('localFolder:updateNoteMetadata', mount, resolved.errorCode)
          return { success: false, errorCode: resolved.errorCode }
        }

        let updated: ReturnType<LocalFolderIpcDeps['updateLocalNoteMetadata']>
        try {
          updated = deps.updateLocalNoteMetadata({
            notebook_id: notebookId,
            relative_path: resolved.relative_path,
            is_favorite: updateInput.is_favorite,
            is_pinned: updateInput.is_pinned,
            ai_summary: updateInput.ai_summary,
            summary_content_hash: updateInput.summary_content_hash,
            tags: updateInput.tags,
            ai_tags: updateInput.ai_tags,
          })
        } catch (error) {
          console.error('[localFolder:updateNoteMetadata] failed to update local note metadata:', error)
          return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
        }
        if (!updated) {
          return { success: false, errorCode: 'LOCAL_FILE_WRITE_FAILED' }
        }
        return { success: true, result: updated } as LocalFolderUpdateNoteMetadataResponse
      }, [notebookId])
    }
  )

  ipcMainLike.handle('localFolder:analyzeDelete', createSafeHandler('localFolder:analyzeDelete', async (_, input: LocalFolderDeleteEntryInput): Promise<LocalFolderAnalyzeDeleteResponse> => {
    const normalizedInput = normalizeDeleteEntryInput(input)
    if (!normalizedInput.ok) {
      return { success: false, errorCode: normalizedInput.errorCode }
    }
    const deleteInput = normalizedInput.value
    return runWithLocalFolderConsistentRead(async () => {
      const mounts = loadLocalFolderMounts('localFolder:analyzeDelete')
      if (!mounts) return { success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' }
      const mount = mounts.find((item) => item.notebook.id === deleteInput.notebook_id)
      if (!mount) {
        return {
          success: false,
          errorCode: deleteInput.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
        }
      }
      const unavailableError = resolveUnavailableMountFileError(mount, deleteInput.kind)
      if (unavailableError) {
        return { success: false, errorCode: unavailableError }
      }

      let target: Awaited<ReturnType<LocalFolderIpcDeps['resolveLocalFolderDeleteTargetAsync']>>
      try {
        target = await deps.resolveLocalFolderDeleteTargetAsync(mount, deleteInput)
      } catch (error) {
        console.error('[localFolder:analyzeDelete] failed to resolve delete target:', error)
        await convergeUnavailableMountFromFileError('localFolder:analyzeDelete', mount, 'LOCAL_FILE_UNREADABLE')
        return { success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' }
      }
      if (!target.success) {
        await convergeUnavailableMountFromFileError('localFolder:analyzeDelete', mount, target.errorCode)
        return { success: false, errorCode: target.errorCode }
      }

      let affectedMounts: LocalFolderAffectedMount[]
      try {
        affectedMounts = await analyzeLocalFolderDeleteImpact(
          deleteInput.notebook_id,
          target.result.absolute_path,
          deleteInput.kind,
          { strictMountLoad: true }
        )
      } catch (error) {
        console.error('[localFolder:analyzeDelete] failed to analyze delete impact:', error)
        return { success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' }
      }

      return {
        success: true,
        result: {
          affected_mounts: affectedMounts,
        },
      }
    }, [deleteInput.notebook_id])
  }))

  ipcMainLike.handle('localFolder:deleteEntry', async (_, input: LocalFolderDeleteEntryInput): Promise<LocalFolderDeleteEntryResponse> => {
    const normalizedInput = normalizeDeleteEntryInput(input)
    if (!normalizedInput.ok) {
      return { success: false, errorCode: normalizedInput.errorCode }
    }
    const deleteInput = normalizedInput.value

    const runDelete = async (): Promise<LocalFolderDeleteEntryResponse> => {
      const mounts = loadLocalFolderMounts('localFolder:deleteEntry')
      if (!mounts) return { success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' }
      const mount = mounts.find((item) => item.notebook.id === deleteInput.notebook_id)
      if (!mount) {
        return {
          success: false,
          errorCode: deleteInput.kind === 'folder' ? 'LOCAL_FOLDER_NOT_FOUND' : 'LOCAL_FILE_NOT_FOUND',
        }
      }
      const unavailableError = resolveUnavailableMountFileError(mount, deleteInput.kind)
      if (unavailableError) {
        return { success: false, errorCode: unavailableError }
      }

      let target: Awaited<ReturnType<LocalFolderIpcDeps['resolveLocalFolderDeleteTargetAsync']>>
      try {
        target = await deps.resolveLocalFolderDeleteTargetAsync(mount, deleteInput)
      } catch (error) {
        console.error('[localFolder:deleteEntry] failed to resolve delete target:', error)
        await convergeUnavailableMountFromFileError('localFolder:deleteEntry', mount, 'LOCAL_FILE_UNREADABLE')
        return { success: false, errorCode: 'LOCAL_FILE_DELETE_FAILED' }
      }
      if (!target.success) {
        await convergeUnavailableMountFromFileError('localFolder:deleteEntry', mount, target.errorCode)
        return { success: false, errorCode: target.errorCode }
      }

      let deletedNoteUid: string | null = null
      if (deleteInput.kind === 'file') {
        try {
          deletedNoteUid = deps.getLocalNoteIdentityByPath({
            notebook_id: deleteInput.notebook_id,
            relative_path: target.result.relative_path,
          })?.note_uid || null
        } catch (error) {
          console.error('[localFolder:deleteEntry] failed to resolve note identity before delete:', error)
        }
      }

      let affectedMounts: LocalFolderAffectedMount[] = []
      try {
        affectedMounts = await analyzeLocalFolderDeleteImpact(
          deleteInput.notebook_id,
          target.result.absolute_path,
          deleteInput.kind
        )
      } catch (error) {
        console.error('[localFolder:deleteEntry] failed to analyze affected mounts for delete impact:', error)
      }

      try {
        await deps.trashItem(target.result.absolute_path)
      } catch (error) {
        console.error('[localFolder:deleteEntry] failed:', error)
        await convergeUnavailableMountFromFileError('localFolder:deleteEntry', mount, 'LOCAL_FILE_UNREADABLE')
        return {
          success: false,
          errorCode: 'LOCAL_FILE_DELETE_FAILED',
        }
      }

      if (deleteInput.kind === 'folder') {
        runBestEffortPostCommit('localFolder:deleteEntry', 'delete indexed local notes by notebook after delete commit', () => {
          deps.deleteIndexedLocalNotesByNotebook(deleteInput.notebook_id)
        })
      }

      runBestEffort('localFolder:deleteEntry', 'delete local note metadata/identity after delete commit', () => {
        deps.deleteLocalNoteMetadataByPath({
          notebook_id: deleteInput.notebook_id,
          relative_path: target.result.relative_path,
          kind: deleteInput.kind,
        })
        deps.deleteLocalNoteIdentityByPath({
          notebook_id: deleteInput.notebook_id,
          relative_path: target.result.relative_path,
          kind: deleteInput.kind,
        })
      })

      runBestEffort('localFolder:deleteEntry', 'invalidate local folder tree cache after delete commit', () => {
        deps.invalidateLocalFolderTreeCache(deleteInput.notebook_id)
      })

      if (deleteInput.kind === 'file') {
        runBestEffort('localFolder:deleteEntry', 'delete index for local path after delete commit', () => {
          deps.deleteIndexForLocalPath(deleteInput.notebook_id, target.result.relative_path, {
            noteUid: deletedNoteUid,
          })
        })
      } else {
        runBestEffort('localFolder:deleteEntry', 'enqueue full notebook sync after delete commit', () => {
          deps.enqueueLocalNotebookIndexSync(deleteInput.notebook_id, {
            full: true,
            immediate: true,
          })
        })
      }

      if (affectedMounts.length > 0) {
        for (const affectedMount of affectedMounts) {
          runBestEffort('localFolder:deleteEntry', 'affected mount convergence: stop watcher', () => {
            deps.stopLocalFolderWatcher(affectedMount.notebook_id)
          }, affectedMount)

          runBestEffort('localFolder:deleteEntry', 'affected mount convergence: invalidate local folder tree cache', () => {
            deps.invalidateLocalFolderTreeCache(affectedMount.notebook_id)
          }, affectedMount)

          runBestEffort('localFolder:deleteEntry', 'affected mount convergence: persist missing status and broadcast', () => {
            applyLocalFolderMountStatusTransition({
              updateLocalFolderMountStatus: deps.updateLocalFolderMountStatus,
              notebookId: affectedMount.notebook_id,
              status: 'missing',
              context: 'localFolder:deleteEntry',
              enqueueLocalNotebookIndexSync: deps.enqueueLocalNotebookIndexSync,
              scheduleLocalFolderWatchEvent: deps.scheduleLocalFolderWatchEvent,
              enqueue: { full: true, immediate: true },
              event: {
                reason: 'status_changed',
                changed_relative_path: null,
              },
            })
          }, affectedMount)
        }
      }

      return {
        success: true,
        result: {
          affected_mounts: affectedMounts,
        },
      }
    }

    if (deleteInput.kind === 'folder') {
      return runLocalFolderGlobalMutationSerialized(runDelete)
    }
    return runLocalFolderNotebookMutationSerialized(deleteInput.notebook_id, runDelete)
  })

  ipcMainLike.handle('localFolder:selectRoot', async (): Promise<LocalFolderSelectRootResponse> => {
    try {
      const selected = await deps.selectLocalFolderRoot()
      if (!selected) {
        return { success: false, errorCode: 'LOCAL_MOUNT_DIALOG_CANCELED' }
      }
      return { success: true, root_path: selected }
    } catch (error) {
      console.error('[localFolder:selectRoot] failed:', error)
      return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
    }
  })

  ipcMainLike.handle('localFolder:mount', async (_, input: LocalFolderMountInput): Promise<LocalFolderMountResponse> => {
    const rootPathInput = parseBoundedStringInput(input?.root_path, {
      maxLength: LOCAL_FOLDER_ROOT_PATH_MAX_LENGTH,
      trim: true,
      allowEmpty: false,
    })
    if (!rootPathInput) {
      return { success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' }
    }
    const nameInput = typeof input?.name === 'string'
      ? parseBoundedStringInput(input.name, {
        maxLength: LOCAL_FOLDER_NOTEBOOK_NAME_MAX_LENGTH,
        trim: true,
        allowEmpty: false,
      })
      : undefined
    if (typeof input?.name === 'string' && !nameInput) {
      return { success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' }
    }
    const iconInputCandidate = typeof input?.icon === 'string'
      ? parseBoundedStringInput(input.icon, {
        maxLength: LOCAL_FOLDER_NOTEBOOK_ICON_MAX_LENGTH,
      })
      : undefined
    if (typeof input?.icon === 'string' && iconInputCandidate === null) {
      return { success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' }
    }
    const iconInput = iconInputCandidate ?? undefined
    return runLocalFolderGlobalMutationSerialized(async () => {
      const canonical = await canonicalizeLocalFolderPathAsync(rootPathInput)
      if (!canonical.ok) {
        return { success: false, errorCode: canonical.errorCode }
      }

      // Product rule: the same canonical path cannot be mounted twice, regardless
      // of mount status (active/missing/permission_required).
      let existing: ReturnType<LocalFolderIpcDeps['getLocalFolderMountByCanonicalPath']>
      try {
        existing = deps.getLocalFolderMountByCanonicalPath(canonical.canonicalPath)
      } catch (error) {
        console.error('[localFolder:mount] failed to query existing mount by canonical path:', error)
        return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
      }
      if (existing) {
        return {
          success: false,
          errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
          existing_mount: {
            notebook_id: existing.notebook_id,
            status: existing.status,
          },
        }
      }

      const rootPath = resolve(rootPathInput)
      const name = nameInput || basename(rootPath)

      let creationResult: LocalFolderMountCreatePersistResult
      try {
        creationResult = deps.createLocalFolderNotebookMountSafe({
          name: name || 'Local Folder',
          icon: iconInput,
          root_path: rootPath,
          canonical_root_path: canonical.canonicalPath,
          status: 'active',
        })
      } catch (error) {
        console.error('[localFolder:mount] failed:', error)
        return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
      }

      if (creationResult.status === 'conflict') {
        let duplicated: ReturnType<LocalFolderIpcDeps['getLocalFolderMountByCanonicalPath']> = null
        try {
          duplicated = deps.getLocalFolderMountByCanonicalPath(canonical.canonicalPath)
        } catch (lookupError) {
          console.error('[localFolder:mount] failed to resolve duplicate mount after create conflict:', lookupError)
        }
        return {
          success: false,
          errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
          ...(duplicated
            ? {
              existing_mount: {
                notebook_id: duplicated.notebook_id,
                status: duplicated.status,
              },
            }
            : {}),
        }
      }

      const result = creationResult.mount

      runBestEffortPostCommit('localFolder:mount', 'sync local folder watchers after mount commit', () => deps.syncLocalFolderWatchers())
      runBestEffort('localFolder:mount', 'enqueue local notebook index sync after mount commit', () => {
        // Keep mount/relink commit path lightweight: let index sync run via background queue.
        deps.enqueueLocalNotebookIndexSync(result.notebook.id, { full: true })
      })
      return { success: true, result } as LocalFolderMountResponse
    })
  })

  ipcMainLike.handle('localFolder:relink', async (_, input: LocalFolderRelinkInput): Promise<LocalFolderRelinkResponse> => {
    const notebookId = parseRequiredNotebookIdInput(input?.notebook_id)
    const nextRootPathInput = parseBoundedStringInput(input?.root_path, {
      maxLength: LOCAL_FOLDER_ROOT_PATH_MAX_LENGTH,
      trim: true,
      allowEmpty: false,
    })
    if (!notebookId) {
      return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' }
    }
    if (!nextRootPathInput) {
      return { success: false, errorCode: 'LOCAL_MOUNT_INVALID_PATH' }
    }

    return runLocalFolderGlobalMutationSerialized(async () => {
      const canonical = await canonicalizeLocalFolderPathAsync(nextRootPathInput)
      if (!canonical.ok) {
        return { success: false, errorCode: canonical.errorCode } as LocalFolderRelinkResponse
      }

      let currentMount: ReturnType<LocalFolderIpcDeps['getLocalFolderMountByNotebookId']>
      try {
        currentMount = deps.getLocalFolderMountByNotebookId(notebookId)
      } catch (error) {
        console.error('[localFolder:relink] failed to resolve current mount:', error)
        return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' } as LocalFolderRelinkResponse
      }
      if (!currentMount) {
        return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' } as LocalFolderRelinkResponse
      }

      let duplicated: ReturnType<LocalFolderIpcDeps['getLocalFolderMountByCanonicalPath']>
      try {
        duplicated = deps.getLocalFolderMountByCanonicalPath(canonical.canonicalPath, {
          excludeNotebookId: notebookId,
        })
      } catch (error) {
        console.error('[localFolder:relink] failed to query duplicate mount by canonical path:', error)
        return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' } as LocalFolderRelinkResponse
      }
      if (duplicated && duplicated.notebook_id !== notebookId) {
        return {
          success: false,
          errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
          existing_mount: {
            notebook_id: duplicated.notebook_id,
            status: duplicated.status,
          },
        } as LocalFolderRelinkResponse
      }

      const nextRootPath = resolve(nextRootPathInput)
      let updateResult: LocalFolderMountRootPersistResult
      try {
        updateResult = deps.updateLocalFolderMountRoot({
          notebook_id: notebookId,
          root_path: nextRootPath,
          canonical_root_path: canonical.canonicalPath,
          status: 'active',
        })
      } catch (error) {
        console.error('[localFolder:relink] failed:', error)
        return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' } as LocalFolderRelinkResponse
      }

      if (updateResult.status === 'conflict') {
        let duplicated: ReturnType<LocalFolderIpcDeps['getLocalFolderMountByCanonicalPath']> = null
        try {
          duplicated = deps.getLocalFolderMountByCanonicalPath(canonical.canonicalPath, {
            excludeNotebookId: notebookId,
          })
        } catch (lookupError) {
          console.error('[localFolder:relink] failed to resolve duplicate mount after root-update conflict:', lookupError)
        }
        return {
          success: false,
          errorCode: 'LOCAL_MOUNT_ALREADY_EXISTS',
          ...(duplicated
            ? {
              existing_mount: {
                notebook_id: duplicated.notebook_id,
                status: duplicated.status,
              },
            }
            : {}),
        } as LocalFolderRelinkResponse
      }

      if (updateResult.status === 'not_found') {
        return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' } as LocalFolderRelinkResponse
      }

      const updated = updateResult.mount
      runBestEffort('localFolder:relink', 'invalidate local folder tree cache after relink commit', () => deps.invalidateLocalFolderTreeCache(notebookId))
      runBestEffort('localFolder:relink', 'stop local folder watcher after relink commit', () => deps.stopLocalFolderWatcher(notebookId))
      runBestEffortPostCommit('localFolder:relink', 'sync local folder watchers after relink commit', () => deps.syncLocalFolderWatchers())
      runBestEffort('localFolder:relink', 'enqueue local notebook index sync after relink commit', () => {
        // Keep relink commit path lightweight: let index sync run via background queue.
        deps.enqueueLocalNotebookIndexSync(notebookId, { full: true })
      })
      runBestEffort('localFolder:relink', 'schedule local folder watch event after relink commit', () => {
        deps.scheduleLocalFolderWatchEvent({
          notebook_id: notebookId,
          status: 'active',
          reason: 'status_changed',
          changed_relative_path: null,
        })
      })
      return { success: true, result: updated } as LocalFolderRelinkResponse
    })
  })

  ipcMainLike.handle('localFolder:openInFileManager', async (_, notebookIdInput: unknown): Promise<LocalFolderOpenInFileManagerResponse> => {
    const notebookId = parseRequiredNotebookIdInput(notebookIdInput)
    if (!notebookId) {
      return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' }
    }
    return runWithLocalFolderConsistentRead(async () => {
      let mount: ReturnType<LocalFolderIpcDeps['getLocalFolderMountByNotebookId']>
      try {
        mount = deps.getLocalFolderMountByNotebookId(notebookId)
      } catch (error) {
        console.error('[localFolder:openInFileManager] failed to resolve mount:', error)
        return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
      }
      if (!mount) return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' }

      try {
        const result = await deps.openPath(mount.root_path)
        if (result === '') return { success: true }
        return { success: false, errorCode: 'LOCAL_MOUNT_OPEN_FAILED' }
      } catch (error) {
        console.error('[localFolder:openInFileManager] failed:', error)
        return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
      }
    }, [notebookId])
  })

  ipcMainLike.handle('localFolder:unmount', async (_, notebookIdInput: unknown): Promise<LocalFolderUnmountResponse> => {
    const notebookId = parseRequiredNotebookIdInput(notebookIdInput) ?? ''
    const startedAt = Date.now()
    if (!notebookId) {
      logLocalFolderUnmountAudit({
        notebookId,
        success: false,
        errorCode: 'invalid_notebook_id',
        durationMs: Date.now() - startedAt,
      })
      return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_FOUND' }
    }

    return runLocalFolderGlobalMutationSerialized(async () => {
      let convergedReason: 'deleted' | 'not_found'
      try {
        const deleteResult = deps.deleteLocalFolderNotebook(notebookId)
        if (deleteResult.ok) {
          convergedReason = 'deleted'
        } else if (deleteResult.error === 'notebook_not_found') {
          convergedReason = 'not_found'
        } else {
          console.error('[localFolder:unmount] rejected non-local notebook unmount:', notebookId)
          logLocalFolderUnmountAudit({
            notebookId,
            success: false,
            errorCode: deleteResult.error,
            durationMs: Date.now() - startedAt,
          })
          return { success: false, errorCode: 'LOCAL_NOTEBOOK_NOT_LOCAL_FOLDER' }
        }
      } catch (error) {
        console.error('[localFolder:unmount] failed to delete notebook:', error)
        logLocalFolderUnmountAudit({
          notebookId,
          success: false,
          errorCode: 'delete_notebook_failed',
          durationMs: Date.now() - startedAt,
        })
        return { success: false, errorCode: 'LOCAL_MOUNT_PATH_UNREACHABLE' }
      }

      runBestEffort('localFolder:unmount', 'stop watcher', () => deps.stopLocalFolderWatcher(notebookId))
      runBestEffort('localFolder:unmount', 'clear notebook index sync state', () => deps.clearLocalNotebookIndexSyncForNotebook(notebookId))
      runBestEffortPostCommit('localFolder:unmount', 'delete indexed local notes', () => deps.deleteIndexedLocalNotesByNotebook(notebookId))
      runBestEffort('localFolder:unmount', 'invalidate local folder tree cache', () => deps.invalidateLocalFolderTreeCache(notebookId))
      runBestEffortPostCommit('localFolder:unmount', 'sync local folder watchers', () => deps.syncLocalFolderWatchers())

      logLocalFolderUnmountAudit({
        notebookId,
        success: true,
        ...(convergedReason === 'not_found' ? { errorCode: 'notebook_not_found_converged' } : {}),
        durationMs: Date.now() - startedAt,
      })
      return { success: true }
    })
  })

  return {
    waitForLocalFolderMutationTails,
    runWithLocalFolderTopologyReadScope,
    runWithLocalFolderConsistentRead,
  }
}
