import type { LocalFolderTreeResult } from '../../shared/types'
import {
  getLocalFolderMounts,
  getLocalNoteIdentityByPath,
  listLocalNoteIdentity,
  ensureLocalNoteIdentity,
  ensureLocalNoteIdentitiesBatch,
} from '../database'
import {
  readLocalFolderFileAsync,
  scanLocalFolderMountForSearchAsync,
  statLocalFolderFileAsync,
} from '../local-folder'
import { yieldToEventLoop } from '../local-folder/cache'
import { getCachedLocalFolderTree, invalidateLocalFolderTreeCache } from '../local-folder-tree-cache'
import { isLocalFolderTreeRootMatched } from '../local-folder-root-match'
import { emitLocalPerformanceSummaryAudit } from '../local-performance-audit'
import { cleanupMissingLocalNoteState } from '../local-note-state-cleanup'
import { parseRequiredNotebookIdInput } from '../notebook-id'
import { parseRequiredLocalNoteUidInput } from '../local-note-uid'
import { getStartupPhaseState, type StartupPhaseState } from '../startup-phase'
import {
  indexingService,
  getNoteIndexStatusBatch,
  updateNoteIndexFileMtimeIfIndexed,
  type NoteIndexStatus,
} from '../embedding'
import {
  normalizeLocalIndexSyncPath,
  resolveLocalIndexNoteId,
  collectIndexedLocalNoteIdsByNotebook,
  deleteIndexedLocalNotesByNotebook,
  deleteIndexForLocalPath,
  syncLocalNoteTagsMetadata,
  syncLocalNoteTagsMetadataBatch,
  syncLocalNotePopupRefs,
  syncLocalNotePopupRefsBatch,
  deleteLocalNoteMetadataByPath,
  deleteLocalNoteIdentityByPath,
} from './helpers'
import { isKnowledgeBaseRebuilding } from './knowledge-base-rebuild'

const LOCAL_NOTE_INDEX_SYNC_DEBOUNCE_MS = 900
const LOCAL_NOTE_INDEX_SYNC_YIELD_INTERVAL = Number.isFinite(Number(process.env.LOCAL_NOTE_INDEX_SYNC_YIELD_INTERVAL))
  ? Math.max(8, Number(process.env.LOCAL_NOTE_INDEX_SYNC_YIELD_INTERVAL))
  : 32
const LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN = Number.isFinite(Number(process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN))
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN)))
  : 256
const LOCAL_NOTE_INDEX_SYNC_COLD_FULL_ADAPTIVE_ENABLED = process.env.LOCAL_NOTE_INDEX_SYNC_COLD_FULL_ADAPTIVE_ENABLED !== '0'
const LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN)))
  : (
    process.env.NODE_ENV === 'test'
      ? LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
      : (LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN > 0 ? Math.min(64, LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN) : 64)
  )
const LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED = process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED !== '0'
const LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN)))
  : (
    process.env.NODE_ENV === 'test'
      ? LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN
      : (LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN > 0 ? Math.min(64, LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN) : 64)
  )
const LOCAL_NOTE_INDEX_SYNC_METADATA_BATCH_SIZE = Number.isFinite(Number(process.env.LOCAL_NOTE_INDEX_SYNC_METADATA_BATCH_SIZE))
  ? Math.max(8, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_METADATA_BATCH_SIZE)))
  : 64
const LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE = Number.isFinite(Number(process.env.LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE))
  ? Math.max(16, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE)))
  : 256
const LOCAL_NOTE_INDEX_SYNC_STARTUP_IDENTITY_BATCH_SIZE = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_IDENTITY_BATCH_SIZE)
)
  ? Math.max(8, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_IDENTITY_BATCH_SIZE)))
  : (
    process.env.NODE_ENV === 'test'
      ? LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE
      : Math.max(8, Math.min(64, LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE))
  )
const LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE)
)
  ? Math.max(16, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE)))
  : 512
const LOCAL_NOTE_INDEX_SYNC_STARTUP_STATUS_PRELOAD_BATCH_SIZE = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_STATUS_PRELOAD_BATCH_SIZE)
)
  ? Math.max(8, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_STATUS_PRELOAD_BATCH_SIZE)))
  : (
    process.env.NODE_ENV === 'test'
      ? LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE
      : Math.max(8, Math.min(128, LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE))
  )
const LOCAL_NOTE_INDEX_SYNC_DELETE_BATCH_SIZE = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_DELETE_BATCH_SIZE)
)
  ? Math.max(1, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_DELETE_BATCH_SIZE)))
  : 128
const LOCAL_NOTE_INDEX_SYNC_STARTUP_DELETE_BATCH_SIZE = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_DELETE_BATCH_SIZE)
)
  ? Math.max(1, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_DELETE_BATCH_SIZE)))
  : (
    process.env.NODE_ENV === 'test'
      ? LOCAL_NOTE_INDEX_SYNC_DELETE_BATCH_SIZE
      : Math.max(1, Math.min(32, LOCAL_NOTE_INDEX_SYNC_DELETE_BATCH_SIZE))
  )
const LOCAL_NOTE_INDEX_SYNC_MAX_STALE_DELETE_PER_RUN = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_MAX_STALE_DELETE_PER_RUN)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_MAX_STALE_DELETE_PER_RUN)))
  : (process.env.NODE_ENV === 'test' ? 0 : 512)
const LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_STALE_DELETE_PER_RUN = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_STALE_DELETE_PER_RUN)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_STALE_DELETE_PER_RUN)))
  : (
    process.env.NODE_ENV === 'test'
      ? LOCAL_NOTE_INDEX_SYNC_MAX_STALE_DELETE_PER_RUN
      : (
        LOCAL_NOTE_INDEX_SYNC_MAX_STALE_DELETE_PER_RUN > 0
          ? Math.max(1, Math.min(128, LOCAL_NOTE_INDEX_SYNC_MAX_STALE_DELETE_PER_RUN))
          : 128
      )
  )
const LOCAL_NOTE_INDEX_SYNC_PROFILE = process.env.LOCAL_NOTE_INDEX_SYNC_PROFILE === '1'
const LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS = Number.isFinite(Number(process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS))
  ? Math.max(500, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS)))
  : 3000
const LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS = Number.isFinite(Number(process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS))
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS)))
  : (process.env.NODE_ENV === 'test' ? 0 : 180)
const LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS = Number.isFinite(Number(process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS))
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS)))
  : (process.env.NODE_ENV === 'test' ? 0 : 120)
const LOCAL_NOTE_INDEX_SYNC_STARTUP_DELAY_ADAPTIVE_ENABLED = process.env.NODE_ENV === 'test'
  ? process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_DELAY_ADAPTIVE_ENABLED === '1'
  : process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_DELAY_ADAPTIVE_ENABLED !== '0'
const LOCAL_NOTE_INDEX_SYNC_STARTUP_INITIAL_FULL_DELAY_MS = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_INITIAL_FULL_DELAY_MS)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_INITIAL_FULL_DELAY_MS)))
  : (process.env.NODE_ENV === 'test' ? LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS : Math.max(600, LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS))
const LOCAL_NOTE_INDEX_SYNC_STARTUP_REQUEUE_DELAY_MS = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_REQUEUE_DELAY_MS)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_STARTUP_REQUEUE_DELAY_MS)))
  : (process.env.NODE_ENV === 'test' ? LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS : Math.max(220, LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS))
const LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS = Number.isFinite(Number(process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS))
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS)))
  : (process.env.NODE_ENV === 'test' ? 0 : 120)
const LOCAL_NOTE_INDEX_SYNC_SCAN_CACHE_MAX_AGE_MS = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_SCAN_CACHE_MAX_AGE_MS)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_SCAN_CACHE_MAX_AGE_MS)))
  : (process.env.NODE_ENV === 'test' ? 0 : 1500)
