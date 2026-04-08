/**
 * Note Gateway -- unified resource resolution across internal and local-folder sources.
 *
 * Architecture note: the sourceType branching in this module (and in tools/mutations.ts,
 * tools/read.ts) is intentional. Each source type has fundamentally different:
 *   - Transaction models (SQLite row vs filesystem write)
 *   - Etag/revision semantics (integer revision vs mtime+size+hash)
 *   - Field subsets (internal has revision/deleted_at; local has mtime_ms/content_hash)
 *
 * A NoteSourceAdapter abstraction was evaluated and rejected: the adapter method count
 * would equal the existing branch code, but add an indirection layer with no real
 * reduction in complexity. The branches are few (~13 total) and concentrated in 2 files.
 */
import type {
  LocalFolderFileContent,
  LocalFolderFileErrorCode,
  LocalFolderNotebookMount,
  LocalFolderReadFileResponse,
  LocalNoteMetadata,
  Note,
  Notebook,
} from '../shared/types'
import {
  createLocalResourceId,
  parseLocalResourceId,
  type LocalResourceRef,
} from '../shared/local-resource-id'
import {
  ensureLocalNoteIdentity,
  getLocalFolderMounts,
  getLocalNoteIdentityByUid,
  getLocalNoteMetadata,
  getNoteById,
  getNotebooks,
} from './database'
import { extractLocalTagNamesFromTiptapContent, mergeLocalUserAndAITagNames } from './local-note-tags'
import { readLocalFolderFile, readLocalFolderFileAsync } from './local-folder'
import { parseRequiredNotebookIdInput } from './notebook-id'
import { parseRequiredLocalNoteUidInput } from './local-note-uid'
import { normalizeRelativeSlashPath } from './path-compat'

const ETAG_PREFIX = 'sqn-v1'
const LOCAL_ETAG_PREFIX = `${ETAG_PREFIX}:local:`
const LOCAL_ETAG_ENCODED_NOTEBOOK_MARKER = 'nbenc'
const EMPTY_TIPTAP_DOC = '{"type":"doc","content":[]}'
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i

type ParsedIfMatch =
  | { sourceType: 'internal'; noteId?: string; revision: number }
  | {
      sourceType: 'local-folder'
      notebookId: string
      relativePath: string
      mtimeMs: number
      size: number
      contentHash?: string
    }

export type NoteResourceErrorCode =
  | 'NOTE_NOT_FOUND'
  | 'NOTE_UNREADABLE'
  | 'NOTE_OUT_OF_ROOT'
  | 'NOTE_UNSUPPORTED'
  | 'NOTE_TOO_LARGE'

export interface InternalNoteResource {
  sourceType: 'internal'
  id: string
  note: Note
  etag: string
}

export interface LocalNoteResource {
  sourceType: 'local-folder'
  id: string
  notebook: Notebook
  mount: LocalFolderNotebookMount
  relativePath: string
  file: LocalFolderFileContent
  etag: string
}

export type ResolvedNoteResource = InternalNoteResource | LocalNoteResource

export type ResolveNoteResourceResult =
  | { ok: true; resource: ResolvedNoteResource }
  | { ok: false; errorCode: NoteResourceErrorCode }

export type ResolveNotebookForCreateResult =
  | { ok: true; sourceType: 'internal'; notebook: Notebook | null }
  | { ok: true; sourceType: 'local-folder'; notebook: Notebook; mount: LocalFolderNotebookMount }
  | { ok: false; error: 'notebook_not_found' | 'local_mount_unavailable' }

export type IfMatchCheckResult =
  | {
      ok: true
      expectedRevision?: number
      expectedMtimeMs?: number
      expectedSize?: number
      expectedContentHash?: string
    }
  | { ok: false; error: 'invalid_if_match' | 'if_match_mismatch' }

export interface BuildNoteFromResourceOptions {
  includeLocalContent?: boolean
  localMetadata?: LocalNoteMetadata | null
}

