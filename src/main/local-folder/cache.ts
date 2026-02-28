import { join } from 'path'
import type { LocalFolderNotebookMount, LocalFolderTreeResult } from '../../shared/types'
import {
  normalizeComparablePathForFileSystem,
  toSlashPath,
} from '../path-compat'

const LOCAL_SEARCH_SCAN_CACHE_TTL_MS = 1200
const MAX_LOCAL_SEARCH_SCAN_CACHE_ENTRIES = 128
const MAX_LOCAL_SEARCH_CONTENT_CACHE_ENTRIES = 4000
const LOCAL_SEARCH_CONTENT_CACHE_TTL_MS = 10_000
const MAX_LOCAL_LIST_PREVIEW_CACHE_ENTRIES = 4000
const LOCAL_LIST_PREVIEW_CACHE_TTL_MS = 10_000

interface LocalSearchContentCacheEntry {
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
  cachedAtMs: number
  content: string
}

interface LocalSearchScanCacheEntry {
  scannedAtMs: number
  tree: LocalFolderTreeResult
}

interface LocalListPreviewCacheEntry {
  size: number
  mtimeMs: number
  ctimeMs: number
  cachedAtMs: number
  preview: string
}

const localSearchScanCache = new Map<string, LocalSearchScanCacheEntry>()
const localSearchContentCache = new Map<string, LocalSearchContentCacheEntry>()
const localListPreviewCache = new Map<string, LocalListPreviewCacheEntry>()

export function clearLocalFolderCaches(): void {
  localSearchScanCache.clear()
  localSearchContentCache.clear()
  localListPreviewCache.clear()
}

export function normalizeLocalSearchContentCacheKey(absolutePath: string): string {
  return toSlashPath(normalizeComparablePathForFileSystem(absolutePath, absolutePath))
}

export function normalizeCanonicalSearchPath(canonicalRootPath: string, relativePath: string): string {
  return toSlashPath(
    normalizeComparablePathForFileSystem(join(canonicalRootPath, relativePath), canonicalRootPath)
  )
}

function getLocalSearchScanCacheKey(mount: LocalFolderNotebookMount): string {
  const normalizedRoot = normalizeLocalSearchContentCacheKey(mount.mount.canonical_root_path || mount.mount.root_path)
  return `${mount.notebook.id}:${normalizedRoot}`
}

// --- Scan cache ---

function enforceLocalSearchScanCacheLimit(): void {
  while (localSearchScanCache.size > MAX_LOCAL_SEARCH_SCAN_CACHE_ENTRIES) {
    const oldestKey = localSearchScanCache.keys().next().value as string | undefined
    if (!oldestKey) return
    localSearchScanCache.delete(oldestKey)
  }
}

export function getCachedLocalSearchTree(mount: LocalFolderNotebookMount): LocalFolderTreeResult | null {
  const cacheKey = getLocalSearchScanCacheKey(mount)
  const cached = localSearchScanCache.get(cacheKey)
  if (!cached) return null
  if (Date.now() - cached.scannedAtMs > LOCAL_SEARCH_SCAN_CACHE_TTL_MS) {
    localSearchScanCache.delete(cacheKey)
    return null
  }
  return cached.tree
}

export function setLocalSearchTreeCache(mount: LocalFolderNotebookMount, tree: LocalFolderTreeResult): void {
  const cacheKey = getLocalSearchScanCacheKey(mount)
  localSearchScanCache.set(cacheKey, { scannedAtMs: Date.now(), tree })
  enforceLocalSearchScanCacheLimit()
}

// --- Content cache ---

function enforceLocalSearchContentCacheLimit(): void {
  while (localSearchContentCache.size > MAX_LOCAL_SEARCH_CONTENT_CACHE_ENTRIES) {
    const oldestKey = localSearchContentCache.keys().next().value as string | undefined
    if (!oldestKey) return
    localSearchContentCache.delete(oldestKey)
  }
}