const LOCAL_NOTE_INDEX_SYNC_MTIME_BACKFILL_MAX_INDEXED_AT_SKEW_MS = Number.isFinite(
  Number(process.env.LOCAL_NOTE_INDEX_SYNC_MTIME_BACKFILL_MAX_INDEXED_AT_SKEW_MS)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_NOTE_INDEX_SYNC_MTIME_BACKFILL_MAX_INDEXED_AT_SKEW_MS)))
  : (process.env.NODE_ENV === 'test' ? 0 : 2000)

interface LocalNotebookIndexSyncRequest {
  full: boolean
  forceIndexForPaths: boolean
  paths: Set<string>
  knownFileMtimeMsByPath: Map<string, number>
}

const localNotebookIndexSyncRequests = new Map<string, LocalNotebookIndexSyncRequest>()
const localNotebookIndexSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()
const localNotebookIndexSyncRunning = new Set<string>()
const localNotebookIndexSyncRunningRequests = new Map<string, LocalNotebookIndexSyncRequest>()
const localNotebookIndexSyncCancelEpochByNotebook = new Map<string, number>()
const localNotebookIndexSyncRebuildRunningByNotebook = new Map<string, number>()
let localNotebookIndexSyncSequence: Promise<void> = Promise.resolve()
let localNotebookIndexSyncGeneration = 0
let localNotebookIndexSyncRebuildRunning = 0

interface LocalNotebookIndexSyncSummary {
  mode: 'incremental' | 'full'
  requestedPathCount: number
  scannedFileCount: number
  preloadedStatusCount: number
  staleDeleteCount: number
  requeuedStaleDeleteCount: number
  skippedByMtimeCount: number
  backfilledMtimeCount: number
  candidatePathCount: number
  indexedCount: number
  readFailureCount: number
  requeuedPathCount: number
  timeBudgetHit: boolean
  scanCacheHit: boolean
  cancelled: boolean
  mountInactive: boolean
  scanFailed: boolean
}

function maybeLogLocalNotebookIndexSyncSummary(
  notebookId: string,
  summary: LocalNotebookIndexSyncSummary,
  durationMs: number,
  startupState: StartupPhaseState,
  maxIndexPerRun: number,
  coldFullSync: boolean,
  options?: {
    effectiveIdentityBatchSize?: number
    effectiveStatusPreloadBatchSize?: number
    effectiveDeleteBatchSize?: number
    effectiveMaxStaleDeletePerRun?: number
  }
): void {
  if (
    !LOCAL_NOTE_INDEX_SYNC_PROFILE
    && durationMs < LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS
    && !summary.timeBudgetHit
  ) {
    return
  }
  emitLocalPerformanceSummaryAudit(console, '[LocalIndexSyncAudit]', {
    operation: 'local_notebook_index_sync',
    notebook_id: notebookId,
    duration_ms: durationMs,
    slow_threshold_ms: LOCAL_NOTE_INDEX_SYNC_SLOW_LOG_MS,
    profile_enabled: LOCAL_NOTE_INDEX_SYNC_PROFILE,
    startup_phase: startupState.inStartupPhase,
    startup_elapsed_ms: startupState.elapsedMs,
    startup_window_ms: startupState.windowMs,
    mode: summary.mode,
    requested_path_count: summary.requestedPathCount,
    scanned_file_count: summary.scannedFileCount,
    preloaded_status_count: summary.preloadedStatusCount,
    stale_delete_count: summary.staleDeleteCount,
    requeued_stale_delete_count: summary.requeuedStaleDeleteCount,
    skipped_by_mtime_count: summary.skippedByMtimeCount,
    backfilled_mtime_count: summary.backfilledMtimeCount,
    candidate_path_count: summary.candidatePathCount,
    indexed_count: summary.indexedCount,
    read_failure_count: summary.readFailureCount,
    requeued_path_count: summary.requeuedPathCount,
    cancelled: summary.cancelled,
    mount_inactive: summary.mountInactive,
    scan_failed: summary.scanFailed,
    max_index_per_run: maxIndexPerRun,
    base_max_index_per_run: LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN,
    cold_full_sync: coldFullSync,
    cold_full_adaptive_enabled: LOCAL_NOTE_INDEX_SYNC_COLD_FULL_ADAPTIVE_ENABLED,
    cold_full_max_index_per_run: LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN,
    startup_adaptive_enabled: LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED,
    startup_max_index_per_run: LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN,
    metadata_batch_size: LOCAL_NOTE_INDEX_SYNC_METADATA_BATCH_SIZE,
    identity_batch_size: LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE,
    startup_identity_batch_size: LOCAL_NOTE_INDEX_SYNC_STARTUP_IDENTITY_BATCH_SIZE,
    effective_identity_batch_size: options?.effectiveIdentityBatchSize ?? LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE,
    status_preload_batch_size: LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE,
    startup_status_preload_batch_size: LOCAL_NOTE_INDEX_SYNC_STARTUP_STATUS_PRELOAD_BATCH_SIZE,
    effective_status_preload_batch_size: options?.effectiveStatusPreloadBatchSize ?? LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE,
    delete_batch_size: LOCAL_NOTE_INDEX_SYNC_DELETE_BATCH_SIZE,
    startup_delete_batch_size: LOCAL_NOTE_INDEX_SYNC_STARTUP_DELETE_BATCH_SIZE,
    effective_delete_batch_size: options?.effectiveDeleteBatchSize ?? LOCAL_NOTE_INDEX_SYNC_DELETE_BATCH_SIZE,
    max_stale_delete_per_run: LOCAL_NOTE_INDEX_SYNC_MAX_STALE_DELETE_PER_RUN,
    startup_max_stale_delete_per_run: LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_STALE_DELETE_PER_RUN,
    effective_max_stale_delete_per_run: options?.effectiveMaxStaleDeletePerRun ?? LOCAL_NOTE_INDEX_SYNC_MAX_STALE_DELETE_PER_RUN,
    startup_delay_adaptive_enabled: LOCAL_NOTE_INDEX_SYNC_STARTUP_DELAY_ADAPTIVE_ENABLED,
    startup_initial_full_delay_ms: LOCAL_NOTE_INDEX_SYNC_STARTUP_INITIAL_FULL_DELAY_MS,
    startup_requeue_delay_ms: LOCAL_NOTE_INDEX_SYNC_STARTUP_REQUEUE_DELAY_MS,
    initial_full_delay_ms: LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS,
    requeue_delay_ms: LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS,
    max_duration_ms: LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS,
    time_budget_hit: summary.timeBudgetHit,
    scan_cache_max_age_ms: LOCAL_NOTE_INDEX_SYNC_SCAN_CACHE_MAX_AGE_MS,
    scan_cache_hit: summary.scanCacheHit,
  })
}

function resolveMaxIndexPerRun(
  startupState: StartupPhaseState,
  options?: { coldFullSync?: boolean }
): number {
  let limit = LOCAL_NOTE_INDEX_SYNC_MAX_INDEX_PER_RUN

  if (
    options?.coldFullSync
    && LOCAL_NOTE_INDEX_SYNC_COLD_FULL_ADAPTIVE_ENABLED
    && LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN > 0
  ) {
    if (limit <= 0) {
      limit = LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN
    } else {
      limit = Math.min(limit, LOCAL_NOTE_INDEX_SYNC_COLD_FULL_MAX_INDEX_PER_RUN)
    }
  }

  if (
    LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED
    && startupState.inStartupPhase
    && LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN > 0
  ) {
    if (limit <= 0) {
      limit = LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN
    } else {
      limit = Math.min(limit, LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_INDEX_PER_RUN)
    }
  }

  return limit
}

function resolveIdentityBatchSize(startupState: StartupPhaseState): number {
  let batchSize = LOCAL_NOTE_INDEX_SYNC_IDENTITY_BATCH_SIZE
  if (
    LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED
    && startupState.inStartupPhase
  ) {
    batchSize = Math.min(batchSize, LOCAL_NOTE_INDEX_SYNC_STARTUP_IDENTITY_BATCH_SIZE)
  }
  return Math.max(1, batchSize)
}