function normalizeIfMatchInput(raw: unknown): string | number | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const weakQuoted = trimmed.match(/^W\/"(.+)"$/)
  if (weakQuoted) return weakQuoted[1]
  const quoted = trimmed.match(/^"(.+)"$/)
  if (quoted) return quoted[1]
  return trimmed
}

function normalizeLocalRelativePathForIdentity(relativePath: string): string {
  return normalizeRelativeSlashPath(relativePath)
}

function normalizeOptionalContentHash(contentHash: string | undefined): string | undefined {
  if (typeof contentHash !== 'string') return undefined
  const trimmed = contentHash.trim()
  if (!trimmed || !SHA256_HEX_PATTERN.test(trimmed)) return undefined
  return trimmed.toLowerCase()
}

function encodeLocalEtagNotebookSegment(notebookId: string): string {
  if (!notebookId.includes(':')) return notebookId
  return `${LOCAL_ETAG_ENCODED_NOTEBOOK_MARKER}:${encodeURIComponent(notebookId)}`
}

function decodeLocalEtagNotebookSegments(notebookSegments: string[]): string | null {
  if (notebookSegments.length === 0) return null

  if (
    notebookSegments.length === 2
    && notebookSegments[0] === LOCAL_ETAG_ENCODED_NOTEBOOK_MARKER
  ) {
    try {
      const decodedNotebookId = decodeURIComponent(notebookSegments[1])
      // Encoded mode is only canonical when notebookId actually contains ":".
      // Otherwise keep compatibility with legacy raw notebook IDs like "nbenc:foo".
      if (decodedNotebookId && decodedNotebookId.includes(':')) {
        return decodedNotebookId
      }
    } catch {
      // Keep legacy fallback below for raw notebook IDs like "nbenc:%".
    }
  }

  const notebookId = notebookSegments.join(':')
  return notebookId || null
}

function parseLocalIfMatch(normalized: string): ParsedIfMatch | null {
  if (!normalized.startsWith(LOCAL_ETAG_PREFIX)) return null

  const body = normalized.slice(LOCAL_ETAG_PREFIX.length)
  const segments = body.split(':')
  if (segments.length < 4) return null

  let endIndex = segments.length
  let contentHash: string | undefined
  const hashCandidate = segments[endIndex - 1]
  if (SHA256_HEX_PATTERN.test(hashCandidate)) {
    contentHash = hashCandidate.toLowerCase()
    endIndex -= 1
  }

  if (endIndex < 4) return null

  const sizeToken = segments[endIndex - 1]
  const mtimeMsToken = segments[endIndex - 2]
  const encodedRelativePath = segments[endIndex - 3]
  const notebookSegments = segments.slice(0, endIndex - 3)

  if (!encodedRelativePath || notebookSegments.length === 0) return null
  if (!/^\d+$/.test(mtimeMsToken) || !/^\d+$/.test(sizeToken)) return null

  const mtimeMs = Number.parseInt(mtimeMsToken, 10)
  const size = Number.parseInt(sizeToken, 10)
  if (
    !Number.isFinite(mtimeMs)
    || !Number.isFinite(size)
    || !Number.isSafeInteger(mtimeMs)
    || !Number.isSafeInteger(size)
    || mtimeMs < 0
    || size < 0
  ) {
    return null
  }

  const notebookId = decodeLocalEtagNotebookSegments(notebookSegments)
  if (!notebookId) return null

  try {
    const relativePath = normalizeLocalRelativePathForIdentity(decodeURIComponent(encodedRelativePath))
    if (!relativePath) return null
    return {
      sourceType: 'local-folder',
      notebookId,
      relativePath,
      mtimeMs,
      size,
      contentHash,
    }
  } catch {
    return null
  }
}

