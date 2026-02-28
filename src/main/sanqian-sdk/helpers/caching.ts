/**
 * Cache infrastructure for local folder context, scan, and overview data.
 *
 * Three independent caches with LRU eviction and TTL expiration:
 * - localContextListCache: context list items for chat panel notes list
 * - localFolderScanCache: directory scan results per mount
 * - localOverviewSummaryCache: overview summary (file count + recent items) per mount
 */

import { join } from 'path'
import {
  getLocalFolderMounts,
  getLocalNoteIdentityByUid,
} from '../../database'
import {
  scanLocalFolderMount,
} from '../../local-folder'
import {
  buildCanonicalLocalResourceId,
} from '../../note-gateway'
import {
  getLocalResourceFileTitle,
  isLocalResourceUidRef,
  parseLocalResourceId,
  type LocalResourceRef,
} from '../../../shared/local-resource-id'
import { normalizeComparablePathForFileSystem, toSlashPath } from '../../path-compat'

// --- Types ---

export type LocalFolderMount = ReturnType<typeof getLocalFolderMounts>[number]

export interface LocalContextSourceItem {
  id: string
  title: string
  summary: string
  notebookId: string
  updatedAt: string
}

interface LocalContextCacheEntry {
  expiresAtMs: number
  items: LocalContextSourceItem[]
}

interface LocalScanCacheEntry {
  expiresAtMs: number
  rootPath: string
  scanned: ReturnType<typeof scanLocalFolderMount>
}

export interface LocalOverviewRecentItem {
  id: string
  title: string
  notebookId: string
  relativePath: string
  updatedAt: string
  mtimeMs: number
  canonicalPath: string
}

interface LocalOverviewSummaryCacheEntry {
  expiresAtMs: number
  rootPath: string
  fileCount: number
  recentItems: LocalOverviewRecentItem[]
}

// --- Constants ---

export const SEARCH_NOTES_PAGE_LIMIT = 100
const LOCAL_CONTEXT_CACHE_MAX_ENTRIES = 128
export const LOCAL_CONTEXT_QUERY_CACHE_TTL_MS = 800
export const LOCAL_CONTEXT_BROWSE_CACHE_TTL_MS = 2000
const LOCAL_SCAN_CACHE_TTL_MS = (() => {
  const raw = Number.parseInt(process.env.SANQIAN_LOCAL_CONTEXT_SCAN_CACHE_TTL_MS || '', 10)
  if (!Number.isFinite(raw)) return 10_000
  return Math.min(120_000, Math.max(1_200, raw))
})()
const LOCAL_OVERVIEW_SUMMARY_CACHE_TTL_MS = 15_000
export const LOCAL_OVERVIEW_RECENT_PER_MOUNT_MIN = 3
const LOCAL_OVERVIEW_RECENT_PER_MOUNT_MAX = 16
const LOCAL_FOLDER_SCAN_CACHE_MAX_ENTRIES = 64
const LOCAL_OVERVIEW_SUMMARY_CACHE_MAX_ENTRIES = 64

// --- Cache state ---

const localContextListCache = new Map<string, LocalContextCacheEntry>()
const localFolderScanCache = new Map<string, LocalScanCacheEntry>()
const localOverviewSummaryCache = new Map<string, LocalOverviewSummaryCacheEntry>()

// --- Context list cache ---

export function normalizeContextQuery(query: string | undefined): string {
  return query?.trim() || ''
}

function buildLocalContextMountsCacheSignature(
  mounts: ReturnType<typeof getLocalFolderMounts>
): string {
  return mounts
    .map((mount) => [
      mount.notebook.id,
      mount.mount.canonical_root_path,
      mount.mount.updated_at,
      mount.mount.status,
    ].join('|'))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .join('\n')
}

export function buildLocalContextCacheKey(
  mounts: ReturnType<typeof getLocalFolderMounts>,
  query: string
): string {
  const signature = buildLocalContextMountsCacheSignature(mounts)
  return `${query}\n${signature}`
}

function enforceLocalContextCacheLimit(): void {
  while (localContextListCache.size > LOCAL_CONTEXT_CACHE_MAX_ENTRIES) {
    const oldestKey = localContextListCache.keys().next().value as string | undefined
    if (!oldestKey) return
    localContextListCache.delete(oldestKey)
  }
}

