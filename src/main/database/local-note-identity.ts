import type Database from 'better-sqlite3'
import { getDb } from './connection'
import { runWithStatementCacheRefresh } from './statement-cache'
import { normalizeRelativeSlashPath } from '../path-compat'
import { escapeLikePrefix, LIKE_ESCAPE, isLocalFolderNotebookId } from './helpers'
import { parseNotebookIdArrayInput, parseRequiredNotebookIdInput } from '../notebook-id'
import { parseRequiredLocalNoteUidInput } from '../local-note-uid'
import {
  shouldRetryLocalNoteUidGenerationError,
  tryUseGeneratedLocalNoteUid,
} from '../local-note-uid-generation'
import { remapLocalFolderAIPopupRefsNoteUid } from './ai-popups'
import {
  emitLocalNoteIdentityUidRepairFailureAudit,
  emitLocalNoteIdentityUidRepairRowAudit,
  type LocalNoteIdentityUidRepairStrategy,
} from '../local-note-identity-audit'
import {
  needsLocalNoteIdentityUidRepair,
  resolveLocalNoteIdentityUidRepairPlan,
} from '../local-note-identity-uid-repair'
import type { LocalNoteIdentityRow } from './helpers'
import { hasOwnDefinedProperty, hasOwnPropertyKey } from '../../shared/property-guards'

export interface LocalNoteIdentity {
  note_uid: string
  notebook_id: string
  relative_path: string
  created_at: string
  updated_at: string
}

export interface LocalNoteIdentityLookupOptions {
  repairIfNeeded?: boolean
}

const LOCAL_NOTE_IDENTITY_BATCH_SELECT_CHUNK_SIZE = 300

interface LocalNoteIdentityPathStatements {
  getByPath: (notebookId: string, relativePath: string) => LocalNoteIdentityRow | null
  deleteByRowId: (sourceRowId: number) => number
  updatePathByRowId: (nextRelativePath: string, updatedAt: string, sourceRowId: number) => number
  updateNotebookPathByRowId: (
    notebookId: string,
    nextRelativePath: string,
    updatedAt: string,
    sourceRowId: number
  ) => number
}

type LocalNoteIdentityDbStatement = Database.Statement<unknown[], unknown>

interface LocalNoteIdentityPathPreparedStatements {
  getByPath: LocalNoteIdentityDbStatement
  deleteByRowId: LocalNoteIdentityDbStatement
  updatePathByRowId: LocalNoteIdentityDbStatement
  updateNotebookPathByRowId: LocalNoteIdentityDbStatement
}

const localNoteIdentityPathPreparedStatementsCache = new WeakMap<
  ReturnType<typeof getDb>,
  LocalNoteIdentityPathPreparedStatements
>()

function normalizeLocalIdentityRelativePath(relativePath: string): string {
  return normalizeRelativeSlashPath(relativePath)
}

function createLocalNoteIdentityPathPreparedStatements(
  db: ReturnType<typeof getDb>
): LocalNoteIdentityPathPreparedStatements {
  return {
    getByPath: db.prepare(`
    SELECT rowid as source_rowid, note_uid, notebook_id, relative_path, created_at, updated_at
    FROM local_note_identity
    WHERE notebook_id = ? AND relative_path = ?
  `),
    deleteByRowId: db.prepare(`
    DELETE FROM local_note_identity
    WHERE rowid = ?
  `),
    updatePathByRowId: db.prepare(`
    UPDATE local_note_identity
    SET relative_path = ?, updated_at = ?
    WHERE rowid = ?
  `),
    updateNotebookPathByRowId: db.prepare(`
    UPDATE local_note_identity
    SET notebook_id = ?, relative_path = ?, updated_at = ?
    WHERE rowid = ?
  `),
  }
}

function runWithLocalNoteIdentityPathPreparedStatements<T>(
  db: ReturnType<typeof getDb>,
  run: (statements: LocalNoteIdentityPathPreparedStatements) => T
): T {
  return runWithStatementCacheRefresh(
    localNoteIdentityPathPreparedStatementsCache,
    db,
    createLocalNoteIdentityPathPreparedStatements,
    run
  )
}

