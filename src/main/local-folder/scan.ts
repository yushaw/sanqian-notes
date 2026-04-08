import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  promises as fsPromises,
} from 'fs'
import { basename, extname, join } from 'path'
import type {
  LocalFolderFileEntry,
  LocalFolderNotebookMount,
  LocalFolderTreeNode,
  LocalFolderTreeResult,
} from '../../shared/types'
import { createLocalResourceId } from '../../shared/local-resource-id'
import { toNFC, toSlashPath } from '../path-compat'
import { emitLocalPerformanceSummaryAudit } from '../local-performance-audit'
import { getStartupPhaseState, type StartupPhaseState } from '../startup-phase'
import { resolveLocalFolderCanonicalOrRootPath } from '../local-folder-root-match'
import { shouldIgnoreEntryScanError } from './errors'
import { assertMountRootPathMatchesCanonical, ALLOWED_EXTENSIONS, MAX_SCAN_FOLDER_LEVEL } from './path'
import {
  getCachedLocalListPreview,
  setLocalListPreviewCache,
  normalizeLocalSearchContentCacheKey,
  getLocalSearchContentCacheRootPrefix,
  pruneLocalListPreviewCacheForMount,
  yieldToEventLoop,
} from './cache'

const LOCAL_LIST_PREVIEW_MAX_BYTES = 4096
const LOCAL_LIST_PREVIEW_MAX_CHARS = 120
const LOCAL_SEARCH_SCAN_ASYNC_YIELD_INTERVAL = 80
const LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN = Number.isFinite(Number(process.env.LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN))
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN)))
  : 768
const LOCAL_LIST_PREVIEW_COLD_SCAN_ADAPTIVE_ENABLED = process.env.LOCAL_LIST_PREVIEW_COLD_SCAN_ADAPTIVE_ENABLED !== '0'
const LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN = Number.isFinite(
  Number(process.env.LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN)))
  : (
    process.env.NODE_ENV === 'test'
      ? LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN
      : (LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN > 0 ? Math.min(128, LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN) : 128)
  )
const LOCAL_LIST_PREVIEW_STARTUP_ADAPTIVE_ENABLED = process.env.LOCAL_LIST_PREVIEW_STARTUP_ADAPTIVE_ENABLED !== '0'
const LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN = Number.isFinite(
  Number(process.env.LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN)
)
  ? Math.max(0, Math.floor(Number(process.env.LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN)))
  : (
    process.env.NODE_ENV === 'test'
      ? LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN
      : (LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN > 0 ? Math.min(192, LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN) : 192)
  )
const LOCAL_FOLDER_SCAN_PROFILE = process.env.LOCAL_FOLDER_SCAN_PROFILE === '1'
const LOCAL_FOLDER_SCAN_SLOW_LOG_MS = Number.isFinite(Number(process.env.LOCAL_FOLDER_SCAN_SLOW_LOG_MS))
  ? Math.max(200, Math.floor(Number(process.env.LOCAL_FOLDER_SCAN_SLOW_LOG_MS)))
  : 1200
const HIDDEN_DIRECTORIES = new Set(['.git', '.obsidian', 'node_modules'])
const HIDDEN_FILES = new Set(['.DS_Store'])
const LOCAL_FOLDER_SCAN_SEEN_MOUNT_KEYS_MAX = 512
const seenLocalFolderScanMountKeys = new Set<string>()

interface PreviewReadBudget {
  reads: number
  limit: number
}

interface LocalFolderScanMetrics {
  mode: 'tree-sync' | 'tree-async' | 'search-async'
  scannedEntryCount: number
  scannedDirectoryCount: number
  scannedFileCount: number
  previewCacheHitCount: number
  previewCacheMissCount: number
  previewReadCount: number
  previewCacheWriteCount: number
  previewSkippedByBudgetCount: number
  previewDisabledCount: number
  yieldedCount: number
}

