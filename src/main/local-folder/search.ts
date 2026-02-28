import { lstatSync, readFileSync, promises as fsPromises } from 'fs'
import type {
  LocalFolderFileEntry,
  LocalFolderNotebookMount,
  LocalFolderSearchHit,
  LocalFolderTreeResult,
} from '../../shared/types'
import { mapWithConcurrency } from '../concurrency'
import { normalizeRelativePath, resolvePathUnderRoot, MAX_EDITABLE_FILE_SIZE_BYTES } from './path'
import {
  getCachedLocalSearchTree,
  setLocalSearchTreeCache,
  getCachedLocalSearchContent,
  setLocalSearchContentCache,
  deleteLocalSearchContentCacheEntry,
  normalizeLocalSearchContentCacheKey,
  normalizeCanonicalSearchPath,
  getLocalSearchContentCacheRootPrefix,
  pruneLocalSearchContentCacheForMount,
  yieldToEventLoop,
} from './cache'
import { scanLocalFolderMount } from './scan'
import { scanLocalFolderMountForSearchAsync } from './scan'

const MAX_LOCAL_SEARCH_HITS = 200
const LOCAL_SEARCH_ASYNC_YIELD_INTERVAL = 40
const LOCAL_SEARCH_ASYNC_FILE_READ_CONCURRENCY = 6

function countOccurrences(text: string, term: string): number {
  if (!term) return 0
  let count = 0
  let fromIndex = 0
  while (true) {
    const index = text.indexOf(term, fromIndex)
    if (index < 0) break
    count += 1
    fromIndex = index + term.length
  }
  return count
}

function normalizeSearchTerms(query: string): string[] {
  const normalized = query.trim().normalize('NFC').toLowerCase()
  if (!normalized) return []
  const terms = normalized.split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  return terms
}

function buildSearchSnippet(content: string, terms: string[]): string {
  if (!content) return ''
  const lowerContent = content.toLowerCase()
  let firstIndex = -1
  for (const term of terms) {
    const index = lowerContent.indexOf(term)
    if (index >= 0 && (firstIndex < 0 || index < firstIndex)) {
      firstIndex = index
    }
  }

  if (firstIndex < 0) {
    return content.slice(0, 120).replace(/\s+/g, ' ').trim()
  }

  const start = Math.max(0, firstIndex - 48)
  const end = Math.min(content.length, firstIndex + 72)
  const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0 && end < content.length) return `...${snippet}...`
  if (start > 0) return `...${snippet}`
  if (end < content.length) return `${snippet}...`
  return snippet
}

function isFileUnderFolderScope(file: LocalFolderFileEntry, folderRelativePath: string | null): boolean {
  if (!folderRelativePath) return true
  const normalizedFolderPath = normalizeRelativePath(folderRelativePath)
  const prefix = `${normalizedFolderPath}/`
  return file.relative_path === normalizedFolderPath || file.relative_path.startsWith(prefix)
}

export function searchLocalFolderMount(
  mount: LocalFolderNotebookMount,
  query: string,
  folderRelativePath: string | null,
  scannedTree?: LocalFolderTreeResult
): LocalFolderSearchHit[] {
  const terms = normalizeSearchTerms(query)
  if (terms.length === 0) {
    return []
  }

  if (scannedTree) {
    setLocalSearchTreeCache(mount, scannedTree)
  }

  const scanned = scannedTree ?? getCachedLocalSearchTree(mount) ?? (() => {
    const freshTree = scanLocalFolderMount(mount)
    setLocalSearchTreeCache(mount, freshTree)
    return freshTree
  })()
  const hits: LocalFolderSearchHit[] = []
  const cacheRootPrefix = getLocalSearchContentCacheRootPrefix(mount.mount.root_path)
  const activeCacheKeys = new Set<string>()

  for (const file of scanned.files) {
    const absolutePath = resolvePathUnderRoot(
      mount.mount.root_path,
      file.relative_path,
      mount.mount.canonical_root_path
    )
    if (!absolutePath) continue

    const cacheKey = normalizeLocalSearchContentCacheKey(absolutePath)
    activeCacheKeys.add(cacheKey)

    if (!isFileUnderFolderScope(file, folderRelativePath)) {
      continue
    }

    let rawContent = ''
    try {
      const stat = lstatSync(absolutePath, { bigint: true })
      if (stat.isSymbolicLink() || !stat.isFile()) {
        deleteLocalSearchContentCacheEntry(cacheKey)
        continue
      }
      if (stat.size > BigInt(MAX_EDITABLE_FILE_SIZE_BYTES)) {
        deleteLocalSearchContentCacheEntry(cacheKey)
        continue
      }
      const cachedContent = getCachedLocalSearchContent(cacheKey, stat)
      if (cachedContent !== null) {
        rawContent = cachedContent
      } else {
        rawContent = readFileSync(absolutePath, 'utf-8')
        setLocalSearchContentCache(cacheKey, stat, rawContent)
      }
    } catch {
      deleteLocalSearchContentCacheEntry(cacheKey)
      continue
    }

    const lowerContent = rawContent.toLowerCase()
    const lowerFileName = file.file_name.toLowerCase()

    let matched = true
    let score = 0
    for (const term of terms) {
      const contentCount = countOccurrences(lowerContent, term)
      const nameCount = countOccurrences(lowerFileName, term)
      if (contentCount === 0 && nameCount === 0) {
        matched = false
        break
      }
      score += contentCount * 2 + nameCount * 5
    }
    if (!matched || score <= 0) continue

    hits.push({
      notebook_id: mount.notebook.id,
      relative_path: file.relative_path,
      canonical_path: normalizeCanonicalSearchPath(mount.mount.canonical_root_path, file.relative_path),
      score,
      mtime_ms: file.mtime_ms,
      snippet: buildSearchSnippet(rawContent, terms),
    })
  }

  hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return a.canonical_path.localeCompare(b.canonical_path, undefined, { sensitivity: 'base', numeric: true })
  })

  pruneLocalSearchContentCacheForMount(cacheRootPrefix, activeCacheKeys)

  return hits.slice(0, MAX_LOCAL_SEARCH_HITS)
}

