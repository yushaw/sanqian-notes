import type Database from 'better-sqlite3'
import { getDb } from './connection'
import { runWithStatementCacheRefresh } from './statement-cache'
import { normalizeRelativeSlashPath } from '../path-compat'
import { normalizeLocalTagNames } from '../local-note-tags'
import { parseNotebookIdArrayInput, parseRequiredNotebookIdInput } from '../notebook-id'
import { escapeLikePrefix, LIKE_ESCAPE } from './helpers'
import type { LocalNoteMetadataRow } from './helpers'
import type { Notebook, LocalNoteMetadata, LocalFolderUpdateNoteMetadataInput } from '../../shared/types'
import { hasOwnDefinedProperty } from '../../shared/property-guards'

const LOCAL_NOTE_METADATA_BATCH_SELECT_CHUNK_SIZE = 300

interface LocalNoteMetadataPathStatements {
  getByPath: (notebookId: string, relativePath: string) => LocalNoteMetadataRow | null
  updatePath: (
    nextRelativePath: string,
    updatedAt: string,
    notebookId: string,
    previousRelativePath: string
  ) => number
  upsertMerged: (input: {
    notebookId: string
    relativePath: string
    isFavorite: number
    isPinned: number
    aiSummary: string | null
    summaryContentHash: string | null
    tagsJson: string | null
    aiTagsJson: string | null
    updatedAt: string
  }) => number
  deleteByPath: (notebookId: string, relativePath: string) => number
  deleteByEitherPath: (notebookId: string, firstRelativePath: string, secondRelativePath: string) => number
}

type LocalNoteMetadataDbStatement = Database.Statement<unknown[], unknown>

interface LocalNoteMetadataPathPreparedStatements {
  getByPath: LocalNoteMetadataDbStatement
  updatePath: LocalNoteMetadataDbStatement
  upsertMerged: LocalNoteMetadataDbStatement
  deleteByPath: LocalNoteMetadataDbStatement
  deleteByEitherPath: LocalNoteMetadataDbStatement
}

const localNoteMetadataPathPreparedStatementsCache = new WeakMap<
  ReturnType<typeof getDb>,
  LocalNoteMetadataPathPreparedStatements
>()

function normalizeLocalMetadataRelativePath(relativePath: string): string {
  return normalizeRelativeSlashPath(relativePath)
}

function createLocalNoteMetadataPathPreparedStatements(
  db: ReturnType<typeof getDb>
): LocalNoteMetadataPathPreparedStatements {
  return {
    getByPath: db.prepare(`
    SELECT notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
    FROM local_note_metadata
    WHERE notebook_id = ? AND relative_path = ?
  `),
    updatePath: db.prepare(`
    UPDATE local_note_metadata
    SET relative_path = ?, updated_at = ?
    WHERE notebook_id = ? AND relative_path = ?
  `),
    upsertMerged: db.prepare(`
    INSERT INTO local_note_metadata (
      notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(notebook_id, relative_path) DO UPDATE SET
      is_favorite = excluded.is_favorite,
      is_pinned = excluded.is_pinned,
      ai_summary = excluded.ai_summary,
      summary_content_hash = excluded.summary_content_hash,
      tags_json = excluded.tags_json,
      ai_tags_json = excluded.ai_tags_json,
      updated_at = excluded.updated_at
  `),
    deleteByPath: db.prepare(`
    DELETE FROM local_note_metadata
    WHERE notebook_id = ? AND relative_path = ?
  `),
    deleteByEitherPath: db.prepare(`
    DELETE FROM local_note_metadata
    WHERE notebook_id = ? AND (relative_path = ? OR relative_path = ?)
  `),
  }
}

function runWithLocalNoteMetadataPathPreparedStatements<T>(
  db: ReturnType<typeof getDb>,
  run: (statements: LocalNoteMetadataPathPreparedStatements) => T
): T {
  return runWithStatementCacheRefresh(
    localNoteMetadataPathPreparedStatementsCache,
    db,
    createLocalNoteMetadataPathPreparedStatements,
    run
  )
}