export function getCachedLocalContextSourceItems(cacheKey: string): LocalContextSourceItem[] | null {
  const cached = localContextListCache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAtMs <= Date.now()) {
    localContextListCache.delete(cacheKey)
    return null
  }
  // Refresh insertion order to keep hot keys in cache.
  localContextListCache.delete(cacheKey)
  localContextListCache.set(cacheKey, cached)
  return cached.items
}

export function setCachedLocalContextSourceItems(
  cacheKey: string,
  items: LocalContextSourceItem[],
  ttlMs: number
): void {
  localContextListCache.set(cacheKey, {
    expiresAtMs: Date.now() + Math.max(0, ttlMs),
    items,
  })
  enforceLocalContextCacheLimit()
}

// --- Scan cache ---

export function pruneLocalFolderScanCache(mounts: ReturnType<typeof getLocalFolderMounts>): void {
  const activeNotebookIds = new Set(mounts.map((mount) => mount.notebook.id))
  for (const notebookId of localFolderScanCache.keys()) {
    if (!activeNotebookIds.has(notebookId)) {
      localFolderScanCache.delete(notebookId)
    }
  }
}

function getCachedLocalFolderScan(mount: LocalFolderMount): ReturnType<typeof scanLocalFolderMount> | null {
  const cached = localFolderScanCache.get(mount.notebook.id)
  if (!cached) return null
  if (cached.rootPath !== mount.mount.root_path || cached.expiresAtMs <= Date.now()) {
    localFolderScanCache.delete(mount.notebook.id)
    return null
  }
  return cached.scanned
}

function setCachedLocalFolderScan(
  mount: LocalFolderMount,
  scanned: ReturnType<typeof scanLocalFolderMount>
): void {
  if (localFolderScanCache.size >= LOCAL_FOLDER_SCAN_CACHE_MAX_ENTRIES) {
    const oldestKey = localFolderScanCache.keys().next().value as string | undefined
    if (oldestKey) localFolderScanCache.delete(oldestKey)
  }
  localFolderScanCache.set(mount.notebook.id, {
    expiresAtMs: Date.now() + LOCAL_SCAN_CACHE_TTL_MS,
    rootPath: mount.mount.root_path,
    scanned,
  })
}

export function getLocalFolderScanWithCache(
  mount: LocalFolderMount
): ReturnType<typeof scanLocalFolderMount> {
  const cached = getCachedLocalFolderScan(mount)
  if (cached) return cached
  const scanned = scanLocalFolderMount(mount)
  setCachedLocalFolderScan(mount, scanned)
  return scanned
}

// --- Overview summary cache ---

export function pruneLocalOverviewSummaryCache(mounts: ReturnType<typeof getLocalFolderMounts>): void {
  const activeNotebookIds = new Set(mounts.map((mount) => mount.notebook.id))
  for (const notebookId of localOverviewSummaryCache.keys()) {
    if (!activeNotebookIds.has(notebookId)) {
      localOverviewSummaryCache.delete(notebookId)
    }
  }
}

function getCachedLocalOverviewSummary(
  mount: LocalFolderMount
): LocalOverviewSummaryCacheEntry | null {
  const cached = localOverviewSummaryCache.get(mount.notebook.id)
  if (!cached) return null
  if (cached.rootPath !== mount.mount.root_path || cached.expiresAtMs <= Date.now()) {
    localOverviewSummaryCache.delete(mount.notebook.id)
    return null
  }
  return cached
}

function setCachedLocalOverviewSummary(
  mount: LocalFolderMount,
  summary: {
    fileCount: number
    recentItems: LocalOverviewRecentItem[]
  }
): LocalOverviewSummaryCacheEntry {
  const entry: LocalOverviewSummaryCacheEntry = {
    expiresAtMs: Date.now() + LOCAL_OVERVIEW_SUMMARY_CACHE_TTL_MS,
    rootPath: mount.mount.root_path,
    fileCount: summary.fileCount,
    recentItems: summary.recentItems,
  }
  if (localOverviewSummaryCache.size >= LOCAL_OVERVIEW_SUMMARY_CACHE_MAX_ENTRIES) {
    const oldestKey = localOverviewSummaryCache.keys().next().value as string | undefined
    if (oldestKey) localOverviewSummaryCache.delete(oldestKey)
  }
  localOverviewSummaryCache.set(mount.notebook.id, entry)
  return entry
}

// --- Derived helpers ---

export function buildLocalCanonicalPath(canonicalRootPath: string, relativePath: string): string {
  return toSlashPath(
    normalizeComparablePathForFileSystem(join(canonicalRootPath, relativePath), canonicalRootPath)
  )
}

