import type { LocalFolderTreeResult, LocalFolderNotebookMount } from '../shared/types'
import { scanLocalFolderMount, scanLocalFolderMountAsync } from './local-folder'

const localFolderTreeCache = new Map<string, { tree: LocalFolderTreeResult; cachedAtMs: number }>()

export function getCachedLocalFolderTree(notebookId: string, maxAgeMs: number): LocalFolderTreeResult | null {
  const cached = localFolderTreeCache.get(notebookId)
  if (!cached) return null
  if (Date.now() - cached.cachedAtMs > maxAgeMs) {
    localFolderTreeCache.delete(notebookId)
    return null
  }
  return cached.tree
}

export function cacheLocalFolderTree(tree: LocalFolderTreeResult): void {
  localFolderTreeCache.set(tree.notebook_id, {
    tree,
    cachedAtMs: Date.now(),
  })
}

export function invalidateLocalFolderTreeCache(notebookId: string): void {
  localFolderTreeCache.delete(notebookId)
}

export function scanAndCacheLocalFolderTree(mount: LocalFolderNotebookMount): LocalFolderTreeResult {
  const tree = scanLocalFolderMount(mount)
  cacheLocalFolderTree(tree)
  return tree
}

export async function scanAndCacheLocalFolderTreeAsync(mount: LocalFolderNotebookMount): Promise<LocalFolderTreeResult> {
  const tree = await scanLocalFolderMountAsync(mount)
  cacheLocalFolderTree(tree)
  return tree
}

export function clearLocalFolderTreeCache(): void {
  localFolderTreeCache.clear()
}

export function deleteLocalFolderTreeCacheEntry(notebookId: string): void {
  localFolderTreeCache.delete(notebookId)
}

export function getLocalFolderTreeCacheKeys(): IterableIterator<string> {
  return localFolderTreeCache.keys()
}