export function getCachedLocalSearchContent(
  cacheKey: string,
  stat: { size: bigint; mtimeNs: bigint; ctimeNs: bigint }
): string | null {
  const cached = localSearchContentCache.get(cacheKey)
  if (!cached) return null
  if (Date.now() - cached.cachedAtMs > LOCAL_SEARCH_CONTENT_CACHE_TTL_MS) {
    localSearchContentCache.delete(cacheKey)
    return null
  }
  if (cached.size !== stat.size) return null
  if (cached.mtimeNs !== stat.mtimeNs) return null
  if (cached.ctimeNs !== stat.ctimeNs) return null
  const refreshed = {
    ...cached,
    cachedAtMs: Date.now(),
  }
  localSearchContentCache.delete(cacheKey)
  localSearchContentCache.set(cacheKey, refreshed)
  return refreshed.content
}

export function setLocalSearchContentCache(
  cacheKey: string,
  stat: { size: bigint; mtimeNs: bigint; ctimeNs: bigint },
  content: string
): void {
  localSearchContentCache.set(cacheKey, {
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
    cachedAtMs: Date.now(),
    content,
  })
  enforceLocalSearchContentCacheLimit()
}

export function deleteLocalSearchContentCacheEntry(cacheKey: string): void {
  localSearchContentCache.delete(cacheKey)
}

export function getLocalSearchContentCacheRootPrefix(rootPath: string): string {
  const normalizedRoot = normalizeLocalSearchContentCacheKey(rootPath)
  return normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`
}

export function pruneLocalSearchContentCacheForMount(rootPrefix: string, activeKeys: Set<string>): void {
  for (const cacheKey of Array.from(localSearchContentCache.keys())) {
    if (!cacheKey.startsWith(rootPrefix)) continue
    if (activeKeys.has(cacheKey)) continue
    localSearchContentCache.delete(cacheKey)
  }
}

// --- Preview cache ---

function enforceLocalListPreviewCacheLimit(): void {
  while (localListPreviewCache.size > MAX_LOCAL_LIST_PREVIEW_CACHE_ENTRIES) {
    const oldestKey = localListPreviewCache.keys().next().value as string | undefined
    if (!oldestKey) return
    localListPreviewCache.delete(oldestKey)
  }
}

export function getCachedLocalListPreview(
  cacheKey: string,
  stat: { size: number; mtimeMs: number; ctimeMs: number }
): string | null {
  const cached = localListPreviewCache.get(cacheKey)
  if (!cached) return null
  if (Date.now() - cached.cachedAtMs > LOCAL_LIST_PREVIEW_CACHE_TTL_MS) {
    localListPreviewCache.delete(cacheKey)
    return null
  }
  if (cached.size !== stat.size) return null
  if (Math.abs(cached.mtimeMs - stat.mtimeMs) > 1) return null
  if (Math.abs(cached.ctimeMs - stat.ctimeMs) > 1) return null

  const refreshed = {
    ...cached,
    cachedAtMs: Date.now(),
  }
  localListPreviewCache.delete(cacheKey)
  localListPreviewCache.set(cacheKey, refreshed)
  return refreshed.preview
}

export function setLocalListPreviewCache(
  cacheKey: string,
  stat: { size: number; mtimeMs: number; ctimeMs: number },
  preview: string
): void {
  localListPreviewCache.set(cacheKey, {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    cachedAtMs: Date.now(),
    preview,
  })
  enforceLocalListPreviewCacheLimit()
}

export function pruneLocalListPreviewCacheForMount(rootPrefix: string, activeKeys: Set<string>): void {
  for (const cacheKey of Array.from(localListPreviewCache.keys())) {
    if (!cacheKey.startsWith(rootPrefix)) continue
    if (activeKeys.has(cacheKey)) continue
    localListPreviewCache.delete(cacheKey)
  }
}

// --- Shared utilities ---

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
