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
const HIDDEN_DIRECTORIES = new Set(['.git', '.obsidian', 'node_modules'])
const HIDDEN_FILES = new Set(['.DS_Store'])

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
  activePreviewCacheKeys: Set<string>
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
    const entryName = toNFC(entry.name)
    const absolutePath = join(absoluteDirPath, entryName)
    let stat: ReturnType<typeof lstatSync>
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

    const relativePath = toSlashPath(relativeDirPath ? `${relativeDirPath}/${entryName}` : entryName)

    if (stat.isDirectory()) {
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
          activePreviewCacheKeys
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

    const extension = extname(entryName).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      continue
    }

    const normalizedExtension = extension === '.txt' ? 'txt' : 'md'
    const folderRelativePath = toSlashPath(relativeDirPath)
    const folderPathSegments = folderRelativePath ? folderRelativePath.split('/').filter(Boolean).length : 0
    const fileDepth = folderPathSegments + 2
    const fileId = createLocalDocId(notebookId, relativePath)
    const previewCacheKey = normalizeLocalSearchContentCacheKey(absolutePath)
    activePreviewCacheKeys.add(previewCacheKey)
    const preview = getCachedLocalListPreview(previewCacheKey, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
    }) ?? (() => {
      const computed = readFilePreview(absolutePath)
      setLocalListPreviewCache(previewCacheKey, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
      }, computed)
      return computed
    })()

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
  const activePreviewCacheKeys = new Set<string>()

  const result = scanDirectory(
    mount.notebook.id,
    mount.mount.root_path,
    mount.mount.root_path,
    '',
    1,
    activePreviewCacheKeys
  )
  const cacheRootPrefix = getLocalSearchContentCacheRootPrefix(mount.mount.root_path)
  pruneLocalListPreviewCacheForMount(cacheRootPrefix, activePreviewCacheKeys)

  return {
    notebook_id: mount.notebook.id,
    root_path: mount.mount.root_path,
    scanned_at: new Date().toISOString(),
    tree: result.nodes,
    files: result.files,
  }
}

export async function scanLocalFolderMountForSearchAsync(
  mount: LocalFolderNotebookMount
): Promise<LocalFolderTreeResult> {
  assertMountRootPathMatchesCanonical(mount.mount.root_path, mount.mount.canonical_root_path)

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
  let scannedEntryCount = 0

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

    entries = entries
      .filter((entry) => !isHiddenEntry(toNFC(entry.name)))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) {
          return a.isDirectory() ? -1 : 1
        }
        return compareNames(toNFC(a.name), toNFC(b.name))
      })

    const childDirectories: PendingDirectory[] = []

    for (const entry of entries) {
      scannedEntryCount += 1
      if (scannedEntryCount > 0 && scannedEntryCount % LOCAL_SEARCH_SCAN_ASYNC_YIELD_INTERVAL === 0) {
        await yieldToEventLoop()
      }

      const entryName = toNFC(entry.name)
      const entryAbsolutePath = join(current.absolutePath, entryName)
      let stat: Awaited<ReturnType<typeof fsPromises.lstat>>
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

      const relativePath = toSlashPath(
        current.relativePath ? `${current.relativePath}/${entryName}` : entryName
      )

      if (stat.isDirectory()) {
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

      const extension = extname(entryName).toLowerCase()
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        continue
      }

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
}

export async function scanLocalFolderMountAsync(
  mount: LocalFolderNotebookMount
): Promise<LocalFolderTreeResult> {
  assertMountRootPathMatchesCanonical(mount.mount.root_path, mount.mount.canonical_root_path)

  interface PendingDirectory {
    absolutePath: string
    relativePath: string
    folderLevel: number
    parentChildren: LocalFolderTreeNode[]
  }

  const files: LocalFolderFileEntry[] = []
  const rootNodes: LocalFolderTreeNode[] = []
  const activePreviewCacheKeys = new Set<string>()

  const pendingDirectories: PendingDirectory[] = [{
    absolutePath: mount.mount.root_path,
    relativePath: '',
    folderLevel: 1,
    parentChildren: rootNodes,
  }]
  let scannedEntryCount = 0

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

    entries = entries
      .filter((entry) => !isHiddenEntry(toNFC(entry.name)))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) {
          return a.isDirectory() ? -1 : 1
        }
        return compareNames(toNFC(a.name), toNFC(b.name))
      })

    const childDirectories: PendingDirectory[] = []

    for (const entry of entries) {
      scannedEntryCount += 1
      if (scannedEntryCount > 0 && scannedEntryCount % LOCAL_SEARCH_SCAN_ASYNC_YIELD_INTERVAL === 0) {
        await yieldToEventLoop()
      }

      const entryName = toNFC(entry.name)
      const entryAbsolutePath = join(current.absolutePath, entryName)
      let stat: Awaited<ReturnType<typeof fsPromises.lstat>>
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

      const relativePath = toSlashPath(
        current.relativePath ? `${current.relativePath}/${entryName}` : entryName
      )

      if (stat.isDirectory()) {
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

      const extension = extname(entryName).toLowerCase()
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        continue
      }

      const normalizedExtension = extension === '.txt' ? 'txt' : 'md'
      const folderRelativePath = toSlashPath(current.relativePath)
      const folderPathSegments = folderRelativePath ? folderRelativePath.split('/').filter(Boolean).length : 0
      const fileDepth = folderPathSegments + 2
      const fileId = createLocalDocId(mount.notebook.id, relativePath)

      const previewCacheKey = normalizeLocalSearchContentCacheKey(entryAbsolutePath)
      activePreviewCacheKeys.add(previewCacheKey)
      const preview = getCachedLocalListPreview(previewCacheKey, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
      }) ?? (() => {
        const computed = readFilePreview(entryAbsolutePath)
        setLocalListPreviewCache(previewCacheKey, {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          ctimeMs: stat.ctimeMs,
        }, computed)
        return computed
      })()

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

  return {
    notebook_id: mount.notebook.id,
    root_path: mount.mount.root_path,
    scanned_at: new Date().toISOString(),
    tree: rootNodes,
    files,
  }
}