function resolveStatusPreloadBatchSize(startupState: StartupPhaseState): number {
  let batchSize = LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE
  if (
    LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED
    && startupState.inStartupPhase
  ) {
    batchSize = Math.min(batchSize, LOCAL_NOTE_INDEX_SYNC_STARTUP_STATUS_PRELOAD_BATCH_SIZE)
  }
  return Math.max(1, batchSize)
}

function resolveDeleteBatchSize(startupState: StartupPhaseState): number {
  let batchSize = LOCAL_NOTE_INDEX_SYNC_DELETE_BATCH_SIZE
  if (
    LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED
    && startupState.inStartupPhase
  ) {
    batchSize = Math.min(batchSize, LOCAL_NOTE_INDEX_SYNC_STARTUP_DELETE_BATCH_SIZE)
  }
  return Math.max(1, batchSize)
}

function resolveMaxStaleDeletePerRun(startupState: StartupPhaseState): number {
  let limit = LOCAL_NOTE_INDEX_SYNC_MAX_STALE_DELETE_PER_RUN
  if (
    LOCAL_NOTE_INDEX_SYNC_STARTUP_ADAPTIVE_ENABLED
    && startupState.inStartupPhase
    && LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_STALE_DELETE_PER_RUN > 0
  ) {
    if (limit <= 0) {
      limit = LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_STALE_DELETE_PER_RUN
    } else {
      limit = Math.min(limit, LOCAL_NOTE_INDEX_SYNC_STARTUP_MAX_STALE_DELETE_PER_RUN)
    }
  }
  return limit
}

function resolveFileMtimeIso(mtimeMs: number | null | undefined): string | null {
  if (!Number.isFinite(mtimeMs)) return null
  return new Date(Number(mtimeMs)).toISOString()
}

function resolveIndexedLocalId(
  notebookId: string,
  relativePath: string,
  noteUid: string | null | undefined
): string {
  const parsedUid = parseRequiredLocalNoteUidInput(noteUid)
  if (parsedUid) return parsedUid
  return resolveLocalIndexNoteId(notebookId, relativePath)
}

function shouldSkipFullSyncIndexByMtime(
  status: NoteIndexStatus | null | undefined,
  fileMtimeMs: number | null | undefined
): boolean {
  if (!status) return false
  if (status.status !== 'indexed' || status.ftsStatus !== 'indexed') return false
  if (!status.fileMtime) return false
  const mtimeIso = resolveFileMtimeIso(fileMtimeMs)
  if (!mtimeIso) return false
  return status.fileMtime === mtimeIso
}

function canBackfillIndexedStatusMtimeWithoutReindex(
  status: NoteIndexStatus | null | undefined,
  fileMtimeMs: number | null | undefined
): { canBackfill: boolean; fileMtimeIso: string | null } {
  if (!status) return { canBackfill: false, fileMtimeIso: null }
  if (status.status !== 'indexed' || status.ftsStatus !== 'indexed') {
    return { canBackfill: false, fileMtimeIso: null }
  }
  if (status.fileMtime) {
    return { canBackfill: false, fileMtimeIso: null }
  }

  const mtimeIso = resolveFileMtimeIso(fileMtimeMs)
  if (!mtimeIso) return { canBackfill: false, fileMtimeIso: null }

  const indexedAtMs = Date.parse(status.indexedAt)
  if (!Number.isFinite(indexedAtMs)) return { canBackfill: false, fileMtimeIso: null }

  const fileMtimeNumber = Number(fileMtimeMs)
  if (!Number.isFinite(fileMtimeNumber)) return { canBackfill: false, fileMtimeIso: null }

  // 仅在索引时间不早于文件修改时间时才允许回填，避免跳过潜在的真实内容变更。
  if (fileMtimeNumber > indexedAtMs + LOCAL_NOTE_INDEX_SYNC_MTIME_BACKFILL_MAX_INDEXED_AT_SKEW_MS) {
    return { canBackfill: false, fileMtimeIso: null }
  }

  return { canBackfill: true, fileMtimeIso: mtimeIso }
}

function tryBackfillIndexedStatusMtimeWithoutReindex(
  noteId: string,
  status: NoteIndexStatus | null | undefined,
  fileMtimeMs: number | null | undefined
): boolean {
  const decision = canBackfillIndexedStatusMtimeWithoutReindex(status, fileMtimeMs)
  if (!decision.canBackfill || !decision.fileMtimeIso) return false
  return updateNoteIndexFileMtimeIfIndexed(noteId, decision.fileMtimeIso)
}

async function yieldEvery(count: number): Promise<void> {
  if (count % LOCAL_NOTE_INDEX_SYNC_YIELD_INTERVAL !== 0) return
  await yieldToEventLoop()
}

async function ensureLocalNoteIdentitiesBatchCooperative(input: {
  notebookId: string
  relativePaths: readonly string[]
  batchSize: number
}): Promise<Map<string, { note_uid?: string | null }>> {
  if (!Array.isArray(input.relativePaths) || input.relativePaths.length === 0) {
    return new Map()
  }
  const batchSize = Math.max(1, Math.floor(input.batchSize))

  let fallbackSingleEnsureErrorLogged = false
  const ensureSinglePathFallback = (
    relativePath: string
  ): { note_uid?: string | null } | null => {
    try {
      const identity = ensureLocalNoteIdentity({
        notebook_id: input.notebookId,
        relative_path: relativePath,
      })
      const noteUid = parseRequiredLocalNoteUidInput(identity?.note_uid)
      if (!noteUid) return null
      return { note_uid: noteUid }
    } catch (error) {
      if (!fallbackSingleEnsureErrorLogged) {
        fallbackSingleEnsureErrorLogged = true
        console.warn(
          '[LocalIndex] Failed to ensure local note identities in batch and single-path fallback; some paths may use path-based IDs in this pass:',
          input.notebookId,
          error
        )
      }
      return null
    }
  }

  if (input.relativePaths.length <= batchSize) {
    try {
      return ensureLocalNoteIdentitiesBatch({
        notebook_id: input.notebookId,
        relative_paths: input.relativePaths,
      })
    } catch (error) {
      console.warn(
        '[LocalIndex] Failed to ensure local note identities in batch; fallback to single-path ensure for this pass:',
        input.notebookId,
        error
      )
      const fallbackEnsured = new Map<string, { note_uid?: string | null }>()
      for (const relativePath of input.relativePaths) {
        const ensured = ensureSinglePathFallback(relativePath)
        if (!ensured) continue
        fallbackEnsured.set(relativePath, ensured)
      }
      return fallbackEnsured
    }
  }

  const ensuredByPath = new Map<string, { note_uid?: string | null }>()
  for (let offset = 0; offset < input.relativePaths.length; offset += batchSize) {
    const chunk = input.relativePaths.slice(offset, offset + batchSize)
    let chunkEnsured: Map<string, { note_uid?: string | null }>
    try {
      chunkEnsured = ensureLocalNoteIdentitiesBatch({
        notebook_id: input.notebookId,
        relative_paths: chunk,
      })
    } catch (error) {
      console.warn(
        '[LocalIndex] Failed to ensure local note identities for a chunk; fallback to single-path ensure for this chunk:',
        input.notebookId,
        error
      )
      chunkEnsured = new Map<string, { note_uid?: string | null }>()
      for (const relativePath of chunk) {
        const ensured = ensureSinglePathFallback(relativePath)
        if (!ensured) continue
        chunkEnsured.set(relativePath, ensured)
      }
    }
    for (const [relativePath, identity] of chunkEnsured.entries()) {
      ensuredByPath.set(relativePath, identity)
    }
    if (offset + batchSize < input.relativePaths.length) {
      await yieldToEventLoop()
    }
  }
  return ensuredByPath
}