function getLocalNoteIdentityPathStatements(db: ReturnType<typeof getDb>): LocalNoteIdentityPathStatements {
  return {
    getByPath: (notebookId, relativePath) => {
      return runWithLocalNoteIdentityPathPreparedStatements(db, (statements) => {
        const row = statements.getByPath.get(notebookId, relativePath) as LocalNoteIdentityRow | undefined
        return row || null
      })
    },
    deleteByRowId: (sourceRowId) => {
      return runWithLocalNoteIdentityPathPreparedStatements(db, (statements) => {
        return statements.deleteByRowId.run(sourceRowId).changes
      })
    },
    updatePathByRowId: (nextRelativePath, updatedAt, sourceRowId) => {
      return runWithLocalNoteIdentityPathPreparedStatements(db, (statements) => {
        return statements.updatePathByRowId.run(nextRelativePath, updatedAt, sourceRowId).changes
      })
    },
    updateNotebookPathByRowId: (notebookId, nextRelativePath, updatedAt, sourceRowId) => {
      return runWithLocalNoteIdentityPathPreparedStatements(db, (statements) => {
        return statements.updateNotebookPathByRowId.run(
          notebookId,
          nextRelativePath,
          updatedAt,
          sourceRowId
        ).changes
      })
    },
  }
}

function createHasInternalNoteIdChecker(db: ReturnType<typeof getDb>): (noteId: string) => boolean {
  const hasInternalNoteIdStmt = db.prepare(`
    SELECT 1 as ok
    FROM notes
    WHERE id = ?
    LIMIT 1
  `)
  return (noteId: string): boolean => {
    return Boolean((hasInternalNoteIdStmt.get(noteId) as { ok: number } | undefined)?.ok)
  }
}

