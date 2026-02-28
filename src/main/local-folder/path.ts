import { lstatSync, realpathSync } from 'fs'
import { promises as fsPromises } from 'fs'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'path'
import type { LocalFolderFileErrorCode } from '../../shared/types'
import {
  normalizeComparablePathForFileSystem,
  normalizeRelativeSlashPath,
  toSlashPath,
} from '../path-compat'
import { createPathGuardError, WINDOWS_INVALID_ENTRY_CHARS_RE, WINDOWS_RESERVED_ENTRY_NAMES } from './errors'

export const ALLOWED_EXTENSIONS = new Set(['.md', '.txt'])

export const MAX_CREATE_FOLDER_LEVEL = 3
export const MAX_SCAN_FOLDER_LEVEL = (() => {
  const raw = process.env.SANQIAN_LOCAL_SCAN_MAX_DEPTH
  if (!raw) return 24
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return 24
  return Math.min(64, Math.max(MAX_CREATE_FOLDER_LEVEL, parsed))
})()
export const MAX_EDITABLE_FILE_SIZE_BYTES = 10 * 1024 * 1024

export function normalizeRelativePath(relativePath: string): string {
  return normalizeRelativeSlashPath(relativePath)
}

export function getRelativeFolderDepth(relativeFolderPath: string | null): number {
  if (!relativeFolderPath) return 1
  const normalized = normalizeRelativePath(relativeFolderPath)
  const segments = normalized.split('/').filter(Boolean).length
  return segments + 1
}

export function composeChildRelativePath(parentRelativePath: string | null, name: string): string {
  const normalizedParent = parentRelativePath ? normalizeRelativePath(parentRelativePath) : ''
  return normalizedParent ? `${normalizedParent}/${name}` : name
}

export function getParentRelativePath(relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath)
  const parent = dirname(normalized)
  if (!parent || parent === '.') return null
  return toSlashPath(parent)
}

export function isValidEntryName(name: string): boolean {
  if (!name) return false
  if (name === '.' || name === '..') return false
  if (name.startsWith('.')) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name.includes('\0')) return false
  if (WINDOWS_INVALID_ENTRY_CHARS_RE.test(name)) return false
  if (/[ .]$/.test(name)) return false
  const normalizedBaseName = name.split('.')[0]?.trim().toLowerCase()
  if (!normalizedBaseName) return false
  if (WINDOWS_RESERVED_ENTRY_NAMES.has(normalizedBaseName)) return false
  return true
}

export function normalizeComparableFsPath(pathValue: string, referencePath: string = pathValue): string {
  return normalizeComparablePathForFileSystem(pathValue, referencePath)
}

export function isSameOrChildFsPath(parentPath: string, candidatePath: string): boolean {
  const normalizedParentPath = normalizeComparableFsPath(parentPath, parentPath)
  const normalizedCandidatePath = normalizeComparableFsPath(candidatePath, parentPath)
  if (normalizedCandidatePath === normalizedParentPath) {
    return true
  }
  const prefix = normalizedParentPath.endsWith(sep)
    ? normalizedParentPath
    : `${normalizedParentPath}${sep}`
  return normalizedCandidatePath.startsWith(prefix)
}

export function resolveExistingProbePath(resolvedRootPath: string, absolutePath: string): string | null {
  const normalizedResolvedRootPath = normalizeComparableFsPath(resolvedRootPath, resolvedRootPath)
  let probePath = absolutePath

  while (true) {
    try {
      lstatSync(probePath)
      return probePath
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        if (normalizeComparableFsPath(probePath, resolvedRootPath) === normalizedResolvedRootPath) {
          return null
        }
        const parentPath = dirname(probePath)
        if (parentPath === probePath) {
          return null
        }
        probePath = parentPath
        continue
      }
      return null
    }
  }
}

export function assertMountRootPathMatchesCanonical(rootPath: string, canonicalRootPath: string): void {
  try {
    const rootRealPath = resolve(realpathSync(rootPath))
    const canonicalRealPath = resolve(realpathSync(canonicalRootPath))
    if (normalizeComparableFsPath(rootRealPath) !== normalizeComparableFsPath(canonicalRealPath)) {
      throw createPathGuardError('ENOENT', 'mount root no longer matches canonical path')
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') {
      throw error
    }
    throw createPathGuardError('ENOENT', 'mount root path is unreachable')
  }
}

function isPathWithinCanonicalRoot(
  resolvedRootPath: string,
  absolutePath: string,
  canonicalRootPath: string
): boolean {
  const probePath = resolveExistingProbePath(resolvedRootPath, absolutePath)
  if (!probePath) {
    // No existing ancestor found up to root -- target is in a not-yet-created
    // subdirectory.  The caller already verified the relative path has no '..'
    // segments, so this is safe to allow.
    return true
  }

  try {
    const rootRealPath = resolve(realpathSync(canonicalRootPath))
    const probeRealPath = resolve(realpathSync(probePath))
    return isSameOrChildFsPath(rootRealPath, probeRealPath)
  } catch (error) {
    // Fail-closed: if we cannot verify the canonical path, deny access.
    console.warn('[local-folder] isPathWithinCanonicalRoot failed, denying access:', error)
    return false
  }
}

