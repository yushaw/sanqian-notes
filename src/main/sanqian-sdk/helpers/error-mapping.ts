/**
 * Error mapping and etag helpers for SDK tool handlers.
 */

import {
  buildLocalEtag,
  resolveIfMatchForInternal,
  resolveIfMatchForLocal,
} from '../../../main/note-gateway'

/**
 * User-facing tool error that should NOT be wrapped with an outer "Failed to..." prefix.
 * Throw this inside tool handlers when the message is already suitable for the user.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

export function buildLocalEtagFromFile(file: {
  notebook_id: string
  relative_path: string
  mtime_ms: number
  size: number
  content_hash?: string | null
}): string {
  return buildLocalEtag({
    notebookId: file.notebook_id,
    relativePath: file.relative_path,
    mtimeMs: file.mtime_ms,
    size: file.size,
    contentHash: file.content_hash || undefined,
  })
}

export function mapIfMatchCheckError(
  result: ReturnType<typeof resolveIfMatchForInternal> | ReturnType<typeof resolveIfMatchForLocal>,
  invalidIfMatchMessage: string,
  mismatchMessage: string
): string | null {
  if (result.ok) return null
  return result.error === 'invalid_if_match'
    ? invalidIfMatchMessage
    : mismatchMessage
}

export function mapLocalToolErrorCode(
  errorCode: string,
  options: {
    notFound: string
    conflict: string
    invalidName: string
    accessDenied: string
    writeFailed: string
    alreadyExists?: string
    tooLarge?: string
  }
): string {
  if (
    errorCode === 'LOCAL_FILE_NOT_FOUND'
    || errorCode === 'LOCAL_FILE_NOT_A_FILE'
    || errorCode === 'LOCAL_FOLDER_NOT_FOUND'
    || errorCode === 'LOCAL_FOLDER_NOT_A_DIRECTORY'
  ) {
    return options.notFound
  }
  if (errorCode === 'LOCAL_FILE_CONFLICT') {
    return options.conflict
  }
  if (errorCode === 'LOCAL_FILE_INVALID_NAME') {
    return options.invalidName
  }
  if (errorCode === 'LOCAL_FILE_ALREADY_EXISTS' || errorCode === 'LOCAL_FOLDER_ALREADY_EXISTS') {
    return options.alreadyExists || options.writeFailed
  }
  if (errorCode === 'LOCAL_FILE_UNREADABLE' || errorCode === 'LOCAL_FILE_OUT_OF_ROOT') {
    return options.accessDenied
  }
  if (errorCode === 'LOCAL_FILE_TOO_LARGE') {
    return options.tooLarge || options.writeFailed
  }
  return options.writeFailed
}

export function isLocalIfMatchStale(
  current: { size: number; mtimeMs: number; contentHash?: string },
  expected: { expectedSize?: number; expectedMtimeMs?: number; expectedContentHash?: string }
): boolean {
  if (expected.expectedContentHash !== undefined) {
    if (!current.contentHash || expected.expectedContentHash.toLowerCase() !== current.contentHash.toLowerCase()) {
      return true
    }
  }
  if (expected.expectedSize !== undefined && expected.expectedSize !== current.size) {
    return true
  }
  if (
    expected.expectedMtimeMs !== undefined
    && Math.abs(expected.expectedMtimeMs - current.mtimeMs) > 1
  ) {
    return true
  }
  return false
}
