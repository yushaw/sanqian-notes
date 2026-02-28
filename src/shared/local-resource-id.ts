const LOCAL_RESOURCE_ID_PREFIX = 'local:'
const LOCAL_RESOURCE_UID_MARKER = 'uid:'
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface LocalResourceRef {
  notebookId: string
  relativePath: string
  noteUid: string | null
  scheme: 'path' | 'uid' | 'legacy-path'
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
  if (!normalized.trim()) return ''
  return normalized
}

function parseCanonicalLocalResourceId(resourceId: string): LocalResourceRef | null {
  if (!resourceId.startsWith(LOCAL_RESOURCE_ID_PREFIX)) return null
  const body = resourceId.slice(LOCAL_RESOURCE_ID_PREFIX.length)
  const separatorIndex = body.indexOf(':')
  if (separatorIndex <= 0) return null
  const notebookId = body.slice(0, separatorIndex)
  const encodedPayload = body.slice(separatorIndex + 1)
  if (!notebookId || !encodedPayload) return null

  if (encodedPayload.startsWith(LOCAL_RESOURCE_UID_MARKER)) {
    const noteUid = encodedPayload.slice(LOCAL_RESOURCE_UID_MARKER.length).trim().toLowerCase()
    if (!UUID_V4_RE.test(noteUid)) return null
    return {
      notebookId,
      relativePath: '',
      noteUid,
      scheme: 'uid',
    }
  }

  try {
    const decodedPath = decodeURIComponent(encodedPayload)
    const relativePath = normalizeRelativePath(decodedPath)
    if (!relativePath) return null
    return {
      notebookId,
      relativePath,
      noteUid: null,
      scheme: 'path',
    }
  } catch {
    return null
  }
}

function parseLegacyLocalDocId(resourceId: string): LocalResourceRef | null {
  if (!resourceId || resourceId.startsWith(LOCAL_RESOURCE_ID_PREFIX)) return null
  const separatorIndex = resourceId.indexOf(':')
  if (separatorIndex <= 0) return null

  const notebookId = resourceId.slice(0, separatorIndex).trim()
  const rawRelativePath = resourceId.slice(separatorIndex + 1)
  const relativePath = normalizeRelativePath(rawRelativePath)
  if (!notebookId || !relativePath) return null

  const lowerPath = relativePath.toLowerCase()
  if (!lowerPath.endsWith('.md') && !lowerPath.endsWith('.txt')) return null

  return {
    notebookId,
    relativePath,
    noteUid: null,
    scheme: 'legacy-path',
  }
}

export function isLocalResourceId(resourceId: string): boolean {
  return parseCanonicalLocalResourceId(resourceId) !== null || parseLegacyLocalDocId(resourceId) !== null
}

export function createLocalResourceId(notebookId: string, relativePath: string): string {
  const normalizedNotebookId = notebookId.trim()
  const normalizedRelativePath = normalizeRelativePath(relativePath)
  return `${LOCAL_RESOURCE_ID_PREFIX}${normalizedNotebookId}:${encodeURIComponent(normalizedRelativePath)}`
}

export function createLocalResourceIdFromUid(notebookId: string, noteUid: string): string {
  const normalizedNotebookId = notebookId.trim()
  const normalizedNoteUid = noteUid.trim().toLowerCase()
  return `${LOCAL_RESOURCE_ID_PREFIX}${normalizedNotebookId}:${LOCAL_RESOURCE_UID_MARKER}${normalizedNoteUid}`
}

export function parseLocalResourceId(resourceId: string): LocalResourceRef | null {
  return parseCanonicalLocalResourceId(resourceId) || parseLegacyLocalDocId(resourceId)
}

export function isLocalResourceUidRef(ref: LocalResourceRef): boolean {
  return ref.scheme === 'uid' && Boolean(ref.noteUid)
}

export function getLocalResourceFileTitle(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  const fileName = segments[segments.length - 1] || normalized
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0) return fileName
  return fileName.slice(0, dotIndex)
}
