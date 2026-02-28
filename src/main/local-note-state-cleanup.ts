import {
  deleteLocalNoteIdentityByPath,
  deleteLocalNoteMetadataByPath,
  listLocalNoteIdentity,
  listLocalNoteMetadata,
  renameLocalNoteIdentityPath,
  renameLocalNoteMetadataPath,
} from './database'
import { normalizeComparablePathForFileSystem } from './path-compat'

export type NormalizeLocalPath = (relativePath: string | null | undefined) => string | null

export function cleanupMissingLocalNoteState(
  notebookId: string,
  existingPaths: Set<string>,
  normalizeLocalPath: NormalizeLocalPath
): void {
  const normalizedExistingPaths = new Set<string>()
  const comparableExistingPathMap = new Map<string, string>()

  for (const existingPath of existingPaths) {
    const normalizedPath = normalizeLocalPath(existingPath)
    if (!normalizedPath) continue
    normalizedExistingPaths.add(normalizedPath)

    const comparablePath = normalizeComparablePathForFileSystem(normalizedPath, normalizedPath)
    if (!comparableExistingPathMap.has(comparablePath)) {
      comparableExistingPathMap.set(comparablePath, normalizedPath)
    }
  }

  const metadataRows = listLocalNoteMetadata({ notebookIds: [notebookId] })
  for (const row of metadataRows) {
    const normalizedPath = normalizeLocalPath(row.relative_path)
    if (!normalizedPath) continue
    if (normalizedExistingPaths.has(normalizedPath)) continue

    const comparablePath = normalizeComparablePathForFileSystem(normalizedPath, normalizedPath)
    const remappedPath = comparableExistingPathMap.get(comparablePath)
    if (remappedPath && remappedPath !== normalizedPath) {
      renameLocalNoteMetadataPath({
        notebook_id: notebookId,
        from_relative_path: normalizedPath,
        to_relative_path: remappedPath,
      })
      continue
    }

    deleteLocalNoteMetadataByPath({
      notebook_id: notebookId,
      relative_path: normalizedPath,
      kind: 'file',
    })
  }

  const identityRows = listLocalNoteIdentity({ notebookIds: [notebookId] })
  for (const row of identityRows) {
    const normalizedPath = normalizeLocalPath(row.relative_path)
    if (!normalizedPath) continue
    if (normalizedExistingPaths.has(normalizedPath)) continue

    const comparablePath = normalizeComparablePathForFileSystem(normalizedPath, normalizedPath)
    const remappedPath = comparableExistingPathMap.get(comparablePath)
    if (remappedPath && remappedPath !== normalizedPath) {
      renameLocalNoteIdentityPath({
        notebook_id: notebookId,
        from_relative_path: normalizedPath,
        to_relative_path: remappedPath,
      })
      continue
    }

    deleteLocalNoteIdentityByPath({
      notebook_id: notebookId,
      relative_path: normalizedPath,
      kind: 'file',
    })
  }
}