export function resolvePathUnderRoot(rootPath: string, relativePath: string, canonicalRootPath?: string): string | null {
  const normalizedRelativePath = normalizeRelativePath(relativePath)
  if (!normalizedRelativePath || isAbsolute(normalizedRelativePath)) {
    return null
  }

  const pathSegments = normalizedRelativePath.split('/').filter(Boolean)
  if (pathSegments.length === 0 || pathSegments.some((segment) => segment === '.' || segment === '..')) {
    return null
  }

  const resolvedRootPath = resolve(rootPath)
  const absolutePath = resolve(resolvedRootPath, normalizedRelativePath)
  const relativeToRoot = relative(resolvedRootPath, absolutePath)
  if (relativeToRoot.startsWith('..') || isAbsolute(relativeToRoot)) {
    return null
  }

  if (canonicalRootPath && !isPathWithinCanonicalRoot(resolvedRootPath, absolutePath, canonicalRootPath)) {
    return null
  }

  return absolutePath
}

export function isSameRenameTargetPath(
  currentAbsolutePath: string,
  nextAbsolutePath: string,
  currentStat: NonNullable<ReturnType<typeof lstatSync>>,
  nextStat: NonNullable<ReturnType<typeof lstatSync>>
): boolean {
  if (currentAbsolutePath === nextAbsolutePath) {
    return true
  }
  return currentStat.dev === nextStat.dev && currentStat.ino === nextStat.ino
}

export function resolveExistingDirectory(
  rootPath: string,
  relativePath: string | null,
  canonicalRootPath?: string
): { success: true; absolutePath: string; relativePath: string } | { success: false; errorCode: LocalFolderFileErrorCode } {
  if (!relativePath) {
    return { success: true, absolutePath: rootPath, relativePath: '' }
  }

  const normalizedPath = normalizeRelativePath(relativePath)
  const absolutePath = resolvePathUnderRoot(rootPath, normalizedPath, canonicalRootPath)
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  try {
    const stat = lstatSync(absolutePath)
    if (stat.isSymbolicLink()) {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_A_DIRECTORY' }
    }
    if (!stat.isDirectory()) {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_A_DIRECTORY' }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
  }

  return {
    success: true,
    absolutePath,
    relativePath: normalizedPath,
  }
}

export async function resolveExistingDirectoryAsync(
  rootPath: string,
  relativePath: string | null,
  canonicalRootPath?: string
): Promise<{ success: true; absolutePath: string; relativePath: string } | { success: false; errorCode: LocalFolderFileErrorCode }> {
  if (!relativePath) {
    return { success: true, absolutePath: rootPath, relativePath: '' }
  }

  const normalizedPath = normalizeRelativePath(relativePath)
  const absolutePath = resolvePathUnderRoot(rootPath, normalizedPath, canonicalRootPath)
  if (!absolutePath) {
    return { success: false, errorCode: 'LOCAL_FILE_OUT_OF_ROOT' }
  }

  try {
    const stat = await fsPromises.lstat(absolutePath)
    if (stat.isSymbolicLink()) {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_A_DIRECTORY' }
    }
    if (!stat.isDirectory()) {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_A_DIRECTORY' }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { success: false, errorCode: 'LOCAL_FOLDER_NOT_FOUND' }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
    }
    return { success: false, errorCode: 'LOCAL_FILE_UNREADABLE' }
  }

  return {
    success: true,
    absolutePath,
    relativePath: normalizedPath,
  }
}

export function normalizeCreateFileName(fileNameInput: string): { success: true; fileName: string } | { success: false; errorCode: LocalFolderFileErrorCode } {
  const trimmed = fileNameInput.trim()
  if (!trimmed) {
    return { success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' }
  }

  const extension = extname(trimmed).toLowerCase()
  let normalizedFileName = trimmed
  if (!extension) {
    normalizedFileName = `${trimmed}.md`
  } else if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
  }

  if (!isValidEntryName(normalizedFileName)) {
    return { success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' }
  }

  return { success: true, fileName: normalizedFileName }
}

export function normalizeRenameFileName(
  currentRelativePath: string,
  fileNameInput: string
): { success: true; fileName: string } | { success: false; errorCode: LocalFolderFileErrorCode } {
  const trimmed = fileNameInput.trim()
  if (!trimmed) {
    return { success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' }
  }

  const currentExtension = extname(currentRelativePath).toLowerCase()
  const nextExtension = extname(trimmed).toLowerCase()
  let normalizedFileName = trimmed
  if (!nextExtension) {
    normalizedFileName = `${trimmed}${currentExtension || '.md'}`
  } else if (!ALLOWED_EXTENSIONS.has(nextExtension)) {
    return { success: false, errorCode: 'LOCAL_FILE_UNSUPPORTED_TYPE' }
  }

  if (!isValidEntryName(normalizedFileName)) {
    return { success: false, errorCode: 'LOCAL_FILE_INVALID_NAME' }
  }

  return { success: true, fileName: normalizedFileName }
}

export function hasFileChangedSinceRead(
  currentStat: { size: number; mtimeMs: number },
  expectedMtimeMs: number | undefined,
  expectedSize: number | undefined
): boolean {
  if (typeof expectedSize === 'number' && currentStat.size !== expectedSize) {
    return true
  }
  if (typeof expectedMtimeMs === 'number' && Math.abs(currentStat.mtimeMs - expectedMtimeMs) > 1) {
    return true
  }
  return false
}