function parseIfMatch(raw: unknown): ParsedIfMatch | null {
  const normalized = normalizeIfMatchInput(raw)
  if (normalized === null) return null

  if (typeof normalized === 'number') {
    if (!Number.isInteger(normalized) || normalized < 0 || !Number.isSafeInteger(normalized)) {
      return null
    }
    const revision = normalized
    return { sourceType: 'internal', revision }
  }

  if (/^\d+$/.test(normalized)) {
    const revision = Number.parseInt(normalized, 10)
    if (!Number.isFinite(revision) || revision < 0 || !Number.isSafeInteger(revision)) return null
    return { sourceType: 'internal', revision }
  }

  if (normalized.startsWith(`${ETAG_PREFIX}:internal:`)) {
    const body = normalized.slice(`${ETAG_PREFIX}:internal:`.length)
    const revisionSeparator = body.lastIndexOf(':')
    if (revisionSeparator <= 0) return null

    const noteId = body.slice(0, revisionSeparator)
    const revisionToken = body.slice(revisionSeparator + 1)
    if (!noteId || !/^\d+$/.test(revisionToken)) return null

    const revision = Number.parseInt(revisionToken, 10)
    if (!Number.isFinite(revision) || revision < 0 || !Number.isSafeInteger(revision)) return null
    return { sourceType: 'internal', noteId, revision }
  }

  const parsedLocal = parseLocalIfMatch(normalized)
  if (parsedLocal) return parsedLocal

  return null
}

function mapLocalReadErrorCode(errorCode: LocalFolderFileErrorCode): NoteResourceErrorCode {
  if (errorCode === 'LOCAL_FILE_UNREADABLE') return 'NOTE_UNREADABLE'
  if (errorCode === 'LOCAL_FILE_OUT_OF_ROOT') return 'NOTE_OUT_OF_ROOT'
  if (errorCode === 'LOCAL_FILE_UNSUPPORTED_TYPE') return 'NOTE_UNSUPPORTED'
  if (errorCode === 'LOCAL_FILE_TOO_LARGE') return 'NOTE_TOO_LARGE'
  return 'NOTE_NOT_FOUND'
}

function getActiveLocalMount(notebookId: string): LocalFolderNotebookMount | null {
  const mount = getLocalFolderMounts().find((item) => item.notebook.id === notebookId)
  if (!mount || mount.mount.status !== 'active') return null
  return mount
}

/**
 * Resolve a noteId (or pre-parsed LocalResourceRef) to { notebookId, relativePath }.
 * Handles: canonical local resource IDs, uid-based refs, and bare UUID fallback.
 */
export function resolveLocalNoteRef(
  noteIdOrRef: string | LocalResourceRef
): { notebookId: string; relativePath: string } | null {
  const localRef =
    typeof noteIdOrRef === 'string' ? parseLocalResourceId(noteIdOrRef) : noteIdOrRef

  if (localRef) {
    if (localRef.relativePath) {
      return { notebookId: localRef.notebookId, relativePath: localRef.relativePath }
    }
    if (localRef.noteUid) {
      const identity = getLocalNoteIdentityByUid({
        note_uid: localRef.noteUid,
        notebook_id: localRef.notebookId,
      }, { repairIfNeeded: false })
      if (identity) {
        return { notebookId: identity.notebook_id, relativePath: identity.relative_path }
      }
    }
  }

  // Bare note-uid fallback: treat the string itself as a note_uid
  if (typeof noteIdOrRef === 'string') {
    const identity = getLocalNoteIdentityByUid({ note_uid: noteIdOrRef }, { repairIfNeeded: false })
    if (identity) {
      return { notebookId: identity.notebook_id, relativePath: identity.relative_path }
    }
  }

  return null
}

function resolveLocalRefRelativePath(localRef: LocalResourceRef): string | null {
  return resolveLocalNoteRef(localRef)?.relativePath ?? null
}