async function getNoteIndexStatusBatchCooperative(
  noteIds: readonly string[],
  options?: { batchSize?: number }
): Promise<Map<string, NoteIndexStatus>> {
  if (!Array.isArray(noteIds) || noteIds.length === 0) {
    return new Map()
  }
  const batchSize = Math.max(1, Math.floor(options?.batchSize || LOCAL_NOTE_INDEX_SYNC_STATUS_PRELOAD_BATCH_SIZE))

  if (noteIds.length <= batchSize) {
    return getNoteIndexStatusBatch(noteIds)
  }

  const statusByNoteId = new Map<string, NoteIndexStatus>()
  for (let offset = 0; offset < noteIds.length; offset += batchSize) {
    const chunk = noteIds.slice(offset, offset + batchSize)
    const chunkStatuses = getNoteIndexStatusBatch(chunk)
    for (const [noteId, status] of chunkStatuses.entries()) {
      statusByNoteId.set(noteId, status)
    }
    if (offset + batchSize < noteIds.length) {
      await yieldToEventLoop()
    }
  }
  return statusByNoteId
}

function hasExceededLocalNoteIndexSyncRunTimeBudget(
  runStartedAt: number,
  processedCount: number
): boolean {
  if (LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS <= 0) return false
  if (processedCount <= 0) return false
  return Date.now() - runStartedAt >= LOCAL_NOTE_INDEX_SYNC_MAX_DURATION_MS
}

export function cancelPendingLocalNotebookIndexSync(options?: { invalidateRunning?: boolean }): void {
  if (options?.invalidateRunning) {
    localNotebookIndexSyncGeneration += 1
    localNotebookIndexSyncCancelEpochByNotebook.clear()
  }
  for (const timer of localNotebookIndexSyncTimers.values()) {
    clearTimeout(timer)
  }
  localNotebookIndexSyncTimers.clear()
  localNotebookIndexSyncRequests.clear()
}

function isLocalNotebookIndexSyncCancelled(runGeneration: number): boolean {
  return runGeneration !== localNotebookIndexSyncGeneration
}

function getLocalNotebookIndexSyncCancelEpoch(notebookId: string): number {
  return localNotebookIndexSyncCancelEpochByNotebook.get(notebookId) || 0
}

function bumpLocalNotebookIndexSyncCancelEpoch(notebookId: string): void {
  const next = getLocalNotebookIndexSyncCancelEpoch(notebookId) + 1
  localNotebookIndexSyncCancelEpochByNotebook.set(notebookId, next)
}

