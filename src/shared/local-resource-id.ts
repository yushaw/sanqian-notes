import { parseRequiredLocalNoteUidInput } from './local-note-uid'
import { parseRequiredNotebookIdInput } from './notebook-id'

const LOCAL_RESOURCE_ID_PREFIX = 'local:'
const LOCAL_RESOURCE_UID_MARKER = 'uid:'
const LOCAL_RESOURCE_ENCODED_NOTEBOOK_MARKER = 'nbenc:'

export interface LocalResourceRef {
  notebookId: string
  relativePath: string
  noteUid: string | null
  scheme: 'path' | 'uid' | 'legacy-path'
}

export function normalizeLocalResourceRelativePath(relativePath: string): string {
  const slashNormalized = relativePath.normalize('NFC').replace(/\\/g, '/')
  if (!slashNormalized.trim()) return ''
  const segments = slashNormalized
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
  if (segments.length === 0) return ''
  // Keep ".." segments as-is so traversal expressions remain distinct aliases.
  return segments.join('/')
}

function parseRequiredLocalResourceRelativePathInput(relativePathInput: unknown): string | null {
  if (typeof relativePathInput !== 'string') return null
  const normalizedRelativePath = normalizeLocalResourceRelativePath(relativePathInput)
  if (!normalizedRelativePath) return null
  return normalizedRelativePath
}

function parseCanonicalPayload(notebookId: string, encodedPayload: string): LocalResourceRef | null {
  const parsedNotebookId = parseRequiredNotebookIdInput(notebookId)
  if (!parsedNotebookId) return null

  if (encodedPayload.startsWith(LOCAL_RESOURCE_UID_MARKER)) {
    const noteUid = parseRequiredLocalNoteUidInput(
      encodedPayload.slice(LOCAL_RESOURCE_UID_MARKER.length)
    )
    if (!noteUid) return null
    return {
      notebookId: parsedNotebookId,
      relativePath: '',
      noteUid,
      scheme: 'uid',
    }
  }

  try {
    const decodedPath = decodeURIComponent(encodedPayload)
    const relativePath = normalizeLocalResourceRelativePath(decodedPath)
    if (!relativePath) return null
    return {
      notebookId: parsedNotebookId,
      relativePath,
      noteUid: null,
      scheme: 'path',
    }
  } catch {
    return null
  }
}

function parseCanonicalLocalResourceIdWithEncodedNotebook(body: string): LocalResourceRef | null {
  if (!body.startsWith(LOCAL_RESOURCE_ENCODED_NOTEBOOK_MARKER)) return null

  const remainder = body.slice(LOCAL_RESOURCE_ENCODED_NOTEBOOK_MARKER.length)
  const separatorIndex = remainder.indexOf(':')
  if (separatorIndex <= 0) return null

  const encodedNotebookId = remainder.slice(0, separatorIndex)
  const encodedPayload = remainder.slice(separatorIndex + 1)
  if (!encodedNotebookId || !encodedPayload) return null

  try {
    const notebookId = decodeURIComponent(encodedNotebookId)
    // Encoded notebook mode only applies to IDs that actually contain ":".
    // This guards backward compatibility for old notebook IDs like "nbenc".
    if (!notebookId || !notebookId.includes(':')) return null
    return parseCanonicalPayload(notebookId, encodedPayload)
  } catch {
    return null
  }
}

function parseCanonicalLocalResourceIdWithLegacyUidAlias(body: string): LocalResourceRef | null {
  // Legacy compatibility: historical local UID refs used
  // `local:uid:<notebookId>:<noteUid>`.
  if (!body.startsWith(`${LOCAL_RESOURCE_UID_MARKER}`)) return null

  const remainder = body.slice(LOCAL_RESOURCE_UID_MARKER.length)
  const separatorIndex = remainder.indexOf(':')
  if (separatorIndex <= 0) return null

  const notebookId = parseRequiredNotebookIdInput(
    remainder.slice(0, separatorIndex)
  )
  const noteUid = parseRequiredLocalNoteUidInput(remainder.slice(separatorIndex + 1))
  if (!notebookId || !noteUid) return null

  return {
    notebookId,
    relativePath: '',
    noteUid,
    scheme: 'uid',
  }
}

