import { afterEach, describe, expect, it } from 'vitest'
import type { LocalFolderNotebookMount, LocalFolderTreeResult } from '../../shared/types'
import {
  clearLocalFolderCaches,
  getCachedLocalSearchTree,
  normalizeLocalSearchContentCacheKey,
  setLocalSearchTreeCache,
} from '../local-folder/cache'

function createMount(
  notebookId: string,
  rootPath: string,
  canonicalRootPath: string = rootPath
): LocalFolderNotebookMount {
  const now = new Date().toISOString()
  return {
    notebook: {
      id: notebookId,
      name: `Notebook ${notebookId}`,
      icon: 'logo:notes',
      source_type: 'local-folder',
      order_index: 0,
      created_at: now,
    },
    mount: {
      notebook_id: notebookId,
      root_path: rootPath,
      canonical_root_path: canonicalRootPath,
      status: 'active',
      created_at: now,
      updated_at: now,
    },
  }
}

function createTree(notebookId: string, rootPath: string): LocalFolderTreeResult {
  return {
    notebook_id: notebookId,
    root_path: rootPath,
    scanned_at: '2026-01-01T00:00:00.000Z',
    tree: [],
    files: [],
  }
}

function buildLegacyScanCacheKey(notebookId: string, rootPath: string): string {
  return `${notebookId}:${normalizeLocalSearchContentCacheKey(rootPath)}`
}

describe('local-folder scan cache keying', () => {
  afterEach(() => {
    clearLocalFolderCaches()
  })

  it('does not collide scan cache entries when notebook/root delimiters overlap legacy key format', () => {
    const mountA = createMount('nb', 'a:b')
    const mountB = createMount('nb:a', 'b')
    const treeA = createTree(mountA.notebook.id, mountA.mount.root_path)
    const treeB = createTree(mountB.notebook.id, mountB.mount.root_path)

    const legacyKeyA = buildLegacyScanCacheKey(mountA.notebook.id, mountA.mount.canonical_root_path)
    const legacyKeyB = buildLegacyScanCacheKey(mountB.notebook.id, mountB.mount.canonical_root_path)
    expect(legacyKeyA).toBe(legacyKeyB)

    setLocalSearchTreeCache(mountA, treeA)
    setLocalSearchTreeCache(mountB, treeB)

    const cachedA = getCachedLocalSearchTree(mountA)
    const cachedB = getCachedLocalSearchTree(mountB)
    expect(cachedA).toEqual(treeA)
    expect(cachedB).toEqual(treeB)
  })

  it('uses canonical root path to share cache between root path aliases of same notebook', () => {
    const canonicalRoot = '/data/notes'
    const mountOriginal = createMount('nb-1', '/Volumes/alias-a', canonicalRoot)
    const mountAlias = createMount('nb-1', '/Volumes/alias-b', canonicalRoot)
    const tree = createTree(mountOriginal.notebook.id, mountOriginal.mount.root_path)

    setLocalSearchTreeCache(mountOriginal, tree)

    const cached = getCachedLocalSearchTree(mountAlias)
    expect(cached).toEqual(tree)
  })

  it('falls back to root path when canonical root is blank and avoids cross-root cache reuse', () => {
    const mountOriginal = createMount('nb-2', '/tmp/root-a', '   ')
    const mountRelinked = createMount('nb-2', '/tmp/root-b', '   ')
    const tree = createTree(mountOriginal.notebook.id, mountOriginal.mount.root_path)

    setLocalSearchTreeCache(mountOriginal, tree)

    const cached = getCachedLocalSearchTree(mountRelinked)
    expect(cached).toBeNull()
  })
})