function getLocalNoteMetadataPathStatements(db: ReturnType<typeof getDb>): LocalNoteMetadataPathStatements {
  return {
    getByPath: (notebookId, relativePath) => {
      return runWithLocalNoteMetadataPathPreparedStatements(db, (statements) => {
        const row = statements.getByPath.get([notebookId, relativePath]) as LocalNoteMetadataRow | undefined
        return row || null
      })
    },
    updatePath: (nextRelativePath, updatedAt, notebookId, previousRelativePath) => {
      return runWithLocalNoteMetadataPathPreparedStatements(db, (statements) => {
        return statements.updatePath.run([
          nextRelativePath,
          updatedAt,
          notebookId,
          previousRelativePath,
        ]).changes
      })
    },
    upsertMerged: (input) => {
      return runWithLocalNoteMetadataPathPreparedStatements(db, (statements) => {
        return statements.upsertMerged.run([
          input.notebookId,
          input.relativePath,
          input.isFavorite,
          input.isPinned,
          input.aiSummary,
          input.summaryContentHash,
          input.tagsJson,
          input.aiTagsJson,
          input.updatedAt,
        ]).changes
      })
    },
    deleteByPath: (notebookId, relativePath) => {
      return runWithLocalNoteMetadataPathPreparedStatements(db, (statements) => {
        return statements.deleteByPath.run([notebookId, relativePath]).changes
      })
    },
    deleteByEitherPath: (notebookId, firstRelativePath, secondRelativePath) => {
      return runWithLocalNoteMetadataPathPreparedStatements(db, (statements) => {
        return statements.deleteByEitherPath.run([
          notebookId,
          firstRelativePath,
          secondRelativePath,
        ]).changes
      })
    },
  }
}

function normalizeLocalMetadataSummary(summary: string | null | undefined): string | null | undefined {
  if (summary === undefined) return undefined
  if (summary === null) return null
  const normalized = summary.trim()
  return normalized ? normalized : null
}

function normalizeLocalMetadataSummaryHash(
  hash: string | null | undefined
): string | null | undefined {
  if (hash === undefined) return undefined
  if (hash === null) return null
  const normalized = hash.trim().toLowerCase()
  if (!normalized) return null
  if (!/^[a-f0-9]{32}$/.test(normalized)) {
    // Invalid hash input should not silently clear an existing persisted hash.
    // Keep current value unless caller explicitly requests clearing via null/empty.
    return undefined
  }
  return normalized
}

function normalizeLocalMetadataTags(
  tags: string[] | null | undefined
): string[] | null | undefined {
  if (tags === undefined) return undefined
  if (tags === null) return null
  return normalizeLocalTagNames(tags)
}

function normalizeLocalMetadataAiTags(
  tags: string[] | null | undefined
): string[] | null | undefined {
  if (tags === undefined) return undefined
  if (tags === null) return null
  return normalizeLocalTagNames(tags)
}

function parseLocalMetadataTagsJson(tagsJson: string | null | undefined): string[] {
  if (!tagsJson) return []
  try {
    const parsed = JSON.parse(tagsJson)
    if (!Array.isArray(parsed)) return []
    const normalizedRaw = parsed
      .map((item) => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object') return ''
        const maybeName = (item as { name?: unknown }).name
        return typeof maybeName === 'string' ? maybeName : ''
      })
      .filter(Boolean)
    return normalizeLocalTagNames(normalizedRaw)
  } catch {
    return []
  }
}

function parseLocalMetadataAiTagsJson(tagsJson: string | null | undefined): string[] {
  if (!tagsJson) return []
  try {
    const parsed = JSON.parse(tagsJson)
    if (!Array.isArray(parsed)) return []
    return normalizeLocalTagNames(parsed as string[])
  } catch {
    return []
  }
}

function isDefaultLocalMetadataValue(input: {
  is_favorite: number
  is_pinned: number
  ai_summary: string | null
  summary_content_hash: string | null
  tags: string[]
  ai_tags: string[]
}): boolean {
  return (
    input.is_favorite === 0
    && input.is_pinned === 0
    && !input.ai_summary
    && !input.summary_content_hash
    && input.tags.length === 0
    && input.ai_tags.length === 0
  )
}