function createScanMetrics(mode: LocalFolderScanMetrics['mode']): LocalFolderScanMetrics {
  return {
    mode,
    scannedEntryCount: 0,
    scannedDirectoryCount: 0,
    scannedFileCount: 0,
    previewCacheHitCount: 0,
    previewCacheMissCount: 0,
    previewReadCount: 0,
    previewCacheWriteCount: 0,
    previewSkippedByBudgetCount: 0,
    previewDisabledCount: 0,
    yieldedCount: 0,
  }
}

function maybeLogLocalFolderScanSummary(
  mount: LocalFolderNotebookMount,
  metrics: LocalFolderScanMetrics,
  durationMs: number,
  startupState: StartupPhaseState,
  previewReadBudgetLimit: number,
  coldScan: boolean,
  previewEnabled: boolean,
  sortEnabled: boolean
): void {
  if (!LOCAL_FOLDER_SCAN_PROFILE && durationMs < LOCAL_FOLDER_SCAN_SLOW_LOG_MS) return
  emitLocalPerformanceSummaryAudit(console, '[LocalFolderScanAudit]', {
    operation: 'local_folder_scan',
    notebook_id: mount.notebook.id,
    duration_ms: durationMs,
    slow_threshold_ms: LOCAL_FOLDER_SCAN_SLOW_LOG_MS,
    profile_enabled: LOCAL_FOLDER_SCAN_PROFILE,
    startup_phase: startupState.inStartupPhase,
    startup_elapsed_ms: startupState.elapsedMs,
    startup_window_ms: startupState.windowMs,
    mode: metrics.mode,
    scanned_entry_count: metrics.scannedEntryCount,
    scanned_directory_count: metrics.scannedDirectoryCount,
    scanned_file_count: metrics.scannedFileCount,
    preview_cache_hit_count: metrics.previewCacheHitCount,
    preview_cache_miss_count: metrics.previewCacheMissCount,
    preview_read_count: metrics.previewReadCount,
    preview_cache_write_count: metrics.previewCacheWriteCount,
    preview_skipped_by_budget_count: metrics.previewSkippedByBudgetCount,
    preview_disabled_count: metrics.previewDisabledCount,
    preview_enabled: previewEnabled,
    yielded_count: metrics.yieldedCount,
    preview_read_budget_limit: previewReadBudgetLimit,
    preview_base_max_reads_per_scan: LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN,
    preview_cold_scan: coldScan,
    preview_cold_scan_adaptive_enabled: LOCAL_LIST_PREVIEW_COLD_SCAN_ADAPTIVE_ENABLED,
    preview_cold_scan_max_reads_per_scan: LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN,
    preview_startup_adaptive_enabled: LOCAL_LIST_PREVIEW_STARTUP_ADAPTIVE_ENABLED,
    preview_startup_max_reads_per_scan: LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN,
    sort_enabled: sortEnabled,
  })
}

function resolvePreviewReadBudgetLimit(startupState: StartupPhaseState, options?: { coldScan?: boolean }): number {
  let limit = LOCAL_LIST_PREVIEW_MAX_READS_PER_SCAN

  if (
    options?.coldScan
    && LOCAL_LIST_PREVIEW_COLD_SCAN_ADAPTIVE_ENABLED
    && LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN > 0
  ) {
    if (limit <= 0) {
      limit = LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN
    } else {
      limit = Math.min(limit, LOCAL_LIST_PREVIEW_COLD_SCAN_MAX_READS_PER_SCAN)
    }
  }

  if (
    LOCAL_LIST_PREVIEW_STARTUP_ADAPTIVE_ENABLED
    && startupState.inStartupPhase
    && LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN > 0
  ) {
    if (limit <= 0) {
      limit = LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN
    } else {
      limit = Math.min(limit, LOCAL_LIST_PREVIEW_STARTUP_MAX_READS_PER_SCAN)
    }
  }

  return limit
}

function buildLocalFolderScanMountKey(mount: LocalFolderNotebookMount): string {
  return JSON.stringify([
    mount.notebook.id,
    resolveLocalFolderCanonicalOrRootPath(mount.mount),
  ])
}

