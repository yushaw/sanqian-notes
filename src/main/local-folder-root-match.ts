import type { LocalFolderTreeResult } from '../shared/types'
import { normalizeComparablePathForFileSystem } from './path-compat'

export interface LocalFolderRootPathLike {
  root_path: string
  canonical_root_path?: string | null
}

export function resolveLocalFolderCanonicalOrRootPath(mountLike: LocalFolderRootPathLike): string {
  const canonicalRootPath = typeof mountLike.canonical_root_path === 'string'
    ? mountLike.canonical_root_path.trim()
    : ''
  return canonicalRootPath || mountLike.root_path
}

export function resolveComparableLocalFolderRootPath(mountLike: LocalFolderRootPathLike): string {
  const canonicalOrRootPath = resolveLocalFolderCanonicalOrRootPath(mountLike)
  return normalizeComparablePathForFileSystem(canonicalOrRootPath, canonicalOrRootPath)
}

export function isLocalFolderRootPathMatched(
  cachedRootPath: string | null | undefined,
  mountLike: LocalFolderRootPathLike
): boolean {
  if (typeof cachedRootPath !== 'string' || !cachedRootPath.trim()) {
    return false
  }
  const canonicalOrRootPath = resolveLocalFolderCanonicalOrRootPath(mountLike)
  const cachedComparablePath = normalizeComparablePathForFileSystem(
    cachedRootPath,
    canonicalOrRootPath
  )
  const mountComparablePath = normalizeComparablePathForFileSystem(
    canonicalOrRootPath,
    canonicalOrRootPath
  )
  return cachedComparablePath === mountComparablePath
}

export function isLocalFolderTreeRootMatched(
  treeLike: Pick<LocalFolderTreeResult, 'root_path'>,
  mountLike: LocalFolderRootPathLike
): boolean {
  return isLocalFolderRootPathMatched(treeLike.root_path, mountLike)
}