export function buildCanonicalLocalResourceId(input: {
  notebookId: string
  relativePath: string
}): string {
  let identity: ReturnType<typeof ensureLocalNoteIdentity> = null
  try {
    identity = ensureLocalNoteIdentity({
      notebook_id: input.notebookId,
      relative_path: input.relativePath,
    })
  } catch (error) {
    console.warn('[Main] Failed to ensure local note identity while building canonical local resource id:', {
      notebookId: input.notebookId,
      relativePath: input.relativePath,
      error,
    })
  }
  const parsedIdentityUid = parseRequiredLocalNoteUidInput(identity?.note_uid)
  if (parsedIdentityUid) {
    return parsedIdentityUid
  }
  if (identity?.note_uid) {
    console.warn('[Main] Invalid local note identity note_uid while building canonical local resource id; falling back to path id:', {
      notebookId: input.notebookId,
      relativePath: input.relativePath,
      noteUid: identity.note_uid,
    })
  }
  return createLocalResourceId(input.notebookId, input.relativePath)
}

export function buildRendererLocalResourceId(input: {
  notebookId: string
  relativePath: string
}): string {
  return createLocalResourceId(input.notebookId, input.relativePath)
}

export function buildInternalEtag(note: Pick<Note, 'id' | 'revision'>): string {
  return `${ETAG_PREFIX}:internal:${note.id}:${note.revision}`
}

export function buildLocalEtag(input: {
  notebookId: string
  relativePath: string
  mtimeMs: number
  size: number
  contentHash?: string
}): string {
  const normalizedRelativePath = normalizeLocalRelativePathForIdentity(input.relativePath)
  const notebookSegment = encodeLocalEtagNotebookSegment(input.notebookId)
  const base = `${ETAG_PREFIX}:local:${notebookSegment}:${encodeURIComponent(normalizedRelativePath)}:${Math.trunc(input.mtimeMs)}:${Math.trunc(input.size)}`
  const normalizedContentHash = normalizeOptionalContentHash(input.contentHash)
  return normalizedContentHash ? `${base}:${normalizedContentHash}` : base
}

export function resolveNotebookForCreate(notebookId: string | null | undefined): ResolveNotebookForCreateResult {
  const parsedNotebookId = parseRequiredNotebookIdInput(notebookId)
  if (!parsedNotebookId) {
    return { ok: true, sourceType: 'internal', notebook: null }
  }

  const notebook = getNotebooks().find((item) => item.id === parsedNotebookId)
  if (!notebook) {
    return { ok: false, error: 'notebook_not_found' }
  }

  if (notebook.source_type !== 'local-folder') {
    return { ok: true, sourceType: 'internal', notebook }
  }

  const mount = getActiveLocalMount(notebook.id)
  if (!mount) {
    return { ok: false, error: 'local_mount_unavailable' }
  }

  return { ok: true, sourceType: 'local-folder', notebook, mount }
}

function buildResolvedLocalResource(input: {
  notebookId: string
  mount: LocalFolderNotebookMount
  file: LocalFolderFileContent
}): ResolveNoteResourceResult {
  const notebook = getNotebooks().find((item) => item.id === input.notebookId) || input.mount.notebook
  const rendererId = buildRendererLocalResourceId({
    notebookId: input.notebookId,
    relativePath: input.file.relative_path,
  })
  return {
    ok: true,
    resource: {
      sourceType: 'local-folder',
      id: rendererId,
      notebook,
      mount: input.mount,
      relativePath: input.file.relative_path,
      file: input.file,
      etag: buildLocalEtag({
        notebookId: input.notebookId,
        relativePath: input.file.relative_path,
        mtimeMs: input.file.mtime_ms,
        size: input.file.size,
        contentHash: input.file.content_hash,
      }),
    },
  }
}

function buildResolveResultFromLocalRead(input: {
  notebookId: string
  mount: LocalFolderNotebookMount
  readResult: LocalFolderReadFileResponse
}): ResolveNoteResourceResult {
  if (!input.readResult.success) {
    return { ok: false, errorCode: mapLocalReadErrorCode(input.readResult.errorCode) }
  }
  return buildResolvedLocalResource({
    notebookId: input.notebookId,
    mount: input.mount,
    file: input.readResult.result,
  })
}

function parseResolvableNoteIdInput(idInput: unknown): string | null {
  if (typeof idInput !== 'string') return null
  return idInput
}