export function clampPerMountRecentLimit(totalMounts: number, globalLimitHint: number): number {
  const safeMounts = Math.max(1, totalMounts)
  const safeHint = Number.isFinite(globalLimitHint) ? Math.max(0, Math.trunc(globalLimitHint)) : 0
  if (safeHint <= 0) {
    return LOCAL_OVERVIEW_RECENT_PER_MOUNT_MIN
  }
  const suggested = Math.ceil(safeHint / safeMounts) + 2
  return Math.min(
    LOCAL_OVERVIEW_RECENT_PER_MOUNT_MAX,
    Math.max(LOCAL_OVERVIEW_RECENT_PER_MOUNT_MIN, suggested)
  )
}

export function resolveLocalRefRelativePath(localRef: LocalResourceRef): string | null {
  if (isLocalResourceUidRef(localRef) && localRef.noteUid) {
    const identity = getLocalNoteIdentityByUid({
      note_uid: localRef.noteUid,
      notebook_id: localRef.notebookId,
    })
    return identity?.relative_path || null
  }
  return localRef.relativePath || null
}

export function resolveLocalNotebookIdFromAnyId(id: string): string | null {
  const localRef = parseLocalResourceId(id)
  if (localRef) return localRef.notebookId
  const identity = getLocalNoteIdentityByUid({ note_uid: id })
  return identity?.notebook_id || null
}

export function resolveLocalPathFromAnyId(id: string): { notebookId: string; relativePath: string } | null {
  const localRef = parseLocalResourceId(id)
  if (localRef) {
    const relativePath = resolveLocalRefRelativePath(localRef)
    if (!relativePath) return null
    return {
      notebookId: localRef.notebookId,
      relativePath,
    }
  }

  const identity = getLocalNoteIdentityByUid({ note_uid: id })
  if (!identity) return null
  return {
    notebookId: identity.notebook_id,
    relativePath: identity.relative_path,
  }
}

function summarizeLocalOverviewFromScan(
  mount: LocalFolderMount,
  scanned: ReturnType<typeof scanLocalFolderMount>,
  perMountRecentLimit: number
): {
  fileCount: number
  recentItems: LocalOverviewRecentItem[]
} {
  const sorted = [...scanned.files].sort((a, b) => {
    if (a.mtime_ms !== b.mtime_ms) return b.mtime_ms - a.mtime_ms
    return a.relative_path.localeCompare(b.relative_path, undefined, { sensitivity: 'base', numeric: true })
  })

  return {
    fileCount: scanned.files.length,
    recentItems: sorted.slice(0, perMountRecentLimit).map((file) => ({
      id: buildCanonicalLocalResourceId({ notebookId: mount.notebook.id, relativePath: file.relative_path }),
      title: file.name || getLocalResourceFileTitle(file.relative_path),
      notebookId: mount.notebook.id,
      relativePath: file.relative_path,
      updatedAt: new Date(file.mtime_ms).toISOString(),
      mtimeMs: file.mtime_ms,
      canonicalPath: buildLocalCanonicalPath(mount.mount.canonical_root_path, file.relative_path),
    })),
  }
}

export function getLocalOverviewSummaryForMount(
  mount: LocalFolderMount,
  perMountRecentLimit: number
): { fileCount: number; recentItems: LocalOverviewRecentItem[] } | null {
  const cached = getCachedLocalOverviewSummary(mount)
  if (cached && cached.recentItems.length >= perMountRecentLimit) {
    return cached
  }

  try {
    const scanned = getLocalFolderScanWithCache(mount)
    const summary = summarizeLocalOverviewFromScan(mount, scanned, perMountRecentLimit)
    return setCachedLocalOverviewSummary(mount, summary)
  } catch (error) {
    localFolderScanCache.delete(mount.notebook.id)
    localOverviewSummaryCache.delete(mount.notebook.id)
    console.warn(
      '[SanqianSDK] Failed to build local overview summary:',
      mount.notebook.id,
      mount.mount.root_path,
      error
    )
    return null
  }
}

export function getActiveLocalMountByNotebookId(notebookId: string): LocalFolderMount | null {
  const mount = getLocalFolderMounts().find((item) => item.notebook.id === notebookId)
  if (!mount || mount.mount.status !== 'active') return null
  return mount
}

// --- Cache clearing (called by client on data change) ---

export function clearAllLocalCaches(): void {
  localContextListCache.clear()
  localFolderScanCache.clear()
  localOverviewSummaryCache.clear()
}