function areNormalizedTagListsEqual(
  previous: readonly string[] | null | undefined,
  next: readonly string[] | null | undefined
): boolean {
  const previousList = Array.isArray(previous) ? previous : []
  const nextList = Array.isArray(next) ? next : []
  if (previousList.length !== nextList.length) return false
  for (let index = 0; index < previousList.length; index += 1) {
    if (previousList[index] !== nextList[index]) return false
  }
  return true
}

function rowToLocalNoteMetadata(row: LocalNoteMetadataRow): LocalNoteMetadata {
  return {
    notebook_id: row.notebook_id,
    relative_path: row.relative_path,
    is_favorite: Boolean(row.is_favorite),
    is_pinned: Boolean(row.is_pinned),
    ai_summary: row.ai_summary,
    summary_content_hash: row.summary_content_hash,
    tags: parseLocalMetadataTagsJson(row.tags_json),
    ai_tags: parseLocalMetadataAiTagsJson(row.ai_tags_json),
    updated_at: row.updated_at,
  }
}

function getLocalNoteMetadataRowByPath(
  notebookId: string,
  relativePath: string,
  getByPath?: (notebookId: string, relativePath: string) => LocalNoteMetadataRow | null
): LocalNoteMetadataRow | null {
  if (getByPath) {
    return getByPath(notebookId, relativePath)
  }
  const db = getDb()
  const row = db.prepare(`
    SELECT notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
    FROM local_note_metadata
    WHERE notebook_id = ? AND relative_path = ?
  `).get(notebookId, relativePath) as LocalNoteMetadataRow | undefined
  return row || null
}

function renameLocalNoteMetadataPathInternal(
  notebookId: string,
  fromRelativePath: string,
  toRelativePath: string,
  statements?: LocalNoteMetadataPathStatements
): number {
  const db = getDb()
  const pathStatements = statements || getLocalNoteMetadataPathStatements(db)
  if (fromRelativePath === toRelativePath) return 0
  const source = getLocalNoteMetadataRowByPath(notebookId, fromRelativePath, pathStatements.getByPath)
  if (!source) return 0

  const now = new Date().toISOString()
  const target = getLocalNoteMetadataRowByPath(notebookId, toRelativePath, pathStatements.getByPath)
  if (!target) {
    return pathStatements.updatePath(toRelativePath, now, notebookId, fromRelativePath)
  }

  const mergedIsFavorite = source.is_favorite || target.is_favorite ? 1 : 0
  const mergedIsPinned = source.is_pinned || target.is_pinned ? 1 : 0
  const mergedSummary = target.ai_summary || source.ai_summary || null
  const mergedSummaryHash = target.summary_content_hash || source.summary_content_hash || null
  const mergedTags = normalizeLocalTagNames([
    ...parseLocalMetadataTagsJson(target.tags_json),
    ...parseLocalMetadataTagsJson(source.tags_json),
  ])
  const mergedAiTags = normalizeLocalTagNames([
    ...parseLocalMetadataAiTagsJson(target.ai_tags_json),
    ...parseLocalMetadataAiTagsJson(source.ai_tags_json),
  ])
  if (isDefaultLocalMetadataValue({
    is_favorite: mergedIsFavorite,
    is_pinned: mergedIsPinned,
    ai_summary: mergedSummary,
    summary_content_hash: mergedSummaryHash,
    tags: mergedTags,
    ai_tags: mergedAiTags,
  })) {
    pathStatements.deleteByEitherPath(notebookId, fromRelativePath, toRelativePath)
    return 1
  }

  pathStatements.upsertMerged({
    notebookId,
    relativePath: toRelativePath,
    isFavorite: mergedIsFavorite,
    isPinned: mergedIsPinned,
    aiSummary: mergedSummary,
    summaryContentHash: mergedSummaryHash,
    tagsJson: mergedTags.length > 0 ? JSON.stringify(mergedTags) : null,
    aiTagsJson: mergedAiTags.length > 0 ? JSON.stringify(mergedAiTags) : null,
    updatedAt: now,
  })

  pathStatements.deleteByPath(notebookId, fromRelativePath)
  return 1
}