async function syncLocalNotebookIndex(
  notebookId: string,
  request: LocalNotebookIndexSyncRequest,
  runGeneration: number,
  runCancelEpoch: number
): Promise<void> {
  const startedAt = Date.now()
  const startupState = getStartupPhaseState(startedAt)
  const coldFullSync = request.full && !request.forceIndexForPaths && request.paths.size === 0
  const maxIndexPerRun = resolveMaxIndexPerRun(startupState, { coldFullSync })
  const identityBatchSize = resolveIdentityBatchSize(startupState)
  const statusPreloadBatchSize = resolveStatusPreloadBatchSize(startupState)
  const deleteBatchSize = resolveDeleteBatchSize(startupState)
  const maxStaleDeletePerRun = resolveMaxStaleDeletePerRun(startupState)
  const summary: LocalNotebookIndexSyncSummary = {
    mode: request.full ? 'full' : 'incremental',
    requestedPathCount: request.paths.size,
    scannedFileCount: 0,
    preloadedStatusCount: 0,
    staleDeleteCount: 0,
    requeuedStaleDeleteCount: 0,
    skippedByMtimeCount: 0,
    backfilledMtimeCount: 0,
    candidatePathCount: 0,
    indexedCount: 0,
    readFailureCount: 0,
    requeuedPathCount: 0,
    timeBudgetHit: false,
    scanCacheHit: false,
    cancelled: false,
    mountInactive: false,
    scanFailed: false,
  }
  const isCancelled = (): boolean => {
    const cancelled = (
      isLocalNotebookIndexSyncCancelled(runGeneration)
      || getLocalNotebookIndexSyncCancelEpoch(notebookId) !== runCancelEpoch
    )
    if (cancelled) {
      summary.cancelled = true
    }
    return cancelled
  }
  const identityEnsureFailureLoggedPaths = new Set<string>()
  const ensureLocalNoteUidForPath = (relativePath: string): string | null => {
    try {
      const ensuredIdentity = ensureLocalNoteIdentity({
        notebook_id: notebookId,
        relative_path: relativePath,
      })
      return parseRequiredLocalNoteUidInput(ensuredIdentity?.note_uid) || null
    } catch (error) {
      if (!identityEnsureFailureLoggedPaths.has(relativePath)) {
        identityEnsureFailureLoggedPaths.add(relativePath)
        console.warn(
          '[LocalIndex] Failed to ensure local note identity for path; fallback to path-based local ID for this run:',
          notebookId,
          relativePath,
          error
        )
      }
      return null
    }
  }
  const shouldDeleteLocalPathStateForReadFailure = (errorCode: string): boolean => (
    errorCode === 'LOCAL_FILE_NOT_FOUND'
    || errorCode === 'LOCAL_FILE_NOT_A_FILE'
    || errorCode === 'LOCAL_FILE_UNSUPPORTED_TYPE'
    || errorCode === 'LOCAL_FILE_OUT_OF_ROOT'
  )
  const cleanupLocalPathAfterReadFailure = (
    relativePath: string,
    errorCode: string,
    options?: { noteUid?: string | null }
  ): void => {
    summary.readFailureCount += 1
    const resolvedNoteUid = parseRequiredLocalNoteUidInput(options?.noteUid) || null
    deleteIndexForLocalPath(notebookId, relativePath, { noteUid: resolvedNoteUid })
    if (!shouldDeleteLocalPathStateForReadFailure(errorCode)) {
      return
    }
    deleteLocalNoteMetadataByPath({
      notebook_id: notebookId,
      relative_path: relativePath,
      kind: 'file',
    })
    deleteLocalNoteIdentityByPath({
      notebook_id: notebookId,
      relative_path: relativePath,
      kind: 'file',
    })
  }

  try {
    if (isCancelled()) {
      return
    }

    const mount = getLocalFolderMounts().find((item) => item.notebook.id === notebookId)
    if (!mount || mount.mount.status !== 'active') {
      summary.mountInactive = true
      deleteIndexedLocalNotesByNotebook(notebookId)
      return
    }

    // Incremental fast-path: changed files only, skip full tree scan.
    if (!request.full) {
      if (request.paths.size === 0) {
        return
      }
      const incrementalPaths = Array.from(request.paths)
      summary.candidatePathCount = incrementalPaths.length
      const incrementalPreloadPathLimit = maxIndexPerRun > 0
        ? Math.min(maxIndexPerRun, incrementalPaths.length)
        : incrementalPaths.length
      const incrementalPreloadPaths = incrementalPreloadPathLimit < incrementalPaths.length
        ? incrementalPaths.slice(0, incrementalPreloadPathLimit)
        : incrementalPaths
      const shouldPreloadForceIndexStatuses = request.forceIndexForPaths && incrementalPreloadPaths.length > 0
      const shouldBatchMetadataSync = request.forceIndexForPaths && incrementalPaths.length > 1
      const noteUidByPath = new Map<string, string | null>()
      if (shouldBatchMetadataSync || shouldPreloadForceIndexStatuses) {
        const identities = await ensureLocalNoteIdentitiesBatchCooperative({
          notebookId,
          relativePaths: incrementalPreloadPaths,
          batchSize: identityBatchSize,
        })
        for (const relativePath of incrementalPreloadPaths) {
          const noteUid = parseRequiredLocalNoteUidInput(identities.get(relativePath)?.note_uid)
          noteUidByPath.set(relativePath, noteUid || null)
        }
      }
      let preloadedIncrementalStatusByNoteId = new Map<string, NoteIndexStatus>()
      if (shouldPreloadForceIndexStatuses) {
        const preloadedIncrementalStatusIds = Array.from(new Set(incrementalPreloadPaths.map((relativePath) => (
          resolveIndexedLocalId(notebookId, relativePath, noteUidByPath.get(relativePath) || null)
        ))))
        try {
          preloadedIncrementalStatusByNoteId = await getNoteIndexStatusBatchCooperative(
            preloadedIncrementalStatusIds,
            { batchSize: statusPreloadBatchSize }
          )
          summary.preloadedStatusCount = preloadedIncrementalStatusByNoteId.size
        } catch (error) {
          console.warn('[LocalIndex] Failed to preload local index statuses for incremental sync:', notebookId, error)
        }
      }
      const pendingTagMetadataSync: Array<{ relativePath: string; tiptapContent: string }> = []
      const pendingPopupRefsSync: Array<{ noteUid: string | null; tiptapContent: string }> = []
      const handleIncrementalFileReadFailure = (
        relativePath: string,
        errorCode: string,
        options?: { noteUid?: string | null }
      ): void => {
        const previousIdentityUid = parseRequiredLocalNoteUidInput(options?.noteUid) || noteUidByPath.get(relativePath) || parseRequiredLocalNoteUidInput(
          getLocalNoteIdentityByPath({
            notebook_id: notebookId,
            relative_path: relativePath,
          }, { repairIfNeeded: false })?.note_uid
        )
        cleanupLocalPathAfterReadFailure(relativePath, errorCode, { noteUid: previousIdentityUid || null })
      }
      const flushPendingMetadataAndPopupSync = (): void => {
        if (!shouldBatchMetadataSync || pendingTagMetadataSync.length === 0) return
        const tagBatch = pendingTagMetadataSync.splice(0, pendingTagMetadataSync.length)
        const popupBatch = pendingPopupRefsSync.splice(0, pendingPopupRefsSync.length)
        try {
          syncLocalNoteTagsMetadataBatch({
            notebookId,
            updates: tagBatch,
          })
        } catch (error) {
          console.warn('[LocalIndex] Failed to batch sync local tags metadata:', notebookId, error)
        }
        try {
          syncLocalNotePopupRefsBatch({
            updates: popupBatch,
          })
        } catch (error) {
          console.warn('[LocalIndex] Failed to batch sync local popup refs:', notebookId, error)
        }
      }
      let processedPathCount = 0
      for (let idx = 0; idx < incrementalPaths.length; idx += 1) {
        const hitCountCap = maxIndexPerRun > 0 && processedPathCount >= maxIndexPerRun
        const hitTimeBudget = hasExceededLocalNoteIndexSyncRunTimeBudget(startedAt, processedPathCount)
        if (
          hitCountCap
          || hitTimeBudget
        ) {
          if (isCancelled()) {
            flushPendingMetadataAndPopupSync()
            return
          }
          if (hitTimeBudget) {
            summary.timeBudgetHit = true
          }
          flushPendingMetadataAndPopupSync()
          const remainingPaths = incrementalPaths.slice(idx)
          if (remainingPaths.length > 0) {
            const remainingKnownFileMtimeMsByPath: Array<readonly [string, number]> = []
            for (const path of remainingPaths) {
              const knownMtimeMs = request.knownFileMtimeMsByPath.get(path)
              if (Number.isFinite(knownMtimeMs)) {
                remainingKnownFileMtimeMsByPath.push([path, Number(knownMtimeMs)])
              }
            }
            summary.requeuedPathCount = remainingPaths.length
            enqueueLocalNotebookIndexSync(notebookId, {
              changedRelativePaths: remainingPaths,
              knownFileMtimeMsByPath: remainingKnownFileMtimeMsByPath,
              forceIndexForPaths: request.forceIndexForPaths,
              immediate: true,
            })
          }
          break
        }
        const relativePath = incrementalPaths[idx]
        processedPathCount += 1
        if (isCancelled()) {
          flushPendingMetadataAndPopupSync()
          return
        }
        let noteUid = noteUidByPath.get(relativePath) || null
        let localIdForForceIndex: string | null = null
        let existingStatusForForceIndex: NoteIndexStatus | null = null
        if (request.forceIndexForPaths) {
          if (!noteUid) {
            noteUid = ensureLocalNoteUidForPath(relativePath)
            noteUidByPath.set(relativePath, noteUid)
          }
          localIdForForceIndex = resolveIndexedLocalId(notebookId, relativePath, noteUid)
          existingStatusForForceIndex = preloadedIncrementalStatusByNoteId.get(localIdForForceIndex) || null
          const knownFileMtimeMs = request.knownFileMtimeMsByPath.get(relativePath)
          if (Number.isFinite(knownFileMtimeMs)) {
            if (shouldSkipFullSyncIndexByMtime(existingStatusForForceIndex, Number(knownFileMtimeMs))) {
              summary.skippedByMtimeCount += 1
              await yieldEvery(processedPathCount)
              continue
            }
            if (
              localIdForForceIndex
              && tryBackfillIndexedStatusMtimeWithoutReindex(
                localIdForForceIndex,
                existingStatusForForceIndex,
                Number(knownFileMtimeMs)
              )
            ) {
              summary.skippedByMtimeCount += 1
              summary.backfilledMtimeCount += 1
              await yieldEvery(processedPathCount)
              continue
            }
          } else if (existingStatusForForceIndex) {
            const statResult = await statLocalFolderFileAsync(mount, relativePath)
            if (!statResult.success) {
              handleIncrementalFileReadFailure(relativePath, statResult.errorCode, { noteUid })
              await yieldEvery(processedPathCount)
              continue
            }
            if (shouldSkipFullSyncIndexByMtime(existingStatusForForceIndex, statResult.result.mtime_ms)) {
              summary.skippedByMtimeCount += 1
              await yieldEvery(processedPathCount)
              continue
            }
            if (
              localIdForForceIndex
              && tryBackfillIndexedStatusMtimeWithoutReindex(
                localIdForForceIndex,
                existingStatusForForceIndex,
                statResult.result.mtime_ms
              )
            ) {
              summary.skippedByMtimeCount += 1
              summary.backfilledMtimeCount += 1
              await yieldEvery(processedPathCount)
              continue
            }
          }
        }
        const readResult = await readLocalFolderFileAsync(mount, relativePath)
        if (!readResult.success) {
          handleIncrementalFileReadFailure(relativePath, readResult.errorCode, { noteUid })
          await yieldEvery(processedPathCount)
          continue
        }
        if (!noteUid) {
          noteUid = ensureLocalNoteUidForPath(relativePath)
          noteUidByPath.set(relativePath, noteUid)
        }
        if (shouldBatchMetadataSync) {
          pendingTagMetadataSync.push({
            relativePath,
            tiptapContent: readResult.result.tiptap_content,
          })
          pendingPopupRefsSync.push({
            noteUid,
            tiptapContent: readResult.result.tiptap_content,
          })
          if (pendingTagMetadataSync.length >= LOCAL_NOTE_INDEX_SYNC_METADATA_BATCH_SIZE) {
            flushPendingMetadataAndPopupSync()
          }
        } else {
          try {
            syncLocalNoteTagsMetadata(notebookId, relativePath, readResult.result.tiptap_content)
          } catch (error) {
            console.warn('[LocalIndex] Failed to sync local tags metadata:', notebookId, relativePath, error)
          }
          try {
            syncLocalNotePopupRefs(notebookId, relativePath, readResult.result.tiptap_content, { noteUid })
          } catch (error) {
            console.warn('[LocalIndex] Failed to sync local popup refs:', notebookId, relativePath, error)
          }
        }
        if (request.forceIndexForPaths) {
          const localId = localIdForForceIndex || resolveIndexedLocalId(notebookId, relativePath, noteUid)
          const existingStatus = existingStatusForForceIndex || preloadedIncrementalStatusByNoteId.get(localId)
          if (shouldSkipFullSyncIndexByMtime(existingStatus, readResult.result.mtime_ms)) {
            summary.skippedByMtimeCount += 1
            await yieldEvery(processedPathCount)
            continue
          }
          try {
            await indexingService.checkAndIndex(
              localId,
              notebookId,
              readResult.result.tiptap_content,
              {
                ftsOnly: true,
                fileMtimeMs: readResult.result.mtime_ms,
                existingStatus: existingStatus || null,
              }
            )
            summary.indexedCount += 1
            if (isCancelled()) {
              flushPendingMetadataAndPopupSync()
              deleteIndexForLocalPath(notebookId, relativePath, { noteUid })
              return
            }
          } catch (error) {
            console.warn('[LocalIndex] Failed to check index for local file:', localId, error)
          }
        }
        await yieldEvery(processedPathCount)
      }
      flushPendingMetadataAndPopupSync()
      return
    }

    let scannedTree: LocalFolderTreeResult
    const cachedTree = LOCAL_NOTE_INDEX_SYNC_SCAN_CACHE_MAX_AGE_MS > 0
      ? getCachedLocalFolderTree(notebookId, LOCAL_NOTE_INDEX_SYNC_SCAN_CACHE_MAX_AGE_MS)
      : null
    if (cachedTree && isLocalFolderTreeRootMatched(cachedTree, mount.mount)) {
      summary.scanCacheHit = true
      scannedTree = cachedTree
    } else {
      if (cachedTree) {
        try {
          invalidateLocalFolderTreeCache(notebookId)
        } catch (invalidateError) {
          console.warn(
            '[LocalIndex] Failed to invalidate stale local tree cache before full scan:',
            notebookId,
            invalidateError
          )
        }
      }
      try {
        // Index sync does not need preview text or tree structure; use lightweight file scan.
        scannedTree = await scanLocalFolderMountForSearchAsync(mount, { sortEntries: false })
      } catch (error) {
        summary.scanFailed = true
        console.warn('[LocalIndex] Failed to scan local mount for indexing sync:', notebookId, error)
        return
      }
    }

    const indexedLocalIds = collectIndexedLocalNoteIdsByNotebook(notebookId)
    const fileByRelativePath = new Map<string, LocalFolderTreeResult['files'][number]>()
    const ensuredIdentityByPath = new Map<string, string>()
    const currentLocalIds = new Set<string>()
    let scannedFileCount = 0

    for (const file of scannedTree.files) {
      if (isCancelled()) return
      const normalizedPath = normalizeLocalIndexSyncPath(file.relative_path)
      if (!normalizedPath) continue
      fileByRelativePath.set(normalizedPath, file)
      scannedFileCount += 1
      summary.scannedFileCount = scannedFileCount
      await yieldEvery(scannedFileCount)
    }

    let existingIdentities: ReturnType<typeof listLocalNoteIdentity> = []
    let shouldFallbackEnsureIdentities = false
    try {
      existingIdentities = listLocalNoteIdentity(
        { notebookIds: [notebookId] },
        { repairIfNeeded: false }
      )
    } catch (error) {
      shouldFallbackEnsureIdentities = true
      console.warn(
        '[LocalIndex] Failed to list local note identities before full sync; fallback to on-demand ensure during index pass:',
        notebookId,
        error
      )
    }
    for (const identity of existingIdentities) {
      const normalizedPath = normalizeLocalIndexSyncPath(identity.relative_path)
      if (!normalizedPath || !fileByRelativePath.has(normalizedPath)) continue
      const noteUid = parseRequiredLocalNoteUidInput(identity.note_uid)
      if (!noteUid) continue
      ensuredIdentityByPath.set(normalizedPath, noteUid)
    }
    if (shouldFallbackEnsureIdentities && fileByRelativePath.size > 0) {
      try {
        const identityByPath = await ensureLocalNoteIdentitiesBatchCooperative({
          notebookId,
          relativePaths: Array.from(fileByRelativePath.keys()),
          batchSize: identityBatchSize,
        })
        for (const [relativePath, identity] of identityByPath.entries()) {
          const noteUid = parseRequiredLocalNoteUidInput(identity?.note_uid)
          if (!noteUid) continue
          ensuredIdentityByPath.set(relativePath, noteUid)
        }
      } catch (fallbackError) {
        console.warn(
          '[LocalIndex] Failed to fallback ensure local note identities after identity list failure; continuing with per-path ensure during index pass:',
          notebookId,
          fallbackError
        )
      }
    }
    for (const relativePath of fileByRelativePath.keys()) {
      const noteUid = ensuredIdentityByPath.get(relativePath) || null
      currentLocalIds.add(
        resolveIndexedLocalId(notebookId, relativePath, noteUid)
      )
    }

    cleanupMissingLocalNoteState(
      notebookId,
      new Set(fileByRelativePath.keys()),
      normalizeLocalIndexSyncPath
    )

    const staleIndexedIds: string[] = []
    for (const indexedId of indexedLocalIds) {
      if (currentLocalIds.has(indexedId)) continue
      staleIndexedIds.push(indexedId)
    }
    let staleDeleteCount = 0
    let staleDeleteOffset = 0
    while (staleDeleteOffset < staleIndexedIds.length) {
      if (isCancelled()) return
      const hitTimeBudget = hasExceededLocalNoteIndexSyncRunTimeBudget(startedAt, staleDeleteCount)
      if (hitTimeBudget) {
        summary.timeBudgetHit = true
        break
      }

      const remainingDeleteBudget = maxStaleDeletePerRun > 0
        ? maxStaleDeletePerRun - staleDeleteCount
        : Number.POSITIVE_INFINITY
      if (remainingDeleteBudget <= 0) {
        break
      }

      const budgetChunkSize = Number.isFinite(remainingDeleteBudget)
        ? Math.max(1, Math.floor(remainingDeleteBudget))
        : deleteBatchSize
      const chunkSize = Math.min(
        deleteBatchSize,
        budgetChunkSize,
        staleIndexedIds.length - staleDeleteOffset
      )
      const chunk = staleIndexedIds.slice(staleDeleteOffset, staleDeleteOffset + chunkSize)
      if (chunk.length === 0) break
      if (chunk.length === 1) {
        indexingService.deleteNoteIndex(chunk[0])
      } else if (chunk.length > 1) {
        if (typeof indexingService.deleteNoteIndexes === 'function') {
          indexingService.deleteNoteIndexes(chunk)
        } else {
          for (const noteId of chunk) {
            indexingService.deleteNoteIndex(noteId)
          }
        }
      }
      staleDeleteOffset += chunk.length
      staleDeleteCount += chunk.length
      summary.staleDeleteCount = staleDeleteCount
      await yieldEvery(staleDeleteCount)
    }

    if (staleDeleteOffset < staleIndexedIds.length) {
      summary.requeuedStaleDeleteCount = staleIndexedIds.length - staleDeleteOffset
      enqueueLocalNotebookIndexSync(notebookId, {
        full: true,
        immediate: true,
      })
      // Stale index cleanup is deferred to next run; avoid continuing with full read/index
      // work in the same turn to keep main-process responsiveness predictable.
      return
    }

    const currentIndexedIds: string[] = []
    for (const localId of currentLocalIds) {
      if (indexedLocalIds.has(localId)) {
        currentIndexedIds.push(localId)
      }
    }
    let indexedStatusByNoteId = new Map<string, NoteIndexStatus>()
    try {
      indexedStatusByNoteId = await getNoteIndexStatusBatchCooperative(
        currentIndexedIds,
        { batchSize: statusPreloadBatchSize }
      )
      summary.preloadedStatusCount = indexedStatusByNoteId.size
    } catch (error) {
      console.warn('[LocalIndex] Failed to preload local index statuses for full sync:', notebookId, error)
    }

    const pathsToIndex = new Set<string>()
    let candidatePathCount = 0
    for (const [relativePath, file] of fileByRelativePath.entries()) {
      candidatePathCount += 1
      const noteUid = ensuredIdentityByPath.get(relativePath) || null
      const localId = resolveIndexedLocalId(
        notebookId,
        relativePath,
        noteUid
      )
      const existingStatus = indexedStatusByNoteId.get(localId)
      if (!indexedLocalIds.has(localId)) {
        pathsToIndex.add(relativePath)
      } else if (shouldSkipFullSyncIndexByMtime(existingStatus, file.mtime_ms)) {
        summary.skippedByMtimeCount += 1
      } else if (tryBackfillIndexedStatusMtimeWithoutReindex(localId, existingStatus, file.mtime_ms)) {
        summary.skippedByMtimeCount += 1
        summary.backfilledMtimeCount += 1
      } else {
        pathsToIndex.add(relativePath)
      }
      await yieldEvery(candidatePathCount)
    }

    for (const changedPath of request.paths) {
      if (fileByRelativePath.has(changedPath)) {
        pathsToIndex.add(changedPath)
        continue
      }
      deleteIndexForLocalPath(notebookId, changedPath)
    }

    const pathsToIndexList = Array.from(pathsToIndex)
    summary.candidatePathCount = pathsToIndexList.length

    const pendingTagMetadataSync: Array<{ relativePath: string; tiptapContent: string }> = []
    const pendingPopupRefsSync: Array<{ noteUid: string | null | undefined; tiptapContent: string }> = []
    const flushPendingMetadataAndPopupSync = (): void => {
      const tagBatch = pendingTagMetadataSync.splice(0, pendingTagMetadataSync.length)
      const popupBatch = pendingPopupRefsSync.splice(0, pendingPopupRefsSync.length)

      if (tagBatch.length > 0) {
        try {
          syncLocalNoteTagsMetadataBatch({
            notebookId,
            updates: tagBatch,
          })
        } catch (error) {
          console.warn('[LocalIndex] Failed to batch sync local tags metadata:', notebookId, error)
        }
      }

      if (popupBatch.length > 0) {
        try {
          syncLocalNotePopupRefsBatch({
            updates: popupBatch,
          })
        } catch (error) {
          console.warn('[LocalIndex] Failed to batch sync local popup refs:', notebookId, error)
        }
      }
    }

    let processedIndexPathCount = 0
    for (let idx = 0; idx < pathsToIndexList.length; idx += 1) {
      const hitCountCap = maxIndexPerRun > 0 && processedIndexPathCount >= maxIndexPerRun
      const hitTimeBudget = hasExceededLocalNoteIndexSyncRunTimeBudget(startedAt, processedIndexPathCount)
      if (
        hitCountCap
        || hitTimeBudget
      ) {
        if (isCancelled()) {
          flushPendingMetadataAndPopupSync()
          return
        }
        if (hitTimeBudget) {
          summary.timeBudgetHit = true
        }
        const remainingPaths = pathsToIndexList.slice(idx)
        if (remainingPaths.length > 0) {
          const remainingKnownFileMtimeMsByPath: Array<readonly [string, number]> = []
          for (const path of remainingPaths) {
            const file = fileByRelativePath.get(path)
            if (Number.isFinite(file?.mtime_ms)) {
              remainingKnownFileMtimeMsByPath.push([path, Number(file?.mtime_ms)])
            }
          }
          summary.requeuedPathCount = remainingPaths.length
          enqueueLocalNotebookIndexSync(notebookId, {
            changedRelativePaths: remainingPaths,
            knownFileMtimeMsByPath: remainingKnownFileMtimeMsByPath,
            forceIndexForPaths: true,
            immediate: true,
          })
        }
        break
      }

      const relativePath = pathsToIndexList[idx]
      processedIndexPathCount += 1
      if (isCancelled()) {
        flushPendingMetadataAndPopupSync()
        return
      }
      let noteUid = ensuredIdentityByPath.get(relativePath) || null
      if (!noteUid) {
        noteUid = ensureLocalNoteUidForPath(relativePath)
        if (noteUid) {
          ensuredIdentityByPath.set(relativePath, noteUid)
          const pathBasedLocalId = resolveLocalIndexNoteId(notebookId, relativePath)
          if (pathBasedLocalId !== noteUid && indexedLocalIds.has(pathBasedLocalId)) {
            indexingService.deleteNoteIndex(pathBasedLocalId)
            indexedLocalIds.delete(pathBasedLocalId)
          }
        }
      }
      const localId = resolveIndexedLocalId(
        notebookId,
        relativePath,
        noteUid
      )
      const existingStatus = indexedStatusByNoteId.get(localId)
      const readResult = await readLocalFolderFileAsync(mount, relativePath)
      if (!readResult.success) {
        cleanupLocalPathAfterReadFailure(relativePath, readResult.errorCode, { noteUid })
        await yieldEvery(processedIndexPathCount)
        continue
      }
      pendingTagMetadataSync.push({
        relativePath,
        tiptapContent: readResult.result.tiptap_content,
      })
      pendingPopupRefsSync.push({
        noteUid,
        tiptapContent: readResult.result.tiptap_content,
      })
      if (pendingTagMetadataSync.length >= LOCAL_NOTE_INDEX_SYNC_METADATA_BATCH_SIZE) {
        flushPendingMetadataAndPopupSync()
      }
      try {
        await indexingService.checkAndIndex(
          localId,
          notebookId,
          readResult.result.tiptap_content,
          {
            ftsOnly: true,
            fileMtimeMs: readResult.result.mtime_ms,
            existingStatus: existingStatus || null,
          }
        )
        summary.indexedCount += 1
        if (isCancelled()) {
          flushPendingMetadataAndPopupSync()
          deleteIndexForLocalPath(notebookId, relativePath, { noteUid })
          return
        }
      } catch (error) {
        console.warn('[LocalIndex] Failed to check index for local file:', localId, error)
      }
      await yieldEvery(processedIndexPathCount)
    }
    flushPendingMetadataAndPopupSync()
  } finally {
    maybeLogLocalNotebookIndexSyncSummary(
      notebookId,
      summary,
      Date.now() - startedAt,
      startupState,
      maxIndexPerRun,
      coldFullSync,
      {
        effectiveIdentityBatchSize: identityBatchSize,
        effectiveStatusPreloadBatchSize: statusPreloadBatchSize,
        effectiveDeleteBatchSize: deleteBatchSize,
        effectiveMaxStaleDeletePerRun: maxStaleDeletePerRun,
      }
    )
  }
}