export async function searchLocalFolderMountAsync(
  mount: LocalFolderNotebookMount,
  query: string,
  folderRelativePath: string | null,
  scannedTree?: LocalFolderTreeResult
): Promise<LocalFolderSearchHit[]> {
  const terms = normalizeSearchTerms(query)
  if (terms.length === 0) {
    return []
  }

  if (scannedTree) {
    setLocalSearchTreeCache(mount, scannedTree)
  }

  const scanned = scannedTree ?? getCachedLocalSearchTree(mount) ?? await (async () => {
    const freshTree = await scanLocalFolderMountForSearchAsync(mount)
    setLocalSearchTreeCache(mount, freshTree)
    return freshTree
  })()
  const cacheRootPrefix = getLocalSearchContentCacheRootPrefix(mount.mount.root_path)
  const activeCacheKeys = new Set<string>()
  const processedHits = await mapWithConcurrency(
    scanned.files,
    LOCAL_SEARCH_ASYNC_FILE_READ_CONCURRENCY,
    async (file, index): Promise<LocalFolderSearchHit | null> => {
      if (index > 0 && index % LOCAL_SEARCH_ASYNC_YIELD_INTERVAL === 0) {
        await yieldToEventLoop()
      }

      const absolutePath = resolvePathUnderRoot(
        mount.mount.root_path,
        file.relative_path,
        mount.mount.canonical_root_path
      )
      if (!absolutePath) return null

      const cacheKey = normalizeLocalSearchContentCacheKey(absolutePath)
      activeCacheKeys.add(cacheKey)

      if (!isFileUnderFolderScope(file, folderRelativePath)) {
        return null
      }

      let rawContent = ''
      try {
        const stat = await fsPromises.lstat(absolutePath, { bigint: true })
        if (stat.isSymbolicLink() || !stat.isFile()) {
          deleteLocalSearchContentCacheEntry(cacheKey)
          return null
        }
        if (stat.size > BigInt(MAX_EDITABLE_FILE_SIZE_BYTES)) {
          deleteLocalSearchContentCacheEntry(cacheKey)
          return null
        }

        const cachedContent = getCachedLocalSearchContent(cacheKey, {
          size: stat.size,
          mtimeNs: stat.mtimeNs,
          ctimeNs: stat.ctimeNs,
        })
        if (cachedContent !== null) {
          rawContent = cachedContent
        } else {
          rawContent = await fsPromises.readFile(absolutePath, 'utf-8')
          setLocalSearchContentCache(cacheKey, {
            size: stat.size,
            mtimeNs: stat.mtimeNs,
            ctimeNs: stat.ctimeNs,
          }, rawContent)
        }
      } catch {
        deleteLocalSearchContentCacheEntry(cacheKey)
        return null
      }

      const lowerContent = rawContent.toLowerCase()
      const lowerFileName = file.file_name.toLowerCase()

      let matched = true
      let score = 0
      for (const term of terms) {
        const contentCount = countOccurrences(lowerContent, term)
        const nameCount = countOccurrences(lowerFileName, term)
        if (contentCount === 0 && nameCount === 0) {
          matched = false
          break
        }
        score += contentCount * 2 + nameCount * 5
      }
      if (!matched || score <= 0) return null

      return {
        notebook_id: mount.notebook.id,
        relative_path: file.relative_path,
        canonical_path: normalizeCanonicalSearchPath(mount.mount.canonical_root_path, file.relative_path),
        score,
        mtime_ms: file.mtime_ms,
        snippet: buildSearchSnippet(rawContent, terms),
      }
    }
  )
  const hits = processedHits.filter((hit): hit is LocalFolderSearchHit => Boolean(hit))

  hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    return a.canonical_path.localeCompare(b.canonical_path, undefined, { sensitivity: 'base', numeric: true })
  })

  pruneLocalSearchContentCacheForMount(cacheRootPrefix, activeCacheKeys)

  return hits.slice(0, MAX_LOCAL_SEARCH_HITS)
}

export function dedupeLocalFolderSearchHits(
  hits: LocalFolderSearchHit[],
  limit: number = MAX_LOCAL_SEARCH_HITS
): LocalFolderSearchHit[] {
  const deduped = new Map<string, LocalFolderSearchHit>()

  for (const hit of hits) {
    const existing = deduped.get(hit.canonical_path)
    if (!existing) {
      deduped.set(hit.canonical_path, hit)
      continue
    }
    if (hit.score > existing.score) {
      deduped.set(hit.canonical_path, hit)
      continue
    }
    if (hit.score === existing.score && hit.notebook_id.localeCompare(existing.notebook_id) < 0) {
      deduped.set(hit.canonical_path, hit)
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      return a.canonical_path.localeCompare(b.canonical_path, undefined, { sensitivity: 'base', numeric: true })
    })
    .slice(0, limit)
}