function markLocalFolderScanMountKeySeen(mountScanKey: string): void {
  if (seenLocalFolderScanMountKeys.has(mountScanKey)) return
  if (seenLocalFolderScanMountKeys.size >= LOCAL_FOLDER_SCAN_SEEN_MOUNT_KEYS_MAX) {
    const oldest = seenLocalFolderScanMountKeys.values().next().value
    if (oldest) {
      seenLocalFolderScanMountKeys.delete(oldest)
    }
  }
  seenLocalFolderScanMountKeys.add(mountScanKey)
}

function canReadPreviewNow(previewReadBudget: PreviewReadBudget): boolean {
  if (previewReadBudget.limit <= 0) return true
  return previewReadBudget.reads < previewReadBudget.limit
}

function createLocalDocId(notebookId: string, relativePath: string): string {
  return createLocalResourceId(notebookId, toSlashPath(relativePath))
}

function isHiddenEntry(name: string): boolean {
  if (!name) return true
  if (name.startsWith('.')) return true
  if (HIDDEN_DIRECTORIES.has(name)) return true
  if (HIDDEN_FILES.has(name)) return true
  return false
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
}

function stripYamlFrontMatter(rawContent: string): string {
  const normalized = rawContent.replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---\n')) return normalized
  const closingIndex = normalized.indexOf('\n---\n', 4)
  if (closingIndex < 0) return normalized
  return normalized.slice(closingIndex + 5)
}

function normalizePreviewText(rawContent: string): string {
  if (!rawContent) return ''
  const withoutFrontMatter = stripYamlFrontMatter(rawContent)
  return withoutFrontMatter
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function readFilePreview(absolutePath: string): string {
  let descriptor: number | null = null
  try {
    descriptor = openSync(absolutePath, 'r')
    const buffer = Buffer.alloc(LOCAL_LIST_PREVIEW_MAX_BYTES)
    const bytesRead = readSync(descriptor, buffer, 0, LOCAL_LIST_PREVIEW_MAX_BYTES, 0)
    if (bytesRead <= 0) return ''
    const rawHead = buffer.toString('utf-8', 0, bytesRead)
    return normalizePreviewText(rawHead).slice(0, LOCAL_LIST_PREVIEW_MAX_CHARS)
  } catch {
    return ''
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor)
      } catch {
        // ignore close errors
      }
    }
  }
}

async function readFilePreviewAsync(absolutePath: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof fsPromises.open>> | null = null
  try {
    handle = await fsPromises.open(absolutePath, 'r')
    const buffer = Buffer.alloc(LOCAL_LIST_PREVIEW_MAX_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, LOCAL_LIST_PREVIEW_MAX_BYTES, 0)
    if (bytesRead <= 0) return ''
    const rawHead = buffer.toString('utf-8', 0, bytesRead)
    return normalizePreviewText(rawHead).slice(0, LOCAL_LIST_PREVIEW_MAX_CHARS)
  } catch {
    return ''
  } finally {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // ignore close errors
      }
    }
  }
}

interface ScanResult {
  nodes: LocalFolderTreeNode[]
  files: LocalFolderFileEntry[]
}