function scheduleLocalNotebookIndexSync(notebookId: string, immediate = false): void {
  if (isKnowledgeBaseRebuilding()) return

  const existingTimer = localNotebookIndexSyncTimers.get(notebookId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    localNotebookIndexSyncTimers.delete(notebookId)
  }

  let delayMs = LOCAL_NOTE_INDEX_SYNC_DEBOUNCE_MS
  if (immediate) {
    delayMs = 0
    const queued = localNotebookIndexSyncRequests.get(notebookId)
    if (queued) {
      const isInitialFullSync = queued.full && !queued.forceIndexForPaths && queued.paths.size === 0
      const isRequeuedBatch = queued.forceIndexForPaths && queued.paths.size > 0
      if (isInitialFullSync) {
        delayMs = LOCAL_NOTE_INDEX_SYNC_INITIAL_FULL_DELAY_MS
      } else if (isRequeuedBatch) {
        delayMs = LOCAL_NOTE_INDEX_SYNC_REQUEUE_DELAY_MS
      }
      if (LOCAL_NOTE_INDEX_SYNC_STARTUP_DELAY_ADAPTIVE_ENABLED) {
        const startupState = getStartupPhaseState()
        if (startupState.inStartupPhase) {
          if (isInitialFullSync) {
            delayMs = Math.max(delayMs, LOCAL_NOTE_INDEX_SYNC_STARTUP_INITIAL_FULL_DELAY_MS)
          } else if (isRequeuedBatch) {
            delayMs = Math.max(delayMs, LOCAL_NOTE_INDEX_SYNC_STARTUP_REQUEUE_DELAY_MS)
          }
        }
      }
    }
  }

  const timer = setTimeout(() => {
    localNotebookIndexSyncTimers.delete(notebookId)
    void runQueuedLocalNotebookIndexSync(notebookId)
  }, delayMs)
  localNotebookIndexSyncTimers.set(notebookId, timer)
}