export function listLocalNoteMetadata(input?: { notebookIds?: unknown }): LocalNoteMetadata[] {
  const db = getDb()
  const rawNotebookIds = input?.notebookIds
  const hasExplicitNotebookFilter = hasOwnDefinedProperty(input, 'notebookIds')
  const notebookIds = parseNotebookIdArrayInput(rawNotebookIds)
  if (hasExplicitNotebookFilter && notebookIds.length === 0) {
    return []
  }

  if (notebookIds.length > 0) {
    const placeholders = notebookIds.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
      FROM local_note_metadata
      WHERE notebook_id IN (${placeholders})
      ORDER BY updated_at DESC
    `).all(...notebookIds) as LocalNoteMetadataRow[]
    return rows.map(rowToLocalNoteMetadata)
  }

  const rows = db.prepare(`
    SELECT notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
    FROM local_note_metadata
    ORDER BY updated_at DESC
  `).all() as LocalNoteMetadataRow[]
  return rows.map(rowToLocalNoteMetadata)
}

export function getLocalNoteMetadata(input: {
  notebook_id: string
  relative_path: string
}): LocalNoteMetadata | null {
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  const relativePath = normalizeLocalMetadataRelativePath(input.relative_path || '')
  if (!notebookId || !relativePath) return null

  const row = getLocalNoteMetadataRowByPath(notebookId, relativePath)
  return row ? rowToLocalNoteMetadata(row) : null
}

export function updateLocalNoteMetadata(
  input: LocalFolderUpdateNoteMetadataInput
): LocalNoteMetadata | null {
  const db = getDb()
  const pathStatements = getLocalNoteMetadataPathStatements(db)
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  const relativePath = normalizeLocalMetadataRelativePath(input.relative_path || '')
  if (!notebookId || !relativePath) return null

  const notebook = db.prepare(`
    SELECT id, source_type
    FROM notebooks
    WHERE id = ?
  `).get(notebookId) as { id: string; source_type: Notebook['source_type'] } | undefined
  if (!notebook) return null
  if (notebook.source_type !== 'local-folder') return null

  const existing = getLocalNoteMetadataRowByPath(notebookId, relativePath, pathStatements.getByPath)
  const nextIsFavorite = input.is_favorite !== undefined
    ? (input.is_favorite ? 1 : 0)
    : (existing?.is_favorite ?? 0)
  const nextIsPinned = input.is_pinned !== undefined
    ? (input.is_pinned ? 1 : 0)
    : (existing?.is_pinned ?? 0)
  const normalizedSummaryInput = normalizeLocalMetadataSummary(input.ai_summary)
  const nextSummary = normalizedSummaryInput !== undefined
    ? normalizedSummaryInput
    : (existing?.ai_summary ?? null)
  const normalizedSummaryHashInput = normalizeLocalMetadataSummaryHash(input.summary_content_hash)
  const nextSummaryHash = normalizedSummaryHashInput !== undefined
    ? normalizedSummaryHashInput
    : (existing?.summary_content_hash ?? null)
  const normalizedTagsInput = normalizeLocalMetadataTags(input.tags)
  const nextTags = normalizedTagsInput !== undefined
    ? (normalizedTagsInput || [])
    : parseLocalMetadataTagsJson(existing?.tags_json)
  const normalizedAiTagsInput = normalizeLocalMetadataAiTags(input.ai_tags)
  const nextAiTags = normalizedAiTagsInput !== undefined
    ? (normalizedAiTagsInput || [])
    : parseLocalMetadataAiTagsJson(existing?.ai_tags_json)

  const now = new Date().toISOString()
  if (isDefaultLocalMetadataValue({
    is_favorite: nextIsFavorite,
    is_pinned: nextIsPinned,
    ai_summary: nextSummary,
    summary_content_hash: nextSummaryHash,
    tags: nextTags,
    ai_tags: nextAiTags,
  })) {
    if (existing) {
      pathStatements.deleteByPath(notebookId, relativePath)
    }
    return {
      notebook_id: notebookId,
      relative_path: relativePath,
      is_favorite: false,
      is_pinned: false,
      ai_summary: null,
      summary_content_hash: null,
      tags: [],
      ai_tags: [],
      updated_at: now,
    }
  }

  db.prepare(`
    INSERT INTO local_note_metadata (
      notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(notebook_id, relative_path) DO UPDATE SET
      is_favorite = excluded.is_favorite,
      is_pinned = excluded.is_pinned,
      ai_summary = excluded.ai_summary,
      summary_content_hash = excluded.summary_content_hash,
      tags_json = excluded.tags_json,
      ai_tags_json = excluded.ai_tags_json,
      updated_at = excluded.updated_at
  `).run(
    notebookId,
    relativePath,
    nextIsFavorite,
    nextIsPinned,
    nextSummary,
    nextSummaryHash,
    nextTags.length > 0 ? JSON.stringify(nextTags) : null,
    nextAiTags.length > 0 ? JSON.stringify(nextAiTags) : null,
    now
  )

  const row = getLocalNoteMetadataRowByPath(notebookId, relativePath, pathStatements.getByPath)
  return row ? rowToLocalNoteMetadata(row) : null
}

export function updateLocalNoteTagsBatch(input: {
  notebook_id: string
  updates: ReadonlyArray<{
    relative_path: string
    tags: readonly string[]
  }>
}): number {
  const db = getDb()
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  if (!notebookId) return 0

  const notebook = db.prepare(`
    SELECT id, source_type
    FROM notebooks
    WHERE id = ?
  `).get(notebookId) as { id: string; source_type: Notebook['source_type'] } | undefined
  if (!notebook || notebook.source_type !== 'local-folder') return 0

  const normalizedUpdatesByPath = new Map<string, string[]>()
  for (const update of input.updates || []) {
    const relativePath = normalizeLocalMetadataRelativePath(update.relative_path || '')
    if (!relativePath) continue
    const nextTags = normalizeLocalMetadataTags(Array.isArray(update.tags) ? [...update.tags] : []) || []
    normalizedUpdatesByPath.set(relativePath, nextTags)
  }
  if (normalizedUpdatesByPath.size === 0) return 0

  const targetPaths = Array.from(normalizedUpdatesByPath.keys())
  const existingByPath = new Map<string, LocalNoteMetadataRow>()
  for (let offset = 0; offset < targetPaths.length; offset += LOCAL_NOTE_METADATA_BATCH_SELECT_CHUNK_SIZE) {
    const chunk = targetPaths.slice(offset, offset + LOCAL_NOTE_METADATA_BATCH_SELECT_CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
      FROM local_note_metadata
      WHERE notebook_id = ?
        AND relative_path IN (${placeholders})
    `).all(notebookId, ...chunk) as LocalNoteMetadataRow[]
    for (const row of rows) {
      existingByPath.set(row.relative_path, row)
    }
  }

  const deleteStmt = db.prepare(`
    DELETE FROM local_note_metadata
    WHERE notebook_id = ? AND relative_path = ?
  `)
  const upsertStmt = db.prepare(`
    INSERT INTO local_note_metadata (
      notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(notebook_id, relative_path) DO UPDATE SET
      is_favorite = excluded.is_favorite,
      is_pinned = excluded.is_pinned,
      ai_summary = excluded.ai_summary,
      summary_content_hash = excluded.summary_content_hash,
      tags_json = excluded.tags_json,
      ai_tags_json = excluded.ai_tags_json,
      updated_at = excluded.updated_at
  `)

  const tx = db.transaction(() => {
    let changed = 0
    const now = new Date().toISOString()

    for (const relativePath of targetPaths) {
      const existing = existingByPath.get(relativePath)
      const nextTags = normalizedUpdatesByPath.get(relativePath) || []
      const currentTags = parseLocalMetadataTagsJson(existing?.tags_json)
      if (areNormalizedTagListsEqual(currentTags, nextTags)) {
        continue
      }

      const nextIsFavorite = existing?.is_favorite ?? 0
      const nextIsPinned = existing?.is_pinned ?? 0
      const nextSummary = existing?.ai_summary ?? null
      const nextSummaryHash = existing?.summary_content_hash ?? null
      const nextAiTags = parseLocalMetadataAiTagsJson(existing?.ai_tags_json)

      if (isDefaultLocalMetadataValue({
        is_favorite: nextIsFavorite,
        is_pinned: nextIsPinned,
        ai_summary: nextSummary,
        summary_content_hash: nextSummaryHash,
        tags: nextTags,
        ai_tags: nextAiTags,
      })) {
        if (existing) {
          changed += deleteStmt.run(notebookId, relativePath).changes
        }
        continue
      }

      changed += upsertStmt.run(
        notebookId,
        relativePath,
        nextIsFavorite,
        nextIsPinned,
        nextSummary,
        nextSummaryHash,
        nextTags.length > 0 ? JSON.stringify(nextTags) : null,
        nextAiTags.length > 0 ? JSON.stringify(nextAiTags) : null,
        now
      ).changes
    }

    return changed
  })

  return tx()
}