export function resolveNoteResource(idInput: unknown): ResolveNoteResourceResult {
  const id = parseResolvableNoteIdInput(idInput)
  if (id === null) {
    return { ok: false, errorCode: 'NOTE_NOT_FOUND' }
  }

  const localRef = parseLocalResourceId(id)
  if (localRef) {
    const mount = getActiveLocalMount(localRef.notebookId)
    if (!mount) {
      return { ok: false, errorCode: 'NOTE_NOT_FOUND' }
    }

    const resolvedRelativePath = resolveLocalRefRelativePath(localRef)
    if (!resolvedRelativePath) {
      return { ok: false, errorCode: 'NOTE_NOT_FOUND' }
    }

    return buildResolveResultFromLocalRead({
      notebookId: localRef.notebookId,
      mount,
      readResult: readLocalFolderFile(mount, resolvedRelativePath),
    })
  }

  const note = getNoteById(id)
  if (!note || note.deleted_at) {
    const localIdentity = getLocalNoteIdentityByUid({ note_uid: id }, { repairIfNeeded: false })
    if (!localIdentity) {
      return { ok: false, errorCode: 'NOTE_NOT_FOUND' }
    }

    const mount = getActiveLocalMount(localIdentity.notebook_id)
    if (!mount) {
      return { ok: false, errorCode: 'NOTE_NOT_FOUND' }
    }

    return buildResolveResultFromLocalRead({
      notebookId: localIdentity.notebook_id,
      mount,
      readResult: readLocalFolderFile(mount, localIdentity.relative_path),
    })
  }

  return {
    ok: true,
    resource: {
      sourceType: 'internal',
      id: note.id,
      note,
      etag: buildInternalEtag(note),
    },
  }
}

export async function resolveNoteResourceAsync(idInput: unknown): Promise<ResolveNoteResourceResult> {
  const id = parseResolvableNoteIdInput(idInput)
  if (id === null) {
    return { ok: false, errorCode: 'NOTE_NOT_FOUND' }
  }

  const localRef = parseLocalResourceId(id)
  if (localRef) {
    const mount = getActiveLocalMount(localRef.notebookId)
    if (!mount) {
      return { ok: false, errorCode: 'NOTE_NOT_FOUND' }
    }

    const resolvedRelativePath = resolveLocalRefRelativePath(localRef)
    if (!resolvedRelativePath) {
      return { ok: false, errorCode: 'NOTE_NOT_FOUND' }
    }

    return buildResolveResultFromLocalRead({
      notebookId: localRef.notebookId,
      mount,
      readResult: await readLocalFolderFileAsync(mount, resolvedRelativePath),
    })
  }

  const note = getNoteById(id)
  if (!note || note.deleted_at) {
    const localIdentity = getLocalNoteIdentityByUid({ note_uid: id }, { repairIfNeeded: false })
    if (!localIdentity) {
      return { ok: false, errorCode: 'NOTE_NOT_FOUND' }
    }

    const mount = getActiveLocalMount(localIdentity.notebook_id)
    if (!mount) {
      return { ok: false, errorCode: 'NOTE_NOT_FOUND' }
    }

    return buildResolveResultFromLocalRead({
      notebookId: localIdentity.notebook_id,
      mount,
      readResult: await readLocalFolderFileAsync(mount, localIdentity.relative_path),
    })
  }

  return {
    ok: true,
    resource: {
      sourceType: 'internal',
      id: note.id,
      note,
      etag: buildInternalEtag(note),
    },
  }
}