function rowToLocalNoteIdentity(row: LocalNoteIdentityRow): LocalNoteIdentity {
  return {
    note_uid: row.note_uid,
    notebook_id: row.notebook_id,
    relative_path: row.relative_path,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function shouldRepairLocalNoteIdentityLookup(options?: LocalNoteIdentityLookupOptions): boolean {
  return options?.repairIfNeeded === true
}

function maybeRepairLocalNoteIdentityLookupRow(
  row: LocalNoteIdentityRow,
  options?: LocalNoteIdentityLookupOptions,
  hasInternalNoteId?: (noteId: string) => boolean
): LocalNoteIdentityRow {
  if (!shouldRepairLocalNoteIdentityLookup(options)) {
    return row
  }
  return repairLocalNoteIdentityRowUidIfNeeded(row, { hasInternalNoteId })
}

export function getLocalNoteIdentityUidsByNotebook(
  notebookId: string,
  options?: LocalNoteIdentityLookupOptions
): Set<string> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT note_uid, notebook_id, relative_path, created_at, updated_at
    FROM local_note_identity
    WHERE notebook_id = ?
  `).all(notebookId) as LocalNoteIdentityRow[]
  const uids = new Set<string>()
  const hasInternalNoteId = shouldRepairLocalNoteIdentityLookup(options)
    ? createHasInternalNoteIdChecker(db)
    : undefined
  for (const row of rows) {
    const normalizedRow = maybeRepairLocalNoteIdentityLookupRow(row, options, hasInternalNoteId)
    uids.add(normalizedRow.note_uid)
  }
  return uids
}

function getLocalNoteIdentityRowByPath(
  notebookId: string,
  relativePath: string,
  getByPath?: (notebookId: string, relativePath: string) => LocalNoteIdentityRow | null
): LocalNoteIdentityRow | null {
  if (getByPath) {
    return getByPath(notebookId, relativePath)
  }
  const db = getDb()
  const row = db.prepare(`
    SELECT note_uid, notebook_id, relative_path, created_at, updated_at
    FROM local_note_identity
    WHERE notebook_id = ? AND relative_path = ?
  `).get(notebookId, relativePath) as LocalNoteIdentityRow | undefined
  return row || null
}

function getLocalNoteIdentityRowByUid(
  noteUid: string,
  options?: { notebookId?: string }
): LocalNoteIdentityRow | null {
  const db = getDb()
  const notebookId = options?.notebookId

  if (notebookId) {
    const row = db.prepare(`
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity
      WHERE note_uid = ?
        AND notebook_id = ?
      LIMIT 1
    `).get(noteUid, notebookId) as LocalNoteIdentityRow | undefined
    return row || null
  }

  const row = db.prepare(`
    SELECT note_uid, notebook_id, relative_path, created_at, updated_at
    FROM local_note_identity
    WHERE note_uid = ?
    LIMIT 1
  `).get(noteUid) as LocalNoteIdentityRow | undefined
  return row || null
}

function getLocalNoteIdentityRowsByUidCaseAlias(
  noteUid: string,
  options?: { notebookId?: string }
): LocalNoteIdentityRow[] {
  const db = getDb()
  const notebookId = options?.notebookId

  if (notebookId) {
    return db.prepare(`
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity
      WHERE note_uid = ? COLLATE NOCASE
        AND notebook_id = ?
      ORDER BY updated_at DESC, note_uid ASC
      LIMIT 2
    `).all(noteUid, notebookId) as LocalNoteIdentityRow[]
  }

  return db.prepare(`
    SELECT note_uid, notebook_id, relative_path, created_at, updated_at
    FROM local_note_identity
    WHERE note_uid = ? COLLATE NOCASE
    ORDER BY updated_at DESC, note_uid ASC
    LIMIT 2
  `).all(noteUid) as LocalNoteIdentityRow[]
}

function repairLocalNoteIdentityRowUidIfNeeded(
  row: LocalNoteIdentityRow,
  options?: { hasInternalNoteId?: (noteId: string) => boolean }
): LocalNoteIdentityRow {
  const db = getDb()
  const hasInternalNoteId = options?.hasInternalNoteId || createHasInternalNoteIdChecker(db)
  if (!needsLocalNoteIdentityUidRepair(row.note_uid, hasInternalNoteId)) {
    return row
  }

  const tx = db.transaction(() => {
    const getByPathStmt = db.prepare(`
      SELECT rowid as source_rowid, note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `)
    const hasByUidStmt = db.prepare(`
      SELECT 1 as ok
      FROM local_note_identity
      WHERE note_uid = ?
      LIMIT 1
    `)
    const updateUidStmt = db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE rowid = ?
    `)

    const current = getByPathStmt.get(
      row.notebook_id,
      row.relative_path
    ) as (LocalNoteIdentityRow & { source_rowid: number }) | undefined
    if (!current) return row
    const currentRepairPlan = resolveLocalNoteIdentityUidRepairPlan(current.note_uid, hasInternalNoteId)
    if (currentRepairPlan.strategy === 'none') {
      return current
    }

    const hasIdentityByUid = (candidateUid: string): boolean => {
      return Boolean((hasByUidStmt.get(candidateUid) as { ok: number } | undefined)?.ok)
    }

    const tryRepairWithUid = (
      candidateUid: string,
      strategy: LocalNoteIdentityUidRepairStrategy
    ): LocalNoteIdentityRow | null => {
      if (!candidateUid || candidateUid === current.note_uid) return null
      if (hasIdentityByUid(candidateUid)) return null
      const updatedAt = new Date().toISOString()
      try {
        const changed = updateUidStmt.run(candidateUid, updatedAt, current.source_rowid).changes
        if (changed <= 0) return null
        const remappedPopupRefs = remapLocalFolderAIPopupRefsNoteUid(current.note_uid, candidateUid)
        emitLocalNoteIdentityUidRepairRowAudit(console, {
          stage: 'runtime',
          strategy,
          notebookId: current.notebook_id,
          relativePath: current.relative_path,
          fromNoteUid: current.note_uid,
          toNoteUid: candidateUid,
          remappedPopupRefs,
        })
        const repaired = getByPathStmt.get(
          row.notebook_id,
          row.relative_path
        ) as LocalNoteIdentityRow | undefined
        return repaired || null
      } catch (error) {
        if (!shouldRetryLocalNoteUidGenerationError(error)) {
          throw error
        }
        return null
      }
    }

    if (currentRepairPlan.strategy === 'normalize') {
      const repaired = tryRepairWithUid(currentRepairPlan.candidateUid, 'normalize')
      if (repaired) return repaired
    }

    return tryUseGeneratedLocalNoteUid({
      hasInternalNoteId,
      isUidUnavailable: hasIdentityByUid,
      tryUseUid: (generatedUid) => tryRepairWithUid(generatedUid, 'regenerate'),
      shouldRetryError: shouldRetryLocalNoteUidGenerationError,
    }) || current
  })

  try {
    return tx()
  } catch (error) {
    emitLocalNoteIdentityUidRepairFailureAudit(console, {
      stage: 'runtime',
      notebookId: row.notebook_id,
      relativePath: row.relative_path,
      noteUid: row.note_uid,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return row
  }
}

function renameLocalNoteIdentityPathInternal(
  notebookId: string,
  fromRelativePath: string,
  toRelativePath: string,
  statements?: LocalNoteIdentityPathStatements
): number {
  const db = getDb()
  const pathStatements = statements || getLocalNoteIdentityPathStatements(db)
  if (fromRelativePath === toRelativePath) return 0
  const source = getLocalNoteIdentityRowByPath(
    notebookId,
    fromRelativePath,
    pathStatements.getByPath
  ) as (LocalNoteIdentityRow & { source_rowid: number }) | null
  if (!source) return 0
  const target = getLocalNoteIdentityRowByPath(
    notebookId,
    toRelativePath,
    pathStatements.getByPath
  ) as (LocalNoteIdentityRow & { source_rowid: number }) | null
  const now = new Date().toISOString()

  if (target && target.source_rowid !== source.source_rowid) {
    pathStatements.deleteByRowId(target.source_rowid)
  }
  const sourceAfterConflictCleanup = getLocalNoteIdentityRowByPath(
    notebookId,
    fromRelativePath,
    pathStatements.getByPath
  ) as (LocalNoteIdentityRow & { source_rowid: number }) | null
  if (!sourceAfterConflictCleanup) return 0
  repairLocalNoteIdentityRowUidIfNeeded(sourceAfterConflictCleanup)

  return pathStatements.updatePathByRowId(
    toRelativePath,
    now,
    sourceAfterConflictCleanup.source_rowid
  )
}

export function listLocalNoteIdentity(
  input?: { notebookIds?: unknown },
  options?: LocalNoteIdentityLookupOptions
): LocalNoteIdentity[] {
  const db = getDb()
  const rawNotebookIds = input?.notebookIds
  const hasExplicitNotebookFilter = hasOwnDefinedProperty(input, 'notebookIds')
  const notebookIds = parseNotebookIdArrayInput(rawNotebookIds)
  if (hasExplicitNotebookFilter && notebookIds.length === 0) {
    return []
  }
  const hasInternalNoteId = shouldRepairLocalNoteIdentityLookup(options)
    ? createHasInternalNoteIdChecker(db)
    : undefined

  if (notebookIds.length > 0) {
    const placeholders = notebookIds.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity
      WHERE notebook_id IN (${placeholders})
      ORDER BY updated_at DESC
    `).all(...notebookIds) as LocalNoteIdentityRow[]
    return rows.map((row) => rowToLocalNoteIdentity(
      maybeRepairLocalNoteIdentityLookupRow(row, options, hasInternalNoteId)
    ))
  }

  const rows = db.prepare(`
    SELECT note_uid, notebook_id, relative_path, created_at, updated_at
    FROM local_note_identity
    ORDER BY updated_at DESC
  `).all() as LocalNoteIdentityRow[]
  return rows.map((row) => rowToLocalNoteIdentity(
    maybeRepairLocalNoteIdentityLookupRow(row, options, hasInternalNoteId)
  ))
}

export function getLocalNoteIdentityByPath(input: {
  notebook_id: string
  relative_path: string
}, options?: LocalNoteIdentityLookupOptions): LocalNoteIdentity | null {
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  const relativePath = normalizeLocalIdentityRelativePath(input.relative_path || '')
  if (!notebookId || !relativePath) return null

  const row = getLocalNoteIdentityRowByPath(notebookId, relativePath)
  return row ? rowToLocalNoteIdentity(maybeRepairLocalNoteIdentityLookupRow(row, options)) : null
}

export function getLocalNoteIdentityByUid(input: {
  note_uid: string
  notebook_id?: string | null
}, options?: LocalNoteIdentityLookupOptions): LocalNoteIdentity | null {
  const noteUid = parseRequiredLocalNoteUidInput(input.note_uid)
  const hasRawNotebookFilter = hasOwnPropertyKey(input, 'notebook_id')
  const rawNotebookId = hasRawNotebookFilter ? input.notebook_id : undefined
  const hasExplicitNotebookFilter = hasOwnDefinedProperty(input, 'notebook_id')
  const notebookId = parseRequiredNotebookIdInput(rawNotebookId)
  if (!noteUid) return null
  if (hasExplicitNotebookFilter && !notebookId) return null

  const row = notebookId
    ? (
      getLocalNoteIdentityRowByUid(noteUid, { notebookId })
      ?? (() => {
        const caseAliasRows = getLocalNoteIdentityRowsByUidCaseAlias(noteUid, { notebookId })
        if (caseAliasRows.length !== 1) return null
        const caseAliasRow = caseAliasRows[0]
        const parsedCaseAliasUid = parseRequiredLocalNoteUidInput(caseAliasRow.note_uid)
        // Preserve opaque non-UUID UID case-sensitivity while accepting UUID case aliases.
        if (parsedCaseAliasUid !== noteUid) return null
        return caseAliasRow
      })()
    )
    : (
      getLocalNoteIdentityRowByUid(noteUid)
      ?? (() => {
        const caseAliasRows = getLocalNoteIdentityRowsByUidCaseAlias(noteUid)
        if (caseAliasRows.length !== 1) return null
        const caseAliasRow = caseAliasRows[0]
        const parsedCaseAliasUid = parseRequiredLocalNoteUidInput(caseAliasRow.note_uid)
        // Preserve opaque non-UUID UID case-sensitivity while accepting UUID case aliases.
        if (parsedCaseAliasUid !== noteUid) return null
        return caseAliasRow
      })()
    )
  if (!row) return null
  const normalizedRow = maybeRepairLocalNoteIdentityLookupRow(row, options)
  return rowToLocalNoteIdentity(normalizedRow)
}

export function ensureLocalNoteIdentity(input: {
  notebook_id: string
  relative_path: string
}): LocalNoteIdentity | null {
  const db = getDb()
  const pathStatements = getLocalNoteIdentityPathStatements(db)
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  const relativePath = normalizeLocalIdentityRelativePath(input.relative_path || '')
  if (!notebookId || !relativePath) return null
  if (!isLocalFolderNotebookId(notebookId)) return null
  const hasInternalNoteId = createHasInternalNoteIdChecker(db)

  const existing = getLocalNoteIdentityRowByPath(notebookId, relativePath, pathStatements.getByPath)
  if (existing) {
    return rowToLocalNoteIdentity(repairLocalNoteIdentityRowUidIfNeeded(existing, { hasInternalNoteId }))
  }

  const now = new Date().toISOString()
  const upsertStmt = db.prepare(`
    INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(notebook_id, relative_path) DO UPDATE SET
      updated_at = excluded.updated_at
  `)

  const tx = db.transaction((): LocalNoteIdentityRow => {
    const created = tryUseGeneratedLocalNoteUid({
      hasInternalNoteId,
      shouldRetryError: shouldRetryLocalNoteUidGenerationError,
      tryUseUid: (generatedUid) => {
        upsertStmt.run(generatedUid, notebookId, relativePath, now, now)
        const row = getLocalNoteIdentityRowByPath(notebookId, relativePath, pathStatements.getByPath)
        if (row) return row
        throw new Error(`Failed to read local note uid after insert for ${notebookId}:${relativePath}`)
      },
    })
    if (created) return created
    const row = getLocalNoteIdentityRowByPath(notebookId, relativePath, pathStatements.getByPath)
    if (row) return row
    throw new Error(`Failed to generate unique local note uid for ${notebookId}:${relativePath}`)
  })

  return rowToLocalNoteIdentity(repairLocalNoteIdentityRowUidIfNeeded(tx(), { hasInternalNoteId }))
}

export function ensureLocalNoteIdentitiesBatch(input: {
  notebook_id: string
  relative_paths: readonly string[]
}): Map<string, LocalNoteIdentity> {
  const db = getDb()
  const pathStatements = getLocalNoteIdentityPathStatements(db)
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  if (!notebookId) return new Map()
  if (!isLocalFolderNotebookId(notebookId)) return new Map()

  const uniquePaths: string[] = []
  const seenPaths = new Set<string>()
  for (const relativePath of input.relative_paths || []) {
    const normalized = normalizeLocalIdentityRelativePath(relativePath || '')
    if (!normalized || seenPaths.has(normalized)) continue
    seenPaths.add(normalized)
    uniquePaths.push(normalized)
  }
  if (uniquePaths.length === 0) return new Map()
  const hasInternalNoteId = createHasInternalNoteIdChecker(db)

  const ensuredByPath = new Map<string, LocalNoteIdentity>()
  for (let offset = 0; offset < uniquePaths.length; offset += LOCAL_NOTE_IDENTITY_BATCH_SELECT_CHUNK_SIZE) {
    const chunk = uniquePaths.slice(offset, offset + LOCAL_NOTE_IDENTITY_BATCH_SELECT_CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity
      WHERE notebook_id = ?
        AND relative_path IN (${placeholders})
    `).all(notebookId, ...chunk) as LocalNoteIdentityRow[]
    for (const row of rows) {
      const normalizedRow = repairLocalNoteIdentityRowUidIfNeeded(row, { hasInternalNoteId })
      ensuredByPath.set(normalizedRow.relative_path, rowToLocalNoteIdentity(normalizedRow))
    }
  }

  const missingPaths = uniquePaths.filter((path) => !ensuredByPath.has(path))
  if (missingPaths.length === 0) return ensuredByPath

  const now = new Date().toISOString()
  const upsertStmt = db.prepare(`
    INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(notebook_id, relative_path) DO UPDATE SET
      updated_at = excluded.updated_at
  `)

  const tx = db.transaction(() => {
    for (const missingPath of missingPaths) {
      const upserted = tryUseGeneratedLocalNoteUid({
        hasInternalNoteId,
        shouldRetryError: shouldRetryLocalNoteUidGenerationError,
        tryUseUid: (generatedUid) => {
          upsertStmt.run(generatedUid, notebookId, missingPath, now, now)
          return true
        },
      })
      if (upserted) continue
      const row = getLocalNoteIdentityRowByPath(notebookId, missingPath, pathStatements.getByPath)
      if (row) continue
      throw new Error(`Failed to generate unique local note uid for ${notebookId}:${missingPath}`)
    }
  })

  tx()
  for (let offset = 0; offset < missingPaths.length; offset += LOCAL_NOTE_IDENTITY_BATCH_SELECT_CHUNK_SIZE) {
    const chunk = missingPaths.slice(offset, offset + LOCAL_NOTE_IDENTITY_BATCH_SELECT_CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity
      WHERE notebook_id = ?
        AND relative_path IN (${placeholders})
    `).all(notebookId, ...chunk) as LocalNoteIdentityRow[]
    for (const row of rows) {
      const normalizedRow = repairLocalNoteIdentityRowUidIfNeeded(row, { hasInternalNoteId })
      ensuredByPath.set(normalizedRow.relative_path, rowToLocalNoteIdentity(normalizedRow))
    }
  }

  return ensuredByPath
}

export function renameLocalNoteIdentityPath(input: {
  notebook_id: string
  from_relative_path: string
  to_relative_path: string
}): number {
  const db = getDb()
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  const fromRelativePath = normalizeLocalIdentityRelativePath(input.from_relative_path || '')
  const toRelativePath = normalizeLocalIdentityRelativePath(input.to_relative_path || '')
  if (!notebookId || !fromRelativePath || !toRelativePath) return 0
  if (fromRelativePath === toRelativePath) return 0

  const tx = db.transaction(() => {
    const pathStatements = getLocalNoteIdentityPathStatements(db)
    return renameLocalNoteIdentityPathInternal(
      notebookId,
      fromRelativePath,
      toRelativePath,
      pathStatements
    )
  })
  return tx()
}

export function moveLocalNoteIdentity(input: {
  from_notebook_id: string
  from_relative_path: string
  to_notebook_id: string
  to_relative_path: string
}): number {
  const db = getDb()
  const fromNotebookId = parseRequiredNotebookIdInput(input.from_notebook_id)
  const toNotebookId = parseRequiredNotebookIdInput(input.to_notebook_id)
  const fromRelativePath = normalizeLocalIdentityRelativePath(input.from_relative_path || '')
  const toRelativePath = normalizeLocalIdentityRelativePath(input.to_relative_path || '')
  if (!fromNotebookId || !toNotebookId || !fromRelativePath || !toRelativePath) return 0

  if (fromNotebookId === toNotebookId) {
    return renameLocalNoteIdentityPath({
      notebook_id: fromNotebookId,
      from_relative_path: fromRelativePath,
      to_relative_path: toRelativePath,
    })
  }

  const tx = db.transaction(() => {
    const pathStatements = getLocalNoteIdentityPathStatements(db)
    const source = getLocalNoteIdentityRowByPath(
      fromNotebookId,
      fromRelativePath,
      pathStatements.getByPath
    ) as (LocalNoteIdentityRow & { source_rowid: number }) | null
    if (!source) return 0

    const target = getLocalNoteIdentityRowByPath(
      toNotebookId,
      toRelativePath,
      pathStatements.getByPath
    ) as (LocalNoteIdentityRow & { source_rowid: number }) | null
    if (target && target.source_rowid !== source.source_rowid) {
      pathStatements.deleteByRowId(target.source_rowid)
    }
    const sourceAfterConflictCleanup = getLocalNoteIdentityRowByPath(
      fromNotebookId,
      fromRelativePath,
      pathStatements.getByPath
    ) as (LocalNoteIdentityRow & { source_rowid: number }) | null
    if (!sourceAfterConflictCleanup) return 0
    repairLocalNoteIdentityRowUidIfNeeded(sourceAfterConflictCleanup)

    const now = new Date().toISOString()
    return pathStatements.updateNotebookPathByRowId(
      toNotebookId,
      toRelativePath,
      now,
      sourceAfterConflictCleanup.source_rowid
    )
  })

  return tx()
}

export function renameLocalNoteIdentityFolderPath(input: {
  notebook_id: string
  from_relative_folder_path: string
  to_relative_folder_path: string
}): number {
  const db = getDb()
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  const fromFolderPath = normalizeLocalIdentityRelativePath(input.from_relative_folder_path || '')
  const toFolderPath = normalizeLocalIdentityRelativePath(input.to_relative_folder_path || '')
  if (!notebookId || !fromFolderPath || !toFolderPath) return 0
  if (fromFolderPath === toFolderPath) return 0
  if (toFolderPath.startsWith(`${fromFolderPath}/`)) return 0

  const tx = db.transaction(() => {
    const prefixLike = escapeLikePrefix(fromFolderPath)
    const affectedRows = db.prepare(`
      SELECT relative_path
      FROM local_note_identity
      WHERE notebook_id = ?
        AND (relative_path = ? OR relative_path ${LIKE_ESCAPE})
      ORDER BY LENGTH(relative_path) ASC, relative_path ASC
    `).all(notebookId, fromFolderPath, prefixLike) as Array<{ relative_path: string }>
    if (affectedRows.length === 0) return 0
    const pathStatements = getLocalNoteIdentityPathStatements(db)
    let changes = 0
    for (const row of affectedRows) {
      const suffix = row.relative_path === fromFolderPath
        ? ''
        : row.relative_path.slice(fromFolderPath.length + 1)
      const nextPath = suffix ? `${toFolderPath}/${suffix}` : toFolderPath
      changes += renameLocalNoteIdentityPathInternal(
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

export function deleteLocalNoteIdentityByPath(input: {
  notebook_id: string
  relative_path: string
  kind: 'file' | 'folder'
}): number {
  const db = getDb()
  const notebookId = parseRequiredNotebookIdInput(input.notebook_id)
  const relativePath = normalizeLocalIdentityRelativePath(input.relative_path || '')
  if (!notebookId || !relativePath) return 0

  if (input.kind === 'file') {
    const result = db.prepare(`
      DELETE FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).run(notebookId, relativePath)
    return result.changes
  }

  const prefixLike = escapeLikePrefix(relativePath)
  const result = db.prepare(`
    DELETE FROM local_note_identity
    WHERE notebook_id = ?
      AND (relative_path = ? OR relative_path ${LIKE_ESCAPE})
  `).run(notebookId, relativePath, prefixLike)
  return result.changes
}