export function renameLocalNoteMetadataPath(input: {
  notebook_id: string
  from_relative_path: string
  to_relative_path: string
}): number {
  const db = getDb()
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  const fromRelativePath = normalizeLocalMetadataRelativePath(input.from_relative_path || '')
  const toRelativePath = normalizeLocalMetadataRelativePath(input.to_relative_path || '')
  if (!notebookId || !fromRelativePath || !toRelativePath) return 0
  if (fromRelativePath === toRelativePath) return 0

  const tx = db.transaction(() => {
    const pathStatements = getLocalNoteMetadataPathStatements(db)
    return renameLocalNoteMetadataPathInternal(
      notebookId,
      fromRelativePath,
      toRelativePath,
      pathStatements
    )
  })
  return tx()
}

export function renameLocalNoteMetadataFolderPath(input: {
  notebook_id: string
  from_relative_folder_path: string
  to_relative_folder_path: string
}): number {
  const db = getDb()
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  const fromFolderPath = normalizeLocalMetadataRelativePath(input.from_relative_folder_path || '')
  const toFolderPath = normalizeLocalMetadataRelativePath(input.to_relative_folder_path || '')
  if (!notebookId || !fromFolderPath || !toFolderPath) return 0
  if (fromFolderPath === toFolderPath) return 0
  if (toFolderPath.startsWith(`${fromFolderPath}/`)) return 0

  const tx = db.transaction(() => {
    const prefixLike = escapeLikePrefix(fromFolderPath)
    const affectedRows = db.prepare(`
      SELECT relative_path
      FROM local_note_metadata
      WHERE notebook_id = ?
        AND (relative_path = ? OR relative_path ${LIKE_ESCAPE})
      ORDER BY LENGTH(relative_path) ASC, relative_path ASC
    `).all(notebookId, fromFolderPath, prefixLike) as Array<{ relative_path: string }>
    if (affectedRows.length === 0) return 0
    const pathStatements = getLocalNoteMetadataPathStatements(db)
    let changes = 0
    for (const row of affectedRows) {
      const suffix = row.relative_path === fromFolderPath
        ? ''
        : row.relative_path.slice(fromFolderPath.length + 1)
      const nextPath = suffix ? `${toFolderPath}/${suffix}` : toFolderPath
      changes += renameLocalNoteMetadataPathInternal(
        notebookId,
        row.relative_path,
        nextPath,
        pathStatements
      )
    }
    return changes
  })

  return tx()
}

export function deleteLocalNoteMetadataByPath(input: {
  notebook_id: string
  relative_path: string
  kind: 'file' | 'folder'
}): number {
  const db = getDb()
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  const relativePath = normalizeLocalMetadataRelativePath(input.relative_path || '')
  if (!notebookId || !relativePath) return 0

  if (input.kind === 'file') {
    const result = db.prepare(`
      DELETE FROM local_note_metadata
      WHERE notebook_id = ? AND relative_path = ?
    `).run(notebookId, relativePath)
    return result.changes
  }

  const prefixLike = escapeLikePrefix(relativePath)
  const result = db.prepare(`
    DELETE FROM local_note_metadata
    WHERE notebook_id = ?
      AND (relative_path = ? OR relative_path ${LIKE_ESCAPE})
  `).run(notebookId, relativePath, prefixLike)
  return result.changes
}