function buildLocalNoteFromResource(
  resource: LocalNoteResource,
  options?: BuildNoteFromResourceOptions
): Note {
  const metadata = options?.localMetadata === undefined
    ? getLocalNoteMetadata({
      notebook_id: resource.file.notebook_id,
      relative_path: resource.file.relative_path,
    })
    : options.localMetadata
  const includeLocalContent = options?.includeLocalContent !== false
  const updatedAt = new Date(resource.file.mtime_ms).toISOString()
  const pathSummary = resource.notebook.name
    ? `${resource.notebook.name} · ${resource.file.relative_path}`
    : resource.file.relative_path
  const localUserTagNames = metadata?.tags?.length
    ? metadata.tags
    : extractLocalTagNamesFromTiptapContent(resource.file.tiptap_content)
  const localAiTagNames = metadata?.ai_tags || []

  return {
    id: resource.id,
    title: resource.file.name,
    content: includeLocalContent ? resource.file.tiptap_content : EMPTY_TIPTAP_DOC,
    notebook_id: resource.file.notebook_id,
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: metadata?.is_favorite ?? false,
    is_pinned: metadata?.is_pinned ?? false,
    revision: 0,
    created_at: updatedAt,
    updated_at: updatedAt,
    deleted_at: null,
    ai_summary: metadata?.ai_summary || pathSummary,
    tags: mergeLocalUserAndAITagNames(localUserTagNames, localAiTagNames),
  }
}

export function buildNoteFromResolvedResource(
  resource: ResolvedNoteResource,
  options?: BuildNoteFromResourceOptions
): Note {
  if (resource.sourceType === 'internal') {
    return resource.note
  }
  return buildLocalNoteFromResource(resource, options)
}

export function resolveIfMatchForInternal(
  note: Pick<Note, 'id' | 'revision'>,
  ifMatch: unknown
): IfMatchCheckResult {
  if (ifMatch === undefined || ifMatch === null) {
    return { ok: true }
  }
  if (typeof ifMatch === 'string' && !ifMatch.trim()) {
    return { ok: false, error: 'invalid_if_match' }
  }
  if (typeof ifMatch === 'number' && !Number.isFinite(ifMatch)) {
    return { ok: false, error: 'invalid_if_match' }
  }
  if (typeof ifMatch !== 'string' && typeof ifMatch !== 'number') {
    return { ok: false, error: 'invalid_if_match' }
  }

  const parsed = parseIfMatch(ifMatch)
  if (!parsed) {
    return { ok: false, error: 'invalid_if_match' }
  }
  if (parsed.sourceType !== 'internal') {
    return { ok: false, error: 'if_match_mismatch' }
  }
  if (parsed.noteId && parsed.noteId !== note.id) {
    return { ok: false, error: 'if_match_mismatch' }
  }

  return { ok: true, expectedRevision: parsed.revision }
}

export function resolveIfMatchForLocal(
  input: {
    notebookId: string
    relativePath: string
    mtimeMs: number
    size: number
    contentHash?: string
  },
  ifMatch: unknown
): IfMatchCheckResult {
  if (ifMatch === undefined || ifMatch === null) {
    return { ok: true }
  }
  if (typeof ifMatch === 'string' && !ifMatch.trim()) {
    return { ok: false, error: 'invalid_if_match' }
  }
  if (typeof ifMatch === 'number' && !Number.isFinite(ifMatch)) {
    return { ok: false, error: 'invalid_if_match' }
  }
  if (typeof ifMatch !== 'string' && typeof ifMatch !== 'number') {
    return { ok: false, error: 'invalid_if_match' }
  }

  const parsed = parseIfMatch(ifMatch)
  if (!parsed) {
    return { ok: false, error: 'invalid_if_match' }
  }
  if (parsed.sourceType !== 'local-folder') {
    return { ok: false, error: 'if_match_mismatch' }
  }
  const normalizedInputPath = normalizeLocalRelativePathForIdentity(input.relativePath)
  const normalizedParsedPath = normalizeLocalRelativePathForIdentity(parsed.relativePath)
  if (parsed.notebookId !== input.notebookId || normalizedParsedPath !== normalizedInputPath) {
    return { ok: false, error: 'if_match_mismatch' }
  }
  if (
    parsed.contentHash
    && (!input.contentHash || parsed.contentHash !== input.contentHash.toLowerCase())
  ) {
    return { ok: false, error: 'if_match_mismatch' }
  }

  return {
    ok: true,
    expectedMtimeMs: parsed.mtimeMs,
    expectedSize: parsed.size,
    expectedContentHash: parsed.contentHash,
  }
}
