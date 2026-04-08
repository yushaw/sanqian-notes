import { EventEmitter } from 'events'
import { lstatSync, readdirSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import type { NonSharedBuffer } from 'node:buffer'
import type { NotebookStatus } from '../shared/types'
import { toNFC } from './path-compat'

export function resolveMountStatusFromFsError(error: unknown): Extract<NotebookStatus, 'missing' | 'permission_required'> {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EACCES' || code === 'EPERM') {
    return 'permission_required'
  }
  return 'missing'
}

const RECOVERABLE_WATCH_ERROR_CODES = new Set([
  'EMFILE',
  'ENFILE',
  'ENOSPC',
  'ENOMEM',
  'EAGAIN',
  'ERR_FS_WATCHER_LIMIT',
])

export function isRecoverableWatchError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (!code) return false
  return RECOVERABLE_WATCH_ERROR_CODES.has(code)
}

export function createLocalFolderWatchScheduler<TEvent extends { notebook_id: string }>(
  emit: (event: TEvent) => void,
  debounceMs: number,
  mergeEvent?: (previous: TEvent, next: TEvent) => TEvent
) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingEvents = new Map<string, TEvent>()

  function clear(notebookId: string): void {
    const timer = timers.get(notebookId)
    if (timer) {
      clearTimeout(timer)
      timers.delete(notebookId)
    }
    pendingEvents.delete(notebookId)
  }

  function schedule(event: TEvent): void {
    const notebookId = event.notebook_id
    const existingTimer = timers.get(notebookId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      timers.delete(notebookId)
    }
    const previousEvent = pendingEvents.get(notebookId)
    const nextEvent = previousEvent && mergeEvent
      ? mergeEvent(previousEvent, event)
      : event
    pendingEvents.set(notebookId, nextEvent)
    const timer = setTimeout(() => {
      timers.delete(notebookId)
      const pending = pendingEvents.get(notebookId)
      pendingEvents.delete(notebookId)
      if (!pending) return
      emit(pending)
    }, debounceMs)
    timers.set(notebookId, timer)
  }

  function clearAll(): void {
    for (const notebookId of timers.keys()) {
      clear(notebookId)
    }
  }

  return {
    schedule,
    clear,
    clearAll,
  }
}

export type LocalFolderWatchFactory = typeof watch
export interface FileSystemWatchChange {
  eventType: 'rename' | 'change' | 'unknown'
  absolutePath: string | null
}

const RECURSIVE_WATCH_UNSUPPORTED_ERROR_CODES = new Set([
  'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM',
  'ENOSYS',
])

const RECURSIVE_WATCH_LEGACY_UNSUPPORTED_ERROR_CODES = new Set([
  'ERR_INVALID_ARG_VALUE',
  'ERR_INVALID_OPT_VALUE',
])

function isRecursiveWatchUnsupportedError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code && RECURSIVE_WATCH_UNSUPPORTED_ERROR_CODES.has(code)) {
    return true
  }

  const message = (error as { message?: unknown } | undefined)?.message
  if (typeof message !== 'string' || message.length === 0) {
    return false
  }

  // Some Node.js builds report recursive-watch unsupported as argument-value
  // validation errors instead of ERR_FEATURE_UNAVAILABLE_ON_PLATFORM.
  if (code && RECURSIVE_WATCH_LEGACY_UNSUPPORTED_ERROR_CODES.has(code)) {
    return /recursive/i.test(message)
  }

  // Best-effort fallback for environments that only provide message text.
  return /watch recursively is unavailable|recursive .*?(unsupported|not supported|unavailable)/i.test(message)
}

function resolveFallbackWatchMaxDepth(): number {
  const explicitRaw = process.env.SANQIAN_LOCAL_WATCH_MAX_DEPTH
  if (explicitRaw) {
    const explicit = Number.parseInt(explicitRaw, 10)
    if (Number.isFinite(explicit)) {
      return Math.min(24, Math.max(3, explicit))
    }
  }

  const scanRaw = process.env.SANQIAN_LOCAL_SCAN_MAX_DEPTH
  if (scanRaw) {
    const scanDepth = Number.parseInt(scanRaw, 10)
    if (Number.isFinite(scanDepth)) {
      // Fallback watcher is one-watcher-per-directory; keep a safe cap.
      return Math.min(12, Math.max(3, scanDepth))
    }
  }

  return 6
}

const FALLBACK_WATCH_MAX_DEPTH = resolveFallbackWatchMaxDepth()
const HIDDEN_WATCH_DIRECTORIES = new Set(['.git', '.obsidian', 'node_modules'])

function normalizeWatchFileName(fileName: unknown): string {
  if (typeof fileName === 'string') return toNFC(fileName)
  if (fileName && typeof fileName === 'object' && 'toString' in fileName) {
    try {
      return toNFC(String((fileName as { toString: (encoding?: string) => string }).toString('utf8')))
    } catch {
      return ''
    }
  }
  return ''
}

function shouldIgnoreWatchedDirectoryName(name: string): boolean {
  if (!name) return true
  if (name.startsWith('.')) return true
  if (HIDDEN_WATCH_DIRECTORIES.has(name)) return true
  return false
}

function shouldIgnoreWatchTraversalError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM'
}

function isKnownNonDirectoryDirent(entry: import('fs').Dirent<NonSharedBuffer>): boolean {
  return entry.isFile()
    || entry.isBlockDevice()
    || entry.isCharacterDevice()
    || entry.isFIFO()
    || entry.isSocket()
}

