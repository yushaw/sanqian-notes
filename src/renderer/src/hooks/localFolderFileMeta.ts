export interface LocalFolderFileMeta {
  size: number
  mtimeMs: number
  contentHash?: string
  etag?: string
}

export function isLocalFileMetadataUnchanged(
  currentMeta: LocalFolderFileMeta | null,
  nextMeta: LocalFolderFileMeta
): boolean {
  if (!currentMeta) return false
  if (currentMeta.size !== nextMeta.size) return false
  if (Math.abs(currentMeta.mtimeMs - nextMeta.mtimeMs) > 1) return false

  if (currentMeta.contentHash && nextMeta.contentHash) {
    return currentMeta.contentHash === nextMeta.contentHash
  }

  // Compatibility fallback: some old/mock payloads omit content_hash.
  // When both etags are present and equal, treat file as unchanged.
  if (currentMeta.etag && nextMeta.etag) {
    return currentMeta.etag === nextMeta.etag
  }

  return false
}