function scanDirectory(
  notebookId: string,
  rootPath: string,
  absoluteDirPath: string,
  relativeDirPath: string,
  folderLevel: number,
  activePreviewCacheKeys: Set<string>,
  previewReadBudget: PreviewReadBudget,
  metrics: LocalFolderScanMetrics
): ScanResult {
  const entries = readdirSync(absoluteDirPath, { withFileTypes: true })
    .filter((entry) => !isHiddenEntry(toNFC(entry.name)))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return compareNames(toNFC(a.name), toNFC(b.name))
    })

  const nodes: LocalFolderTreeNode[] = []
  const files: LocalFolderFileEntry[] = []

  for (const entry of entries) {
    metrics.scannedEntryCount += 1
    const entryName = toNFC(entry.name)
    const absolutePath = join(absoluteDirPath, entryName)

    const relativePath = toSlashPath(relativeDirPath ? `${relativeDirPath}/${entryName}` : entryName)

    if (entry.isSymbolicLink()) {
      continue
    }

    if (entry.isDirectory()) {
      metrics.scannedDirectoryCount += 1
      const nextFolderLevel = folderLevel + 1
      if (nextFolderLevel > MAX_SCAN_FOLDER_LEVEL) {
        continue
      }

      let child: ScanResult
      try {
        child = scanDirectory(
          notebookId,
          rootPath,
          absolutePath,
          relativePath,
          nextFolderLevel,
          activePreviewCacheKeys,
          previewReadBudget,
          metrics
        )
      } catch (error) {
        if (shouldIgnoreEntryScanError(error)) {
          continue
        }
        throw error
      }

      nodes.push({
        id: createLocalDocId(notebookId, relativePath),
        name: entryName,
        kind: 'folder',
        relative_path: relativePath,
        depth: nextFolderLevel,
        children: child.nodes,
      })
      files.push(...child.files)
      continue
    }

    let stat: ReturnType<typeof lstatSync> | null = null
    if (!entry.isFile()) {
      try {
        stat = lstatSync(absolutePath)
      } catch (error) {
        if (shouldIgnoreEntryScanError(error)) {
          continue
        }
        throw error
      }

      if (stat.isSymbolicLink()) {
        continue
      }

      if (stat.isDirectory()) {
        metrics.scannedDirectoryCount += 1
        const nextFolderLevel = folderLevel + 1
        if (nextFolderLevel > MAX_SCAN_FOLDER_LEVEL) {
          continue
        }

        let child: ScanResult
        try {
          child = scanDirectory(
            notebookId,
            rootPath,
            absolutePath,
            relativePath,
            nextFolderLevel,
            activePreviewCacheKeys,
            previewReadBudget,
            metrics
          )
        } catch (error) {
          if (shouldIgnoreEntryScanError(error)) {
            continue
          }
          throw error
        }

        nodes.push({
          id: createLocalDocId(notebookId, relativePath),
          name: entryName,
          kind: 'folder',
          relative_path: relativePath,
          depth: nextFolderLevel,
          children: child.nodes,
        })
        files.push(...child.files)
        continue
      }

      if (!stat.isFile()) {
        continue
      }
    }

    const extension = extname(entryName).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      continue
    }

    if (!stat) {
      try {
        stat = lstatSync(absolutePath)
      } catch (error) {
        if (shouldIgnoreEntryScanError(error)) {
          continue
        }
        throw error
      }
      if (stat.isSymbolicLink() || !stat.isFile()) {
        continue
      }
    }

    const normalizedExtension = extension === '.txt' ? 'txt' : 'md'
    metrics.scannedFileCount += 1
    const folderRelativePath = toSlashPath(relativeDirPath)
    const folderPathSegments = folderRelativePath ? folderRelativePath.split('/').filter(Boolean).length : 0
    const fileDepth = folderPathSegments + 2
    const fileId = createLocalDocId(notebookId, relativePath)
    const previewCacheKey = normalizeLocalSearchContentCacheKey(absolutePath)
    activePreviewCacheKeys.add(previewCacheKey)
    let preview = getCachedLocalListPreview(previewCacheKey, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
    })
    if (preview !== null) {
      metrics.previewCacheHitCount += 1
    }
    if (preview === null) {
      metrics.previewCacheMissCount += 1
      if (canReadPreviewNow(previewReadBudget)) {
        const computed = readFilePreview(absolutePath)
        previewReadBudget.reads += 1
        metrics.previewReadCount += 1
        setLocalListPreviewCache(previewCacheKey, {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          ctimeMs: stat.ctimeMs,
        }, computed)
        metrics.previewCacheWriteCount += 1
        preview = computed
      } else {
        metrics.previewSkippedByBudgetCount += 1
        preview = ''
      }
    }

    nodes.push({
      id: fileId,
      name: entryName,
      kind: 'file',
      relative_path: relativePath,
      depth: fileDepth,
      extension: normalizedExtension,
      size: stat.size,
      mtime_ms: stat.mtimeMs,
    })

    files.push({
      id: fileId,
      name: basename(entryName, extension),
      file_name: entryName,
      relative_path: relativePath,
      folder_relative_path: folderRelativePath,
      folder_depth: folderLevel,
      extension: normalizedExtension,
      size: stat.size,
      mtime_ms: stat.mtimeMs,
      root_path: rootPath,
      preview,
    })
  }

  return { nodes, files }
}