function runQueuedLocalNotebookIndexSync(notebookId: string): void {
  if (localNotebookIndexSyncRunning.has(notebookId)) return
  const queued = localNotebookIndexSyncRequests.get(notebookId)
  if (!queued) return

  localNotebookIndexSyncRequests.delete(notebookId)
  localNotebookIndexSyncRunning.add(notebookId)
  localNotebookIndexSyncRunningRequests.set(notebookId, {
    full: queued.full,
    forceIndexForPaths: queued.forceIndexForPaths,
    paths: new Set(queued.paths),
    knownFileMtimeMsByPath: new Map(queued.knownFileMtimeMsByPath),
  })
  const runGeneration = localNotebookIndexSyncGeneration
  const runCancelEpoch = getLocalNotebookIndexSyncCancelEpoch(notebookId)

  const run = async () => {
    try {
      await syncLocalNotebookIndex(notebookId, queued, runGeneration, runCancelEpoch)
    } catch (error) {
      console.warn('[LocalIndex] Failed to sync local notebook index:', notebookId, error)
    } finally {
      localNotebookIndexSyncRunning.delete(notebookId)
      localNotebookIndexSyncRunningRequests.delete(notebookId)
      if (localNotebookIndexSyncRequests.has(notebookId)) {
        scheduleLocalNotebookIndexSync(notebookId, true)
      } else {
        localNotebookIndexSyncCancelEpochByNotebook.delete(notebookId)
      }
    }
  }

  localNotebookIndexSyncSequence = localNotebookIndexSyncSequence
    .catch(() => undefined)
    .then(run)
}