function parseCanonicalLocalResourceIdWithLegacyRawNotebookColon(body: string): LocalResourceRef | null {
  // Legacy compatibility: older canonical IDs did not encode notebook IDs.
  // For notebook IDs containing ":", prefer splitting on ":uid:" (if present),
  // otherwise split on the last ":" to recover the encoded path payload.
  const uidMarkerIndex = body.lastIndexOf(':uid:')
  if (uidMarkerIndex > 0) {
    const notebookId = body.slice(0, uidMarkerIndex)
    const payload = body.slice(uidMarkerIndex + 1)
    if (notebookId.includes(':')) {
      const parsed = parseCanonicalPayload(notebookId, payload)
      if (parsed) return parsed
    }
  }

  const separatorIndex = body.lastIndexOf(':')
  if (separatorIndex <= 0) return null
  const notebookId = body.slice(0, separatorIndex)
  const encodedPayload = body.slice(separatorIndex + 1)
  if (!notebookId || !encodedPayload) return null
  if (!notebookId.includes(':')) return null
  return parseCanonicalPayload(notebookId, encodedPayload)
}

function parseCanonicalLocalResourceId(resourceId: string): LocalResourceRef | null {
  if (!resourceId.startsWith(LOCAL_RESOURCE_ID_PREFIX)) return null
  const body = resourceId.slice(LOCAL_RESOURCE_ID_PREFIX.length)

  const encodedNotebookRef = parseCanonicalLocalResourceIdWithEncodedNotebook(body)
  if (encodedNotebookRef) return encodedNotebookRef

  const legacyUidAliasRef = parseCanonicalLocalResourceIdWithLegacyUidAlias(body)
  if (legacyUidAliasRef) return legacyUidAliasRef

  const separatorIndex = body.indexOf(':')
  if (separatorIndex <= 0) return null
  const notebookId = body.slice(0, separatorIndex)
  const encodedPayload = body.slice(separatorIndex + 1)
  if (!notebookId || !encodedPayload) return null
  const parsed = parseCanonicalPayload(notebookId, encodedPayload)
  if (!parsed) return null

  const hasMultipleSeparators = body.indexOf(':') !== body.lastIndexOf(':')
  const mayBeLegacyColonNotebookPath = (
    parsed.scheme === 'path'
    && hasMultipleSeparators
    && parsed.relativePath.includes(':')
  )
  if (mayBeLegacyColonNotebookPath) {
    const legacyColonNotebookRef = parseCanonicalLocalResourceIdWithLegacyRawNotebookColon(body)
    if (legacyColonNotebookRef) {
      return legacyColonNotebookRef
    }
  }

  return parsed
}

function encodeNotebookSegment(notebookId: string): string {
  if (!notebookId.includes(':')) return notebookId
  return `${LOCAL_RESOURCE_ENCODED_NOTEBOOK_MARKER}${encodeURIComponent(notebookId)}`
}

export function buildLocalResourceIdPrefix(notebookId: string): string {
  const parsedNotebookId = parseRequiredNotebookIdInput(notebookId)
  if (!parsedNotebookId) {
    throw new Error('invalid local resource notebook id')
  }
  return `${LOCAL_RESOURCE_ID_PREFIX}${encodeNotebookSegment(parsedNotebookId)}:`
}

function parseLegacyLocalDocId(resourceId: string): LocalResourceRef | null {
  if (!resourceId || resourceId.startsWith(LOCAL_RESOURCE_ID_PREFIX)) return null
  const separatorIndex = resourceId.indexOf(':')
  if (separatorIndex <= 0) return null

  const notebookId = parseRequiredNotebookIdInput(resourceId.slice(0, separatorIndex))
  const rawRelativePath = resourceId.slice(separatorIndex + 1)
  const relativePath = normalizeLocalResourceRelativePath(rawRelativePath)
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

function parseLocalResourceIdInput(resourceIdInput: unknown): string | null {
  if (typeof resourceIdInput !== 'string') return null
  return resourceIdInput
}

export function isLocalResourceId(resourceIdInput: unknown): boolean {
  return parseLocalResourceId(resourceIdInput) !== null
}

export function createLocalResourceId(notebookId: string, relativePath: string): string {
  const normalizedRelativePath = parseRequiredLocalResourceRelativePathInput(relativePath)
  if (!normalizedRelativePath) {
    throw new Error('invalid local resource relative path')
  }
  return `${buildLocalResourceIdPrefix(notebookId)}${encodeURIComponent(normalizedRelativePath)}`
}

export function createLocalResourceIdFromUid(notebookId: string, noteUid: string): string {
  const normalizedNoteUid = parseRequiredLocalNoteUidInput(noteUid)
  if (!normalizedNoteUid) {
    throw new Error('invalid local note uid')
  }
  return `${buildLocalResourceIdPrefix(notebookId)}${LOCAL_RESOURCE_UID_MARKER}${normalizedNoteUid}`
}

export function parseLocalResourceId(resourceIdInput: unknown): LocalResourceRef | null {
  const resourceId = parseLocalResourceIdInput(resourceIdInput)
  if (resourceId === null) return null
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