export function scanLocalFolderMount(mount: LocalFolderNotebookMount): LocalFolderTreeResult {
  assertMountRootPathMatchesCanonical(mount.mount.root_path, mount.mount.canonical_root_path)
  const startedAt = Date.now()
  const startupState = getStartupPhaseState(startedAt)
  const mountScanKey = buildLocalFolderScanMountKey(mount)
  const coldScan = !seenLocalFolderScanMountKeys.has(mountScanKey)
  const previewReadBudgetLimit = resolvePreviewReadBudgetLimit(startupState, { coldScan })
  const metrics = createScanMetrics('tree-sync')
  const activePreviewCacheKeys = new Set<string>()
  const previewReadBudget: PreviewReadBudget = {
    reads: 0,
    limit: previewReadBudgetLimit,
  }
  let scanSucceeded = false
  try {
    const result = scanDirectory(
      mount.notebook.id,
      mount.mount.root_path,
      mount.mount.root_path,
      '',
      1,
      activePreviewCacheKeys,
      previewReadBudget,
      metrics
    )
    const cacheRootPrefix = getLocalSearchContentCacheRootPrefix(mount.mount.root_path)
    pruneLocalListPreviewCacheForMount(cacheRootPrefix, activePreviewCacheKeys)

    const scanned: LocalFolderTreeResult = {
      notebook_id: mount.notebook.id,
      root_path: mount.mount.root_path,
      scanned_at: new Date().toISOString(),
      tree: result.nodes,
      files: result.files,
    }
    scanSucceeded = true
    return scanned
  } finally {
    if (scanSucceeded) {
      markLocalFolderScanMountKeySeen(mountScanKey)
    }
    maybeLogLocalFolderScanSummary(
      mount,
      metrics,
      Date.now() - startedAt,
      startupState,
      previewReadBudgetLimit,
      coldScan,
      true,
      true
    )
  }
}