function shouldWatchChildDirectory(
  parentDirectoryPath: string,
  entry: import('fs').Dirent<NonSharedBuffer>,
  entryName: string
): boolean {
  if (entry.isSymbolicLink()) return false
  if (entry.isDirectory()) return true
  if (isKnownNonDirectoryDirent(entry)) return false

  // Some filesystems return unknown dirent types. Fall back to lstat so we
  // don't miss real directories when recursive watch fallback is active.
  const childDirectoryPath = join(parentDirectoryPath, entryName)
  try {
    const stat = lstatSync(childDirectoryPath)
    if (stat.isSymbolicLink()) return false
    return stat.isDirectory()
  } catch (error) {
    if (shouldIgnoreWatchTraversalError(error)) return false
    throw error
  }
}

function collectWatchDirectories(rootPath: string, maxDepth: number): Set<string> {
  const directories = new Set<string>()
  const stack: Array<{ directoryPath: string; depth: number }> = [{ directoryPath: rootPath, depth: 1 }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    if (directories.has(current.directoryPath)) continue
    directories.add(current.directoryPath)

    if (current.depth >= maxDepth) {
      continue
    }

    let entries: Array<import('fs').Dirent<NonSharedBuffer>>
    try {
      entries = readdirSync(current.directoryPath, { withFileTypes: true, encoding: 'buffer' })
    } catch (error) {
      if (shouldIgnoreWatchTraversalError(error)) {
        continue
      }
      throw error
    }

    for (const entry of entries) {
      const entryName = toNFC(entry.name.toString('utf8'))
      if (shouldIgnoreWatchedDirectoryName(entryName)) {
        continue
      }
      if (!shouldWatchChildDirectory(current.directoryPath, entry, entryName)) {
        continue
      }

      const childDirectoryPath = join(current.directoryPath, entryName)
      stack.push({ directoryPath: childDirectoryPath, depth: current.depth + 1 })
    }
  }

  return directories
}

function createFallbackDirectoryTreeWatcher(
  rootPath: string,
  onChanged: (change: FileSystemWatchChange) => void,
  watchFactory: LocalFolderWatchFactory
): FSWatcher {
  const compositeWatcher = new EventEmitter() as EventEmitter & FSWatcher
  compositeWatcher.ref = () => compositeWatcher
  compositeWatcher.unref = () => compositeWatcher
  const directoryWatchers = new Map<string, FSWatcher>()

  let closed = false
  let syncTimer: ReturnType<typeof setTimeout> | null = null

  const emitCompositeError = (error: unknown): void => {
    if (closed) return
    compositeWatcher.emit('error', error)
  }

  const closeDirectoryWatcher = (directoryPath: string): void => {
    const watcher = directoryWatchers.get(directoryPath)
    if (!watcher) return
    watcher.removeListener('error', emitCompositeError)
    try {
      watcher.close()
    } catch (error) {
      emitCompositeError(error)
    } finally {
      directoryWatchers.delete(directoryPath)
    }
  }

  const addDirectoryWatcher = (directoryPath: string): void => {
    if (directoryWatchers.has(directoryPath)) return
    const watcher = watchFactory(directoryPath, (eventType, fileName) => {
      const normalizedFileName = normalizeWatchFileName(fileName)
      const absolutePath = normalizedFileName ? join(directoryPath, normalizedFileName) : null
      onChanged({
        eventType: eventType === 'rename' || eventType === 'change' ? eventType : 'unknown',
        absolutePath,
      })
      scheduleSync()
    })
    watcher.on('error', emitCompositeError)
    directoryWatchers.set(directoryPath, watcher)
  }

  const syncWatchers = (throwOnError: boolean): void => {
    let watchedDirectories: Set<string>
    try {
      watchedDirectories = collectWatchDirectories(rootPath, FALLBACK_WATCH_MAX_DEPTH)
    } catch (error) {
      if (throwOnError) throw error
      emitCompositeError(error)
      return
    }

    for (const existingPath of Array.from(directoryWatchers.keys())) {
      if (!watchedDirectories.has(existingPath)) {
        closeDirectoryWatcher(existingPath)
      }
    }

    for (const directoryPath of watchedDirectories) {
      if (directoryWatchers.has(directoryPath)) continue
      try {
        addDirectoryWatcher(directoryPath)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          continue
        }
        if (throwOnError) throw error
        emitCompositeError(error)
        return
      }
    }
  }

  const scheduleSync = (): void => {
    if (closed || syncTimer) return
    syncTimer = setTimeout(() => {
      syncTimer = null
      if (closed) return
      syncWatchers(false)
    }, 60)
  }

  syncWatchers(true)

  compositeWatcher.close = () => {
    if (closed) return
    closed = true
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = null
    }
    for (const pathValue of Array.from(directoryWatchers.keys())) {
      closeDirectoryWatcher(pathValue)
    }
    compositeWatcher.removeAllListeners()
  }

  return compositeWatcher as FSWatcher
}

export function createFileSystemWatcher(
  rootPath: string,
  onChanged: (change: FileSystemWatchChange) => void,
  watchFactory: LocalFolderWatchFactory = watch
): FSWatcher {
  try {
    return watchFactory(rootPath, { recursive: true }, (eventType, fileName) => {
      const normalizedFileName = normalizeWatchFileName(fileName)
      const absolutePath = normalizedFileName ? join(rootPath, normalizedFileName) : null
      onChanged({
        eventType: eventType === 'rename' || eventType === 'change' ? eventType : 'unknown',
        absolutePath,
      })
    })
  } catch (error) {
    if (isRecursiveWatchUnsupportedError(error)) {
      return createFallbackDirectoryTreeWatcher(rootPath, onChanged, watchFactory)
    }
    throw error
  }
}