export function enqueueLocalNotebookIndexSync(
  notebookId: string,
  options?: {
    full?: boolean
    changedRelativePath?: string | null
    changedRelativePaths?: Iterable<string>
    knownFileMtimeMsByPath?: Iterable<readonly [string, number]>
    forceIndexForPaths?: boolean
    immediate?: boolean
  }
): void {
  const parsedNotebookId = parseRequiredNotebookIdInput(notebookId)
  if (!parsedNotebookId) return

  const existing = localNotebookIndexSyncRequests.get(parsedNotebookId) || {
    full: false,
    forceIndexForPaths: false,
    paths: new Set<string>(),
    knownFileMtimeMsByPath: new Map<string, number>(),
  }

  if (options?.full) {
    existing.full = true
    // Full sync supersedes any queued incremental deltas.
    existing.forceIndexForPaths = false
    existing.paths.clear()
    existing.knownFileMtimeMsByPath.clear()
  }
  const acceptsDeltaPaths = !existing.full
  if (acceptsDeltaPaths && options?.forceIndexForPaths) {
    existing.forceIndexForPaths = true
  }
  const knownFileMtimeMsByPath = new Map<string, number>()
  if (acceptsDeltaPaths && options?.knownFileMtimeMsByPath) {
    for (const [rawPath, rawMtimeMs] of options.knownFileMtimeMsByPath) {
      const normalizedPath = normalizeLocalIndexSyncPath(rawPath)
      if (!normalizedPath) continue
      const numericMtimeMs = Number(rawMtimeMs)
      if (!Number.isFinite(numericMtimeMs)) continue
      knownFileMtimeMsByPath.set(normalizedPath, numericMtimeMs)
    }
  }
  const applyChangedPath = (normalizedPath: string): void => {
    existing.paths.add(normalizedPath)
    const knownMtimeMs = knownFileMtimeMsByPath.get(normalizedPath)
    if (knownMtimeMs === undefined) {
      existing.knownFileMtimeMsByPath.delete(normalizedPath)
      return
    }
    existing.knownFileMtimeMsByPath.set(normalizedPath, knownMtimeMs)
  }
  const changedRelativePath = normalizeLocalIndexSyncPath(options?.changedRelativePath)
  if (acceptsDeltaPaths && changedRelativePath) {
    applyChangedPath(changedRelativePath)
  }
  if (acceptsDeltaPaths && options?.changedRelativePaths) {
    for (const path of options.changedRelativePaths) {
      const normalizedPath = normalizeLocalIndexSyncPath(path)
      if (!normalizedPath) continue
      applyChangedPath(normalizedPath)
    }
  }

  localNotebookIndexSyncRequests.set(parsedNotebookId, existing)
  scheduleLocalNotebookIndexSync(parsedNotebookId, options?.immediate === true)
}

export function flushQueuedLocalNotebookIndexSync(): void {
  if (isKnowledgeBaseRebuilding()) return
  for (const notebookId of localNotebookIndexSyncRequests.keys()) {
    scheduleLocalNotebookIndexSync(notebookId, true)
  }
}

export async function rebuildLocalNotebookIndexesAfterInternalRebuild(): Promise<void> {
  const runGeneration = localNotebookIndexSyncGeneration
  const mounts = getLocalFolderMounts()

  localNotebookIndexSyncRebuildRunning += 1
  try {
    for (const mount of mounts) {
      if (isLocalNotebookIndexSyncCancelled(runGeneration)) return
      const notebookId = mount.notebook.id
      localNotebookIndexSyncRebuildRunningByNotebook.set(
        notebookId,
        (localNotebookIndexSyncRebuildRunningByNotebook.get(notebookId) || 0) + 1
      )
      try {
        const runCancelEpoch = getLocalNotebookIndexSyncCancelEpoch(notebookId)
        await syncLocalNotebookIndex(
          notebookId,
          { full: true, forceIndexForPaths: false, paths: new Set<string>(), knownFileMtimeMsByPath: new Map<string, number>() },
          runGeneration,
          runCancelEpoch
        )
      } finally {
        const remaining = (localNotebookIndexSyncRebuildRunningByNotebook.get(notebookId) || 0) - 1
        if (remaining > 0) {
          localNotebookIndexSyncRebuildRunningByNotebook.set(notebookId, remaining)
        } else {
          localNotebookIndexSyncRebuildRunningByNotebook.delete(notebookId)
        }
      }
    }
  } finally {
    localNotebookIndexSyncRebuildRunning = Math.max(0, localNotebookIndexSyncRebuildRunning - 1)
  }
}

export function hasPendingIndexSync(): boolean {
  return (
    localNotebookIndexSyncRebuildRunning > 0
    || localNotebookIndexSyncRunning.size > 0
    || localNotebookIndexSyncRequests.size > 0
    || localNotebookIndexSyncTimers.size > 0
  )
}

export function hasPendingFullIndexSyncForNotebook(notebookId: string): boolean {
  const parsedNotebookId = parseRequiredNotebookIdInput(notebookId)
  if (!parsedNotebookId) return false

  if ((localNotebookIndexSyncRebuildRunningByNotebook.get(parsedNotebookId) || 0) > 0) {
    return true
  }

  const queued = localNotebookIndexSyncRequests.get(parsedNotebookId)
  if (queued?.full) return true

  const running = localNotebookIndexSyncRunningRequests.get(parsedNotebookId)
  if (running?.full) return true

  return false
}

export function clearLocalNotebookIndexSyncForNotebook(notebookId: string): void {
  const parsedNotebookId = parseRequiredNotebookIdInput(notebookId)
  if (!parsedNotebookId) return
  const hasRunning = (
    localNotebookIndexSyncRunning.has(parsedNotebookId)
    || localNotebookIndexSyncRunningRequests.has(parsedNotebookId)
    || (localNotebookIndexSyncRebuildRunningByNotebook.get(parsedNotebookId) || 0) > 0
  )
  if (hasRunning) {
    bumpLocalNotebookIndexSyncCancelEpoch(parsedNotebookId)
  } else {
    localNotebookIndexSyncCancelEpochByNotebook.delete(parsedNotebookId)
  }
  localNotebookIndexSyncRequests.delete(parsedNotebookId)
  const timer = localNotebookIndexSyncTimers.get(parsedNotebookId)
  if (timer) {
    clearTimeout(timer)
    localNotebookIndexSyncTimers.delete(parsedNotebookId)
  }
}

export function resetLocalNotebookIndexSyncState(): void {
  localNotebookIndexSyncGeneration += 1
  for (const timer of localNotebookIndexSyncTimers.values()) {
    clearTimeout(timer)
  }
  localNotebookIndexSyncTimers.clear()
  localNotebookIndexSyncRequests.clear()
  localNotebookIndexSyncRunning.clear()
  localNotebookIndexSyncRunningRequests.clear()
  localNotebookIndexSyncCancelEpochByNotebook.clear()
  localNotebookIndexSyncRebuildRunningByNotebook.clear()
  localNotebookIndexSyncRebuildRunning = 0
  localNotebookIndexSyncSequence = Promise.resolve()
}