export async function scanLocalFolderMountForSearchAsync(
  mount: LocalFolderNotebookMount,
  options?: { sortEntries?: boolean }
): Promise<LocalFolderTreeResult> {
  assertMountRootPathMatchesCanonical(mount.mount.root_path, mount.mount.canonical_root_path)
  const startedAt = Date.now()
  const startupState = getStartupPhaseState(startedAt)
  const metrics = createScanMetrics('search-async')
  const shouldSortEntries = options?.sortEntries !== false

  interface PendingDirectory {
    absolutePath: string
    relativePath: string
    folderLevel: number
  }

  const files: LocalFolderFileEntry[] = []
  const pendingDirectories: PendingDirectory[] = [{
    absolutePath: mount.mount.root_path,
    relativePath: '',
    folderLevel: 1,
  }]
  try {
    while (pendingDirectories.length > 0) {
      const current = pendingDirectories.pop()
      if (!current) continue

      let entries: Array<import('fs').Dirent>
      try {
        entries = await fsPromises.readdir(current.absolutePath, { withFileTypes: true })
      } catch (error) {
        if (shouldIgnoreEntryScanError(error)) {
          continue
        }
        throw error
      }

      entries = entries.filter((entry) => !isHiddenEntry(toNFC(entry.name)))
      if (shouldSortEntries) {
        entries = entries.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) {
            return a.isDirectory() ? -1 : 1
          }
          return compareNames(toNFC(a.name), toNFC(b.name))
        })
      }

      const childDirectories: PendingDirectory[] = []

      for (const entry of entries) {
        metrics.scannedEntryCount += 1
        if (
          metrics.scannedEntryCount > 0
          && metrics.scannedEntryCount % LOCAL_SEARCH_SCAN_ASYNC_YIELD_INTERVAL === 0
        ) {
          metrics.yieldedCount += 1
          await yieldToEventLoop()
        }

        const entryName = toNFC(entry.name)
        const entryAbsolutePath = join(current.absolutePath, entryName)

        const relativePath = toSlashPath(
          current.relativePath ? `${current.relativePath}/${entryName}` : entryName
        )

        if (entry.isSymbolicLink()) {
          continue
        }

        if (entry.isDirectory()) {
          metrics.scannedDirectoryCount += 1
          const nextFolderLevel = current.folderLevel + 1
          if (nextFolderLevel <= MAX_SCAN_FOLDER_LEVEL) {
            childDirectories.push({
              absolutePath: entryAbsolutePath,
              relativePath,
              folderLevel: nextFolderLevel,
            })
          }
          continue
        }

        let stat: Awaited<ReturnType<typeof fsPromises.lstat>> | null = null
        if (!entry.isFile()) {
          try {
            stat = await fsPromises.lstat(entryAbsolutePath)
          } catch (error) {
            if (shouldIgnoreEntryScanError(error)) {
              continue
            }
            throw error
          }

          if (stat.isSymbolicLink()) {
            continue
          }
          if (stat.isDirectory()) {
            metrics.scannedDirectoryCount += 1
            const nextFolderLevel = current.folderLevel + 1
            if (nextFolderLevel <= MAX_SCAN_FOLDER_LEVEL) {
              childDirectories.push({
                absolutePath: entryAbsolutePath,
                relativePath,
                folderLevel: nextFolderLevel,
              })
            }
            continue
          }
          if (!stat.isFile()) {
            continue
          }
        }

        const extension = extname(entryName).toLowerCase()
        if (!ALLOWED_EXTENSIONS.has(extension)) {
          continue
        }
        if (!stat) {
          try {
            stat = await fsPromises.lstat(entryAbsolutePath)
          } catch (error) {
            if (shouldIgnoreEntryScanError(error)) {
              continue
            }
            throw error
          }
          if (stat.isSymbolicLink() || !stat.isFile()) {
            continue
          }
        }
        metrics.scannedFileCount += 1

        const normalizedExtension = extension === '.txt' ? 'txt' : 'md'
        const folderRelativePath = toSlashPath(current.relativePath)
        files.push({
          id: createLocalDocId(mount.notebook.id, relativePath),
          name: basename(entryName, extension),
          file_name: entryName,
          relative_path: relativePath,
          folder_relative_path: folderRelativePath,
          folder_depth: current.folderLevel,
          extension: normalizedExtension,
          size: stat.size,
          mtime_ms: stat.mtimeMs,
          root_path: mount.mount.root_path,
        })
      }

      for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
        pendingDirectories.push(childDirectories[index])
      }
    }

    return {
      notebook_id: mount.notebook.id,
      root_path: mount.mount.root_path,
      scanned_at: new Date().toISOString(),
      tree: [],
      files,
    }
  } finally {
    maybeLogLocalFolderScanSummary(
      mount,
      metrics,
      Date.now() - startedAt,
      startupState,
      0,
      false,
      false,
      shouldSortEntries
    )
  }
}

export interface LocalFolderTreeScanOptions {
  includePreview?: boolean
  sortEntries?: boolean
}

export async function scanLocalFolderMountAsync(
  mount: LocalFolderNotebookMount,
  options?: LocalFolderTreeScanOptions
): Promise<LocalFolderTreeResult> {
  assertMountRootPathMatchesCanonical(mount.mount.root_path, mount.mount.canonical_root_path)
  const startedAt = Date.now()
  const startupState = getStartupPhaseState(startedAt)
  const mountScanKey = buildLocalFolderScanMountKey(mount)
  const coldScan = !seenLocalFolderScanMountKeys.has(mountScanKey)
  const previewReadBudgetLimit = resolvePreviewReadBudgetLimit(startupState, { coldScan })
  const metrics = createScanMetrics('tree-async')

  interface PendingDirectory {
    absolutePath: string
    relativePath: string
    folderLevel: number
    parentChildren: LocalFolderTreeNode[]
  }

  const files: LocalFolderFileEntry[] = []
  const rootNodes: LocalFolderTreeNode[] = []
  const activePreviewCacheKeys = new Set<string>()
  const previewReadBudget: PreviewReadBudget = {
    reads: 0,
    limit: previewReadBudgetLimit,
  }
  const includePreview = options?.includePreview !== false
  const sortEntries = options?.sortEntries !== false
  let scanSucceeded = false

  const pendingDirectories: PendingDirectory[] = [{
    absolutePath: mount.mount.root_path,
    relativePath: '',
    folderLevel: 1,
    parentChildren: rootNodes,
  }]
  try {
    while (pendingDirectories.length > 0) {
      const current = pendingDirectories.pop()
      if (!current) continue

      let entries: Array<import('fs').Dirent>
      try {
        entries = await fsPromises.readdir(current.absolutePath, { withFileTypes: true })
      } catch (error) {
        if (shouldIgnoreEntryScanError(error)) {
          continue
        }
        throw error
      }

      entries = entries.filter((entry) => !isHiddenEntry(toNFC(entry.name)))
      if (sortEntries) {
        entries = entries.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) {
            return a.isDirectory() ? -1 : 1
          }
          return compareNames(toNFC(a.name), toNFC(b.name))
        })
      }

      const childDirectories: PendingDirectory[] = []

      for (const entry of entries) {
        metrics.scannedEntryCount += 1
        if (
          metrics.scannedEntryCount > 0
          && metrics.scannedEntryCount % LOCAL_SEARCH_SCAN_ASYNC_YIELD_INTERVAL === 0
        ) {
          metrics.yieldedCount += 1
          await yieldToEventLoop()
        }

        const entryName = toNFC(entry.name)
        const entryAbsolutePath = join(current.absolutePath, entryName)

        const relativePath = toSlashPath(
          current.relativePath ? `${current.relativePath}/${entryName}` : entryName
        )

        if (entry.isSymbolicLink()) {
          continue
        }

        if (entry.isDirectory()) {
          metrics.scannedDirectoryCount += 1
          const nextFolderLevel = current.folderLevel + 1
          if (nextFolderLevel > MAX_SCAN_FOLDER_LEVEL) {
            continue
          }

          const folderChildren: LocalFolderTreeNode[] = []
          const folderNode: LocalFolderTreeNode = {
            id: createLocalDocId(mount.notebook.id, relativePath),
            name: entryName,
            kind: 'folder',
            relative_path: relativePath,
            depth: nextFolderLevel,
            children: folderChildren,
          }
          current.parentChildren.push(folderNode)

          childDirectories.push({
            absolutePath: entryAbsolutePath,
            relativePath,
            folderLevel: nextFolderLevel,
            parentChildren: folderChildren,
          })
          continue
        }

        let stat: Awaited<ReturnType<typeof fsPromises.lstat>> | null = null
        if (!entry.isFile()) {
          try {
            stat = await fsPromises.lstat(entryAbsolutePath)
          } catch (error) {
            if (shouldIgnoreEntryScanError(error)) {
              continue
            }
            throw error
          }

          if (stat.isSymbolicLink()) {
            continue
          }
          if (stat.isDirectory()) {
            metrics.scannedDirectoryCount += 1
            const nextFolderLevel = current.folderLevel + 1
            if (nextFolderLevel > MAX_SCAN_FOLDER_LEVEL) {
              continue
            }

            const folderChildren: LocalFolderTreeNode[] = []
            const folderNode: LocalFolderTreeNode = {
              id: createLocalDocId(mount.notebook.id, relativePath),
              name: entryName,
              kind: 'folder',
              relative_path: relativePath,
              depth: nextFolderLevel,
              children: folderChildren,
            }
            current.parentChildren.push(folderNode)

            childDirectories.push({
              absolutePath: entryAbsolutePath,
              relativePath,
              folderLevel: nextFolderLevel,
              parentChildren: folderChildren,
            })
            continue
          }
          if (!stat.isFile()) {
            continue
          }
        }

        const extension = extname(entryName).toLowerCase()
        if (!ALLOWED_EXTENSIONS.has(extension)) {
          continue
        }
        if (!stat) {
          try {
            stat = await fsPromises.lstat(entryAbsolutePath)
          } catch (error) {
            if (shouldIgnoreEntryScanError(error)) {
              continue
            }
            throw error
          }
          if (stat.isSymbolicLink() || !stat.isFile()) {
            continue
          }
        }
        metrics.scannedFileCount += 1

        const normalizedExtension = extension === '.txt' ? 'txt' : 'md'
        const folderRelativePath = toSlashPath(current.relativePath)
        const folderPathSegments = folderRelativePath ? folderRelativePath.split('/').filter(Boolean).length : 0
        const fileDepth = folderPathSegments + 2
        const fileId = createLocalDocId(mount.notebook.id, relativePath)

        const previewCacheKey = normalizeLocalSearchContentCacheKey(entryAbsolutePath)
        activePreviewCacheKeys.add(previewCacheKey)
        let preview = ''
        if (includePreview) {
          const cachedPreview = getCachedLocalListPreview(previewCacheKey, {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            ctimeMs: stat.ctimeMs,
          })
          if (cachedPreview !== null) {
            preview = cachedPreview
            metrics.previewCacheHitCount += 1
          } else {
            metrics.previewCacheMissCount += 1
            if (canReadPreviewNow(previewReadBudget)) {
              preview = await readFilePreviewAsync(entryAbsolutePath)
              previewReadBudget.reads += 1
              metrics.previewReadCount += 1
              setLocalListPreviewCache(previewCacheKey, {
                size: stat.size,
                mtimeMs: stat.mtimeMs,
                ctimeMs: stat.ctimeMs,
              }, preview)
              metrics.previewCacheWriteCount += 1
            } else {
              metrics.previewSkippedByBudgetCount += 1
            }
          }
        } else {
          metrics.previewDisabledCount += 1
        }

        current.parentChildren.push({
          id: fileId,
          name: entryName,
          kind: 'file',
          relative_path: relativePath,
          depth: fileDepth,
          extension: normalizedExtension,
          size: stat.size,
          mtime_ms: stat.mtimeMs,
        })

        files.push({
          id: fileId,
          name: basename(entryName, extension),
          file_name: entryName,
          relative_path: relativePath,
          folder_relative_path: folderRelativePath,
          folder_depth: current.folderLevel,
          extension: normalizedExtension,
          size: stat.size,
          mtime_ms: stat.mtimeMs,
          root_path: mount.mount.root_path,
          preview,
        })
      }

      // Push in reverse order so first child is processed first (stack is LIFO)
      for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
        pendingDirectories.push(childDirectories[index])
      }
    }

    const cacheRootPrefix = getLocalSearchContentCacheRootPrefix(mount.mount.root_path)
    pruneLocalListPreviewCacheForMount(cacheRootPrefix, activePreviewCacheKeys)

    const scanned: LocalFolderTreeResult = {
      notebook_id: mount.notebook.id,
      root_path: mount.mount.root_path,
      scanned_at: new Date().toISOString(),
      tree: rootNodes,
      files,
    }
    scanSucceeded = true
    return scanned
  } finally {
    if (scanSucceeded) {
      markLocalFolderScanMountKeySeen(mountScanKey)
    }
    maybeLogLocalFolderScanSummary(
      mount,
      metrics,
      Date.now() - startedAt,
      startupState,
      previewReadBudgetLimit,
      coldScan,
      includePreview,
      sortEntries
    )
  }
}
