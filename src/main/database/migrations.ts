import { getDb } from './connection'
import {
  buildCanonicalComparePath,
  compareLocalFolderMountPriority,
  tableExists,
} from './helpers'
import type { LocalFolderMountRowLike } from './helpers'
import { createLocalFolderAIPopupRefUidRemapper } from './local-folder-ai-popup-ref-remapper'
import { generateLocalNoteUid } from '../local-note-uid-generation'
import { resolveLocalNoteIdentityUidRepairPlan } from '../local-note-identity-uid-repair'
import { emitLocalNoteIdentityUidRepairSummaryAudit } from '../local-note-identity-audit'
import type { NotebookStatus } from '../../shared/types'

const DETACHED_FOLDER_PATH_MIGRATION_SETTING_KEY = 'migration.detached-folder-path.v1'
const FRONTMATTER_NODE_MIGRATION_SETTING_KEY = 'migration.frontmatter-node.v1'
const LOCAL_NOTE_UID_REPAIR_MIGRATION_SETTING_KEY = 'migration.local-note-uid-repair.v1'
const MIGRATION_LOCAL_NOTE_UID_MAX_GENERATION_ATTEMPTS = 64
const MIGRATION_LOCAL_NOTE_UID_REPAIR_BATCH_SIZE = 300
const MIGRATION_LOCAL_NOTE_UID_REPAIR_SNAPSHOT_TABLE = 'temp_local_note_identity_uid_repair_queue'

interface LocalNoteIdentityUidRepairMigrationSummary {
  normalizedUidRows: number
  regeneratedUidRows: number
  mergedAliasRows: number
  removedInvalidUidRows: number
  remappedPopupRefs: number
  skippedPopupRefRemapRows: number
  removedPopupRefs: number
  unresolvedRows: number
}

function createEmptyLocalNoteIdentityUidRepairMigrationSummary(): LocalNoteIdentityUidRepairMigrationSummary {
  return {
    normalizedUidRows: 0,
    regeneratedUidRows: 0,
    mergedAliasRows: 0,
    removedInvalidUidRows: 0,
    remappedPopupRefs: 0,
    skippedPopupRefRemapRows: 0,
    removedPopupRefs: 0,
    unresolvedRows: 0,
  }
}

function parseStoredLocalNoteUidRepairMigrationMeta(
  value: string
): LocalNoteIdentityUidRepairMigrationSummary | null {
  try {
    const parsed = JSON.parse(value) as Partial<LocalNoteIdentityUidRepairMigrationSummary> | null
    if (!parsed || typeof parsed !== 'object') return null
    const normalizedUidRows = Number(parsed.normalizedUidRows)
    const regeneratedUidRows = Number(parsed.regeneratedUidRows)
    const mergedAliasRows = Number(parsed.mergedAliasRows)
    const removedInvalidUidRows = Number(parsed.removedInvalidUidRows)
    const remappedPopupRefs = Number(parsed.remappedPopupRefs)
    const skippedPopupRefRemapRows = (
      parsed.skippedPopupRefRemapRows === undefined
      || parsed.skippedPopupRefRemapRows === null
    )
      ? 0
      : Number(parsed.skippedPopupRefRemapRows)
    const removedPopupRefs = Number(parsed.removedPopupRefs)
    const unresolvedRows = Number(parsed.unresolvedRows)
    const fields = [
      normalizedUidRows,
      regeneratedUidRows,
      mergedAliasRows,
      removedInvalidUidRows,
      remappedPopupRefs,
      skippedPopupRefRemapRows,
      removedPopupRefs,
      unresolvedRows,
    ]
    if (!fields.every((field) => Number.isFinite(field) && field >= 0)) {
      return null
    }
    return {
      normalizedUidRows,
      regeneratedUidRows,
      mergedAliasRows,
      removedInvalidUidRows,
      remappedPopupRefs,
      skippedPopupRefRemapRows,
      removedPopupRefs,
      unresolvedRows,
    }
  } catch {
    return null
  }
}

export function migrateNotebooksSourceType(
  notebookColumns: Array<{ name: string }>,
  execSql: (sql: string) => void,
  log: (message: string) => void = () => {}
): void {
  const hasSourceType = notebookColumns.some((column) => column.name === 'source_type')

  if (!hasSourceType) {
    log('Adding source_type column to notebooks table...')
    execSql("ALTER TABLE notebooks ADD COLUMN source_type TEXT NOT NULL DEFAULT 'internal'")
    log('Migration completed: source_type column added.')
  }

  execSql('CREATE INDEX IF NOT EXISTS idx_notebooks_source_type ON notebooks(source_type)')
  execSql(`
    UPDATE notebooks
    SET source_type = 'internal'
    WHERE source_type IS NULL
      OR TRIM(source_type) = ''
      OR source_type NOT IN ('internal', 'local-folder')
  `)
  execSql(`
    CREATE TRIGGER IF NOT EXISTS trg_notebooks_source_type_validate_insert
    BEFORE INSERT ON notebooks
    FOR EACH ROW
    WHEN NEW.source_type NOT IN ('internal', 'local-folder')
    BEGIN
      SELECT RAISE(ABORT, 'invalid notebooks.source_type');
    END;
  `)
  execSql(`
    CREATE TRIGGER IF NOT EXISTS trg_notebooks_source_type_validate_update
    BEFORE UPDATE OF source_type ON notebooks
    FOR EACH ROW
    WHEN NEW.source_type NOT IN ('internal', 'local-folder')
    BEGIN
      SELECT RAISE(ABORT, 'invalid notebooks.source_type');
    END;
  `)
}

export function migrateNotesIsPinned(
  noteColumns: Array<{ name: string }>,
  execSql: (sql: string) => void,
  log: (message: string) => void = () => {}
): void {
  const hasIsPinned = noteColumns.some((column) => column.name === 'is_pinned')
  if (!hasIsPinned) {
    log('Adding is_pinned column to notes table...')
    execSql('ALTER TABLE notes ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0')
    log('Migration completed: is_pinned column added.')
  }

  execSql('CREATE INDEX IF NOT EXISTS idx_notes_is_pinned ON notes(is_pinned)')
}

export function migrateNotesDeletedAt(
  noteColumns: Array<{ name: string }>,
  execSql: (sql: string) => void,
  log: (message: string) => void = () => {}
): void {
  const hasDeletedAt = noteColumns.some((column) => column.name === 'deleted_at')
  if (!hasDeletedAt) {
    log('Adding deleted_at column to notes table...')
    execSql('ALTER TABLE notes ADD COLUMN deleted_at TEXT DEFAULT NULL')
    log('Migration completed: deleted_at column added.')
  }

  execSql('CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at)')
}

export function migrateNotesFolderPath(
  noteColumns: Array<{ name: string }>,
  execSql: (sql: string) => void,
  log: (message: string) => void = () => {}
): void {
  const hasFolderPath = noteColumns.some((column) => column.name === 'folder_path')
  if (!hasFolderPath) {
    log('Adding folder_path column to notes table...')
    execSql('ALTER TABLE notes ADD COLUMN folder_path TEXT DEFAULT NULL')
    log('Migration completed: folder_path column added.')
  }

  execSql('CREATE INDEX IF NOT EXISTS idx_notes_folder_path ON notes(folder_path)')
  execSql('CREATE INDEX IF NOT EXISTS idx_notes_notebook_folder_path ON notes(notebook_id, folder_path)')
}

/**
 * Repair legacy/dirty rows where detached notes still keep an internal folder path.
 */
export function migrateNotesDetachedFolderPath(
  execSql: (sql: string) => void,
  log: (message: string) => void = () => {}
): void {
  log('Repairing detached notes with stale folder_path...')
  execSql('UPDATE notes SET folder_path = NULL WHERE notebook_id IS NULL AND folder_path IS NOT NULL')
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Convert legacy leading codeBlock(language=yaml-frontmatter) to frontmatter node.
 * Returns null when no migration should be applied.
 */
export function migrateLegacyFrontmatterDocContent(content: string): string | null {
  if (typeof content !== 'string' || content.length === 0) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  const doc = asPlainObject(parsed)
  if (!doc || doc.type !== 'doc') {
    return null
  }

  const nodes = Array.isArray(doc.content) ? doc.content : null
  if (!nodes || nodes.length === 0) {
    return null
  }

  const firstNode = asPlainObject(nodes[0])
  if (!firstNode || firstNode.type === 'frontmatter') {
    return null
  }
  if (firstNode.type !== 'codeBlock') {
    return null
  }

  const attrs = asPlainObject(firstNode.attrs)
  const language = typeof attrs?.language === 'string' ? attrs.language : ''
  if (language !== 'yaml-frontmatter') {
    return null
  }

  const migratedFirstNode: Record<string, unknown> = {
    ...firstNode,
    type: 'frontmatter',
  }

  if (attrs) {
    const restAttrs = { ...attrs }
    delete restAttrs.language
    if (Object.keys(restAttrs).length > 0) {
      migratedFirstNode.attrs = restAttrs
    } else {
      delete migratedFirstNode.attrs
    }
  }

  const migratedNodes = [...nodes]
  migratedNodes[0] = migratedFirstNode

  const migratedDoc: Record<string, unknown> = {
    ...doc,
    content: migratedNodes,
  }

  return JSON.stringify(migratedDoc)
}

export function collectLegacyFrontmatterContentUpdates(
  notes: Array<{ id: string; content: string }>
): Array<{ id: string; content: string }> {
  const updates: Array<{ id: string; content: string }> = []

  for (const note of notes) {
    const migratedContent = migrateLegacyFrontmatterDocContent(note.content)
    if (!migratedContent) continue
    updates.push({ id: note.id, content: migratedContent })
  }

  return updates
}

function hasLegacyCanonicalRootUniqueLocalFolderMountConstraint(): boolean {
  const db = getDb()
  const tableSqlRow = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name = 'local_folder_mounts'
  `).get() as { sql: string | null } | undefined
  const tableSql = (tableSqlRow?.sql || '').toLowerCase().replace(/\s+/g, ' ')
  if (!tableSql) return false

  return (
    tableSql.includes('canonical_root_path text not null unique')
    || tableSql.includes('unique (canonical_root_path')
    || tableSql.includes('unique(canonical_root_path')
  )
}

function rebuildLocalFolderMountsWithoutHardUniqueConstraint(): void {
  const db = getDb()
  const now = new Date().toISOString()
  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE local_folder_mounts_rebuild (
        notebook_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        canonical_root_path TEXT NOT NULL,
        canonical_compare_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'permission_required', 'missing')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
    `)

    db.prepare(`
      INSERT INTO local_folder_mounts_rebuild (
        notebook_id,
        root_path,
        canonical_root_path,
        canonical_compare_path,
        status,
        created_at,
        updated_at
      )
      SELECT
        notebook_id,
        root_path,
        canonical_root_path,
        canonical_compare_path,
        CASE
          WHEN status IN ('active', 'permission_required', 'missing') THEN status
          WHEN status IS NULL OR TRIM(status) = '' THEN 'active'
          ELSE 'missing'
        END,
        COALESCE(NULLIF(created_at, ''), ?),
        COALESCE(NULLIF(updated_at, ''), ?)
      FROM local_folder_mounts
    `).run(now, now)

    db.exec(`
      DROP TABLE local_folder_mounts;
      ALTER TABLE local_folder_mounts_rebuild RENAME TO local_folder_mounts;
    `)
  })

  rebuild()
}

function warnDuplicateCanonicalLocalFolderMountGroups(): void {
  const db = getDb()
  const duplicateGroups = db.prepare(`
    SELECT
      canonical_compare_path,
      COUNT(*) AS duplicate_count,
      GROUP_CONCAT(notebook_id, ',') AS notebook_ids,
      GROUP_CONCAT(status, ',') AS statuses
    FROM local_folder_mounts
    GROUP BY canonical_compare_path
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC, canonical_compare_path ASC
    LIMIT 10
  `).all() as Array<{
    canonical_compare_path: string
    duplicate_count: number
    notebook_ids: string | null
    statuses: string | null
  }>

  if (duplicateGroups.length === 0) return

  const sample = duplicateGroups.map((group) => ({
    canonical_compare_path: group.canonical_compare_path,
    duplicate_count: group.duplicate_count,
    notebook_ids: (group.notebook_ids || '').split(',').filter(Boolean),
    statuses: (group.statuses || '').split(',').filter(Boolean),
  }))

  console.warn(
    `[Database] Found ${duplicateGroups.length} duplicate canonical local-folder mount group(s).`,
    sample
  )
}

function reconcileLocalFolderMountNotebookOwnership(options?: {
  logInvalidRemoval?: boolean
  allowNotebookPromotion?: boolean
}): void {
  const db = getDb()
  const logInvalidRemoval = options?.logInvalidRemoval !== false
  const allowNotebookPromotion = options?.allowNotebookPromotion !== false

  if (allowNotebookPromotion) {
    // Legacy repair (one-way): when source_type did not exist historically, all
    // notebooks default to "internal". Promote mount owners to local-folder.
    db.exec(`
      UPDATE notebooks
      SET source_type = 'local-folder'
      WHERE id IN (SELECT notebook_id FROM local_folder_mounts)
        AND source_type <> 'local-folder'
    `)
  }

  // Legacy repair: remove orphaned/invalid mount rows that no longer map to a
  // local-folder notebook. These rows can cause invisible canonical conflicts.
  const removedInvalidMountRows = db.prepare(`
    DELETE FROM local_folder_mounts
    WHERE notebook_id NOT IN (
      SELECT id
      FROM notebooks
      WHERE source_type = 'local-folder'
    )
  `).run().changes
  if (logInvalidRemoval && removedInvalidMountRows > 0) {
    console.warn(`[Database] Removed ${removedInvalidMountRows} invalid local-folder mount row(s).`)
  }
}

interface LocalFolderDuplicateNotebookRemap {
  winnerNotebookId: string
  duplicateNotebookId: string
}

interface DuplicateNotebookMetadataRow {
  relative_path: string
  is_favorite: number
  is_pinned: number
  ai_summary: string | null
  summary_content_hash: string | null
  tags_json: string | null
  ai_tags_json: string | null
  updated_at: string
}

interface DuplicateNotebookIdentityRow {
  source_rowid: number
  note_uid: string
  relative_path: string
  updated_at: string
}

interface DuplicateNotebookMetadataMigrationContext {
  selectSourceRows: (notebookId: string) => DuplicateNotebookMetadataRow[]
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
  }) => void
  deleteByNotebook: (notebookId: string) => void
}

interface DuplicateNotebookIdentityMigrationContext {
  hasAiPopupRefs: boolean
  selectSourceRows: (notebookId: string) => DuplicateNotebookIdentityRow[]
  moveByRowId: (notebookId: string, updatedAt: string, sourceRowId: number) => number
  updateUpdatedAtByRowId: (updatedAt: string, sourceRowId: number) => number
  deleteByRowId: (sourceRowId: number) => number
  deleteByNotebook: (notebookId: string) => void
  remapLocalPopupRefsByUid: (fromUid: string, toUid: string) => number
}

function parseMigrationTagsJson(tagsJson: string | null | undefined): string[] {
  if (!tagsJson) return []
  try {
    const parsed = JSON.parse(tagsJson)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        if (typeof item === 'string') return item.trim()
        if (!item || typeof item !== 'object') return ''
        const maybeName = (item as { name?: unknown }).name
        return typeof maybeName === 'string' ? maybeName.trim() : ''
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function mergeMigrationTagLists(...lists: string[][]): string[] {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    for (const tag of list) {
      const normalized = tag.trim()
      if (!normalized) continue
      const key = normalized.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(normalized)
    }
  }
  return merged
}

function pickLatestIsoTimestamp(...values: Array<string | null | undefined>): string {
  let latest: string | null = null
  let latestTs = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!value) continue
    const ts = Date.parse(value)
    if (!Number.isFinite(ts)) continue
    if (ts > latestTs) {
      latestTs = ts
      latest = value
    }
  }
  return latest || new Date().toISOString()
}

function pickEarliestIsoTimestamp(...values: Array<string | null | undefined>): string {
  let earliest: string | null = null
  let earliestTs = Number.POSITIVE_INFINITY
  for (const value of values) {
    if (!value) continue
    const ts = Date.parse(value)
    if (!Number.isFinite(ts)) continue
    if (ts < earliestTs) {
      earliestTs = ts
      earliest = value
    }
  }
  return earliest || new Date().toISOString()
}

function createDuplicateNotebookMetadataMigrationContext(
  db: ReturnType<typeof getDb>
): DuplicateNotebookMetadataMigrationContext {
  const selectSourceRowsStmt = db.prepare(`
    SELECT
      relative_path,
      is_favorite,
      is_pinned,
      ai_summary,
      summary_content_hash,
      tags_json,
      ai_tags_json,
      updated_at
    FROM local_note_metadata
    WHERE notebook_id = ?
    ORDER BY updated_at DESC, relative_path ASC
  `)
  const upsertMergedStmt = db.prepare(`
    INSERT INTO local_note_metadata (
      notebook_id,
      relative_path,
      is_favorite,
      is_pinned,
      ai_summary,
      summary_content_hash,
      tags_json,
      ai_tags_json,
      updated_at
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
  const deleteByNotebookStmt = db.prepare(`
    DELETE FROM local_note_metadata
    WHERE notebook_id = ?
  `)

  return {
    selectSourceRows: (notebookId) => {
      return selectSourceRowsStmt.all(notebookId) as DuplicateNotebookMetadataRow[]
    },
    upsertMerged: (input) => {
      upsertMergedStmt.run(
        input.notebookId,
        input.relativePath,
        input.isFavorite,
        input.isPinned,
        input.aiSummary,
        input.summaryContentHash,
        input.tagsJson,
        input.aiTagsJson,
        input.updatedAt
      )
    },
    deleteByNotebook: (notebookId) => {
      deleteByNotebookStmt.run(notebookId)
    },
  }
}

function createDuplicateNotebookIdentityMigrationContext(
  db: ReturnType<typeof getDb>,
  hasAiPopupRefs: boolean
): DuplicateNotebookIdentityMigrationContext {
  const selectSourceRowsStmt = db.prepare(`
    SELECT rowid as source_rowid, note_uid, relative_path, updated_at
    FROM local_note_identity
    WHERE notebook_id = ?
    ORDER BY updated_at DESC, note_uid ASC
  `)
  const moveByRowIdStmt = db.prepare(`
    UPDATE local_note_identity
    SET notebook_id = ?, updated_at = ?
    WHERE rowid = ?
  `)
  const updateUpdatedAtByRowIdStmt = db.prepare(`
    UPDATE local_note_identity
    SET updated_at = ?
    WHERE rowid = ?
  `)
  const deleteByRowIdStmt = db.prepare(`
    DELETE FROM local_note_identity
    WHERE rowid = ?
  `)
  const deleteByNotebookStmt = db.prepare(`
    DELETE FROM local_note_identity
    WHERE notebook_id = ?
  `)

  return {
    hasAiPopupRefs,
    selectSourceRows: (notebookId) => {
      return selectSourceRowsStmt.all(notebookId) as DuplicateNotebookIdentityRow[]
    },
    moveByRowId: (notebookId, updatedAt, sourceRowId) => {
      return moveByRowIdStmt.run(notebookId, updatedAt, sourceRowId).changes
    },
    updateUpdatedAtByRowId: (updatedAt, sourceRowId) => {
      return updateUpdatedAtByRowIdStmt.run(updatedAt, sourceRowId).changes
    },
    deleteByRowId: (sourceRowId) => {
      return deleteByRowIdStmt.run(sourceRowId).changes
    },
    deleteByNotebook: (notebookId) => {
      deleteByNotebookStmt.run(notebookId)
    },
    remapLocalPopupRefsByUid: createLocalFolderAIPopupRefUidRemapper(hasAiPopupRefs),
  }
}

function buildDuplicateNotebookMetadataRowMap(
  rows: readonly DuplicateNotebookMetadataRow[]
): Map<string, DuplicateNotebookMetadataRow> {
  const byPath = new Map<string, DuplicateNotebookMetadataRow>()
  for (const row of rows) {
    if (!byPath.has(row.relative_path)) {
      byPath.set(row.relative_path, row)
    }
  }
  return byPath
}

function buildDuplicateNotebookIdentityRowMap(
  rows: readonly DuplicateNotebookIdentityRow[]
): Map<string, DuplicateNotebookIdentityRow> {
  const byPath = new Map<string, DuplicateNotebookIdentityRow>()
  for (const row of rows) {
    if (!byPath.has(row.relative_path)) {
      byPath.set(row.relative_path, row)
    }
  }
  return byPath
}

function repairLocalNoteIdentityNoteUidRows(): LocalNoteIdentityUidRepairMigrationSummary {
  if (!tableExists('local_note_identity')) {
    return createEmptyLocalNoteIdentityUidRepairMigrationSummary()
  }
  const db = getDb()
  const hasAiPopupRefs = tableExists('ai_popup_refs')

  const run = db.transaction(() => {
    db.exec(`DROP TABLE IF EXISTS ${MIGRATION_LOCAL_NOTE_UID_REPAIR_SNAPSHOT_TABLE}`)
    db.exec(`
      CREATE TEMP TABLE ${MIGRATION_LOCAL_NOTE_UID_REPAIR_SNAPSHOT_TABLE} (
        queue_id INTEGER PRIMARY KEY,
        source_rowid INTEGER NOT NULL,
        note_uid TEXT NOT NULL
      )
    `)
    db.exec(`
      INSERT INTO ${MIGRATION_LOCAL_NOTE_UID_REPAIR_SNAPSHOT_TABLE} (source_rowid, note_uid)
      SELECT rowid, note_uid
      FROM local_note_identity
      ORDER BY updated_at DESC, note_uid ASC, rowid ASC
    `)
    const selectSnapshotBatchStmt = db.prepare(`
      SELECT queue_id, source_rowid
      FROM ${MIGRATION_LOCAL_NOTE_UID_REPAIR_SNAPSHOT_TABLE}
      WHERE queue_id > ?
      ORDER BY queue_id ASC
      LIMIT ?
    `)
    const countSnapshotRowsByUidStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM ${MIGRATION_LOCAL_NOTE_UID_REPAIR_SNAPSHOT_TABLE}
      WHERE note_uid = ?
    `)
    const hasInternalNoteIdStmt = db.prepare(`
      SELECT 1 as ok
      FROM notes
      WHERE id = ?
      LIMIT 1
    `)
    const getByRowIdStmt = db.prepare(`
      SELECT rowid as source_rowid, note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity
      WHERE rowid = ?
      LIMIT 1
    `)
    const getByUidStmt = db.prepare(`
      SELECT rowid as source_rowid, note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity
      WHERE note_uid = ?
      ORDER BY rowid ASC
      LIMIT 1
    `)
    const countByUidStmt = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_note_identity
      WHERE note_uid = ?
    `)
    const hasIdentityByUidStmt = db.prepare(`
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
    const updateTimestampsStmt = db.prepare(`
      UPDATE local_note_identity
      SET created_at = ?, updated_at = ?
      WHERE rowid = ?
    `)
    const deleteByRowIdStmt = db.prepare(`
      DELETE FROM local_note_identity
      WHERE rowid = ?
    `)
    const remapLocalPopupRefsByUid = createLocalFolderAIPopupRefUidRemapper(hasAiPopupRefs)
    const hasInternalNoteId = (candidateNoteId: string): boolean => {
      return Boolean((hasInternalNoteIdStmt.get(candidateNoteId) as { ok: number } | undefined)?.ok)
    }

    let normalizedUidRows = 0
    let regeneratedUidRows = 0
    let mergedAliasRows = 0
    const removedInvalidUidRows = 0
    let remappedPopupRefs = 0
    let skippedPopupRefRemapRows = 0
    const removedPopupRefs = 0
    let unresolvedRows = 0

    let lastQueueId = 0
    while (true) {
      const snapshotRows = selectSnapshotBatchStmt.all(
        lastQueueId,
        MIGRATION_LOCAL_NOTE_UID_REPAIR_BATCH_SIZE
      ) as Array<{
        queue_id: number
        source_rowid: number
      }>
      if (snapshotRows.length === 0) {
        break
      }

      for (const snapshotRow of snapshotRows) {
        lastQueueId = snapshotRow.queue_id
        const current = getByRowIdStmt.get(snapshotRow.source_rowid) as {
          source_rowid: number
          note_uid: string
          notebook_id: string
          relative_path: string
          created_at: string
          updated_at: string
        } | undefined
        if (!current) continue
        const sourceUidRowCount = (
          countByUidStmt.get(current.note_uid) as { count: number } | undefined
        )?.count || 0
        const snapshotUidRowCount = (
          countSnapshotRowsByUidStmt.get(current.note_uid) as { count: number } | undefined
        )?.count || 0
        const canSafelyRemapPopupRefs = (
          hasAiPopupRefs
          && sourceUidRowCount <= 1
          && snapshotUidRowCount <= 1
        )

        const repairPlan = resolveLocalNoteIdentityUidRepairPlan(current.note_uid, hasInternalNoteId)
        if (repairPlan.strategy === 'none') {
          continue
        }

        if (repairPlan.strategy === 'regenerate') {
          const generatedUid = generateLocalNoteUid({
            hasInternalNoteId,
            maxAttempts: MIGRATION_LOCAL_NOTE_UID_MAX_GENERATION_ATTEMPTS,
            isUidUnavailable: (candidateUid) => {
              return Boolean((hasIdentityByUidStmt.get(candidateUid) as { ok: number } | undefined)?.ok)
            },
          })
          if (!generatedUid) {
            unresolvedRows += 1
            continue
          }
          const changed = updateUidStmt.run(
            generatedUid,
            pickLatestIsoTimestamp(current.updated_at),
            current.source_rowid
          ).changes
          regeneratedUidRows += changed
          if (changed > 0 && canSafelyRemapPopupRefs) {
            remappedPopupRefs += remapLocalPopupRefsByUid(current.note_uid, generatedUid)
          } else if (changed > 0 && hasAiPopupRefs) {
            skippedPopupRefRemapRows += 1
          }
          continue
        }

        const target = getByUidStmt.get(repairPlan.candidateUid) as {
          source_rowid: number
          note_uid: string
          notebook_id: string
          relative_path: string
          created_at: string
          updated_at: string
        } | undefined

        if (!target) {
          const updatedAt = pickLatestIsoTimestamp(current.updated_at)
          const changed = updateUidStmt.run(repairPlan.candidateUid, updatedAt, current.source_rowid).changes
          normalizedUidRows += changed
          if (changed > 0 && canSafelyRemapPopupRefs) {
            remappedPopupRefs += remapLocalPopupRefsByUid(current.note_uid, repairPlan.candidateUid)
          } else if (changed > 0 && hasAiPopupRefs) {
            skippedPopupRefRemapRows += 1
          }
          continue
        }

        if (target.notebook_id === current.notebook_id && target.relative_path === current.relative_path) {
          if (canSafelyRemapPopupRefs) {
            remappedPopupRefs += remapLocalPopupRefsByUid(current.note_uid, target.note_uid)
          } else if (hasAiPopupRefs) {
            skippedPopupRefRemapRows += 1
          }
          const mergedCreatedAt = pickEarliestIsoTimestamp(target.created_at, current.created_at)
          const mergedUpdatedAt = pickLatestIsoTimestamp(target.updated_at, current.updated_at)
          updateTimestampsStmt.run(mergedCreatedAt, mergedUpdatedAt, target.source_rowid)
          mergedAliasRows += deleteByRowIdStmt.run(current.source_rowid).changes
          continue
        }

        const generatedUid = generateLocalNoteUid({
          hasInternalNoteId,
          maxAttempts: MIGRATION_LOCAL_NOTE_UID_MAX_GENERATION_ATTEMPTS,
          isUidUnavailable: (candidateUid) => {
            return Boolean((hasIdentityByUidStmt.get(candidateUid) as { ok: number } | undefined)?.ok)
          },
        })
        if (!generatedUid) {
          unresolvedRows += 1
          continue
        }

        const changed = updateUidStmt.run(
          generatedUid,
          pickLatestIsoTimestamp(current.updated_at),
          current.source_rowid
        ).changes
        regeneratedUidRows += changed
        if (changed > 0 && canSafelyRemapPopupRefs) {
          remappedPopupRefs += remapLocalPopupRefsByUid(current.note_uid, generatedUid)
        } else if (changed > 0 && hasAiPopupRefs) {
          skippedPopupRefRemapRows += 1
        }
      }
    }

    db.exec(`DROP TABLE IF EXISTS ${MIGRATION_LOCAL_NOTE_UID_REPAIR_SNAPSHOT_TABLE}`)

    return {
      normalizedUidRows,
      regeneratedUidRows,
      mergedAliasRows,
      removedInvalidUidRows,
      remappedPopupRefs,
      skippedPopupRefRemapRows,
      removedPopupRefs,
      unresolvedRows,
    }
  })

  const result = run()
  if (
    result.normalizedUidRows > 0
    || result.regeneratedUidRows > 0
    || result.mergedAliasRows > 0
    || result.removedInvalidUidRows > 0
    || result.remappedPopupRefs > 0
    || result.skippedPopupRefRemapRows > 0
    || result.removedPopupRefs > 0
    || result.unresolvedRows > 0
  ) {
    emitLocalNoteIdentityUidRepairSummaryAudit(console, {
      stage: 'migration',
      normalizedUidRows: result.normalizedUidRows,
      regeneratedUidRows: result.regeneratedUidRows,
      mergedAliasRows: result.mergedAliasRows,
      removedInvalidUidRows: result.removedInvalidUidRows,
      remappedPopupRefs: result.remappedPopupRefs,
      skippedPopupRefRemapRows: result.skippedPopupRefRemapRows,
      removedPopupRefs: result.removedPopupRefs,
      unresolvedRows: result.unresolvedRows,
    })
  }

  return result
}

function migrateDuplicateNotebookLocalMetadata(
  context: DuplicateNotebookMetadataMigrationContext,
  winnerNotebookId: string,
  duplicateNotebookId: string
): { moved: number; merged: number } {
  const sourceRows = context.selectSourceRows(duplicateNotebookId)
  if (sourceRows.length === 0) {
    return { moved: 0, merged: 0 }
  }
  const winnerRows = context.selectSourceRows(winnerNotebookId)
  const winnerRowsByPath = buildDuplicateNotebookMetadataRowMap(winnerRows)

  let moved = 0
  let merged = 0
  for (const source of sourceRows) {
    const target = winnerRowsByPath.get(source.relative_path)

    if (!target) {
      const movedRow: DuplicateNotebookMetadataRow = {
        relative_path: source.relative_path,
        is_favorite: source.is_favorite ? 1 : 0,
        is_pinned: source.is_pinned ? 1 : 0,
        ai_summary: source.ai_summary || null,
        summary_content_hash: source.summary_content_hash || null,
        tags_json: source.tags_json || null,
        ai_tags_json: source.ai_tags_json || null,
        updated_at: pickLatestIsoTimestamp(source.updated_at),
      }
      context.upsertMerged({
        notebookId: winnerNotebookId,
        relativePath: movedRow.relative_path,
        isFavorite: movedRow.is_favorite,
        isPinned: movedRow.is_pinned,
        aiSummary: movedRow.ai_summary,
        summaryContentHash: movedRow.summary_content_hash,
        tagsJson: movedRow.tags_json,
        aiTagsJson: movedRow.ai_tags_json,
        updatedAt: movedRow.updated_at,
      })
      winnerRowsByPath.set(movedRow.relative_path, movedRow)
      moved += 1
      continue
    }

    const mergedTags = mergeMigrationTagLists(
      parseMigrationTagsJson(target.tags_json),
      parseMigrationTagsJson(source.tags_json)
    )
    const mergedAiTags = mergeMigrationTagLists(
      parseMigrationTagsJson(target.ai_tags_json),
      parseMigrationTagsJson(source.ai_tags_json)
    )
    const mergedRow: DuplicateNotebookMetadataRow = {
      relative_path: source.relative_path,
      is_favorite: target.is_favorite || source.is_favorite ? 1 : 0,
      is_pinned: target.is_pinned || source.is_pinned ? 1 : 0,
      ai_summary: target.ai_summary || source.ai_summary || null,
      summary_content_hash: target.summary_content_hash || source.summary_content_hash || null,
      tags_json: mergedTags.length > 0 ? JSON.stringify(mergedTags) : null,
      ai_tags_json: mergedAiTags.length > 0 ? JSON.stringify(mergedAiTags) : null,
      updated_at: pickLatestIsoTimestamp(target.updated_at, source.updated_at),
    }
    context.upsertMerged({
      notebookId: winnerNotebookId,
      relativePath: mergedRow.relative_path,
      isFavorite: mergedRow.is_favorite,
      isPinned: mergedRow.is_pinned,
      aiSummary: mergedRow.ai_summary,
      summaryContentHash: mergedRow.summary_content_hash,
      tagsJson: mergedRow.tags_json,
      aiTagsJson: mergedRow.ai_tags_json,
      updatedAt: mergedRow.updated_at,
    })
    winnerRowsByPath.set(mergedRow.relative_path, mergedRow)
    merged += 1
  }

  context.deleteByNotebook(duplicateNotebookId)

  return { moved, merged }
}

function migrateDuplicateNotebookLocalIdentity(
  context: DuplicateNotebookIdentityMigrationContext,
  winnerNotebookId: string,
  duplicateNotebookId: string
): { moved: number; merged: number; remappedRefs: number } {
  const sourceRows = context.selectSourceRows(duplicateNotebookId)
  if (sourceRows.length === 0) {
    return { moved: 0, merged: 0, remappedRefs: 0 }
  }
  const winnerRows = context.selectSourceRows(winnerNotebookId)
  const winnerRowsByPath = buildDuplicateNotebookIdentityRowMap(winnerRows)

  let moved = 0
  let merged = 0
  let remappedRefs = 0

  for (const source of sourceRows) {
    const target = winnerRowsByPath.get(source.relative_path)
    if (!target) {
      const movedCount = context.moveByRowId(
        winnerNotebookId,
        pickLatestIsoTimestamp(source.updated_at),
        source.source_rowid
      )
      moved += movedCount
      if (movedCount > 0) {
        winnerRowsByPath.set(source.relative_path, {
          source_rowid: source.source_rowid,
          note_uid: source.note_uid,
          relative_path: source.relative_path,
          updated_at: pickLatestIsoTimestamp(source.updated_at),
        })
      }
      continue
    }

    if (context.hasAiPopupRefs && source.note_uid !== target.note_uid) {
      remappedRefs += context.remapLocalPopupRefsByUid(source.note_uid, target.note_uid)
    }
    const mergedUpdatedAt = pickLatestIsoTimestamp(target.updated_at, source.updated_at)
    context.updateUpdatedAtByRowId(mergedUpdatedAt, target.source_rowid)
    winnerRowsByPath.set(source.relative_path, {
      source_rowid: target.source_rowid,
      note_uid: target.note_uid,
      relative_path: target.relative_path,
      updated_at: mergedUpdatedAt,
    })
    merged += context.deleteByRowId(source.source_rowid)
  }

  context.deleteByNotebook(duplicateNotebookId)

  return { moved, merged, remappedRefs }
}

function consolidateDuplicateLocalFolderNotebooks(remaps: LocalFolderDuplicateNotebookRemap[]): void {
  if (remaps.length === 0) return
  const db = getDb()
  const hasLocalNoteMetadata = tableExists('local_note_metadata')
  const hasLocalNoteIdentity = tableExists('local_note_identity')
  const hasAiPopupRefs = hasLocalNoteIdentity && tableExists('ai_popup_refs')
  const normalizedRemaps: LocalFolderDuplicateNotebookRemap[] = []
  const seenDuplicateNotebookIds = new Set<string>()
  for (const remap of remaps) {
    if (!remap.duplicateNotebookId || !remap.winnerNotebookId) continue
    if (remap.duplicateNotebookId === remap.winnerNotebookId) continue
    if (seenDuplicateNotebookIds.has(remap.duplicateNotebookId)) continue
    seenDuplicateNotebookIds.add(remap.duplicateNotebookId)
    normalizedRemaps.push(remap)
  }
  if (normalizedRemaps.length === 0) return

  const run = db.transaction(() => {
    const hasNotebookStmt = db.prepare('SELECT 1 as ok FROM notebooks WHERE id = ? LIMIT 1')
    const deleteMountStmt = db.prepare('DELETE FROM local_folder_mounts WHERE notebook_id = ?')
    const deleteNotebookStmt = db.prepare('DELETE FROM notebooks WHERE id = ?')
    const metadataContext = hasLocalNoteMetadata
      ? createDuplicateNotebookMetadataMigrationContext(db)
      : null
    const identityContext = hasLocalNoteIdentity
      ? createDuplicateNotebookIdentityMigrationContext(db, hasAiPopupRefs)
      : null

    let deletedNotebooks = 0
    let movedMetadataRows = 0
    let mergedMetadataRows = 0
    let movedIdentityRows = 0
    let mergedIdentityRows = 0
    let remappedPopupRefs = 0

    for (const remap of normalizedRemaps) {
      const winnerExists = Boolean((hasNotebookStmt.get(remap.winnerNotebookId) as { ok: number } | undefined)?.ok)
      const duplicateExists = Boolean((hasNotebookStmt.get(remap.duplicateNotebookId) as { ok: number } | undefined)?.ok)
      if (!winnerExists || !duplicateExists) continue

      const metadataResult = metadataContext
        ? migrateDuplicateNotebookLocalMetadata(
          metadataContext,
          remap.winnerNotebookId,
          remap.duplicateNotebookId
        )
        : { moved: 0, merged: 0 }
      movedMetadataRows += metadataResult.moved
      mergedMetadataRows += metadataResult.merged

      const identityResult = identityContext
        ? migrateDuplicateNotebookLocalIdentity(
          identityContext,
          remap.winnerNotebookId,
          remap.duplicateNotebookId
        )
        : { moved: 0, merged: 0, remappedRefs: 0 }
      movedIdentityRows += identityResult.moved
      mergedIdentityRows += identityResult.merged
      remappedPopupRefs += identityResult.remappedRefs

      deleteMountStmt.run(remap.duplicateNotebookId)
      deletedNotebooks += deleteNotebookStmt.run(remap.duplicateNotebookId).changes
    }

    if (deletedNotebooks > 0 || movedMetadataRows > 0 || movedIdentityRows > 0 || remappedPopupRefs > 0) {
      console.warn(
        '[Database] Consolidated duplicate local-folder notebooks:',
        {
          remapCount: normalizedRemaps.length,
          deletedNotebooks,
          movedMetadataRows,
          mergedMetadataRows,
          movedIdentityRows,
          mergedIdentityRows,
          remappedPopupRefs,
        }
      )
    }
  })

  run()
}

function cleanupDanglingLocalFolderNotebooksWithoutMount(): void {
  const db = getDb()
  const danglingRows = db.prepare(`
    SELECT n.id
    FROM notebooks n
    LEFT JOIN local_folder_mounts m ON m.notebook_id = n.id
    WHERE n.source_type = 'local-folder'
      AND m.notebook_id IS NULL
  `).all() as Array<{ id: string }>
  if (danglingRows.length === 0) return

  const remove = db.transaction(() => {
    const deleteNotebookStmt = db.prepare('DELETE FROM notebooks WHERE id = ?')
    let deletedCount = 0
    for (const row of danglingRows) {
      deletedCount += deleteNotebookStmt.run(row.id).changes
    }
    return deletedCount
  })

  const deletedCount = remove()
  if (deletedCount > 0) {
    console.warn(`[Database] Removed ${deletedCount} dangling local-folder notebook(s) without mount.`)
  }
}

export function runMigrations(): void {
  const db = getDb()
  const duplicateLocalFolderNotebookRemaps: LocalFolderDuplicateNotebookRemap[] = []
  const noteColumns = db.prepare("PRAGMA table_info(notes)").all() as { name: string }[]

  migrateNotesIsPinned(
    noteColumns,
    (sql) => db.exec(sql),
    (message) => console.log(message)
  )

  // Migration: Add revision column to notes table (optimistic concurrency)
  const hasRevision = noteColumns.some(col => col.name === 'revision')

  if (!hasRevision) {
    console.log('Adding revision column to notes table...')
    db.exec('ALTER TABLE notes ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
    console.log('Migration completed: revision column added.')
  }

  // Migration: Remove color column and add icon column to notebooks table
  const notebookColumns = db.prepare("PRAGMA table_info(notebooks)").all() as { name: string }[]
  const hasSourceTypeBeforeMigration = notebookColumns.some((col) => col.name === 'source_type')
  const hasIcon = notebookColumns.some(col => col.name === 'icon')

  if (!hasIcon) {
    console.log('Adding icon column to notebooks table...')
    db.exec("ALTER TABLE notebooks ADD COLUMN icon TEXT DEFAULT 'logo:notes'")
    console.log('Migration completed: icon column added.')
  }

  migrateNotebooksSourceType(
    notebookColumns,
    (sql) => db.exec(sql),
    (message) => console.log(message)
  )

  // Migration: Create local_folder_mounts table
  const localFolderMountsTableExists = tableExists('local_folder_mounts')
  let reconciledLocalMountOwnership = false
  if (!localFolderMountsTableExists) {
    console.log('Creating local_folder_mounts table...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS local_folder_mounts (
        notebook_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        canonical_root_path TEXT NOT NULL,
        canonical_compare_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'permission_required', 'missing')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_local_folder_mounts_status ON local_folder_mounts(status);
      CREATE INDEX IF NOT EXISTS idx_local_folder_mounts_canonical_compare_path_lookup ON local_folder_mounts(canonical_compare_path);
      DROP INDEX IF EXISTS idx_local_folder_mounts_canonical_compare_path_active_unique;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_local_folder_mounts_canonical_compare_path_unique
        ON local_folder_mounts(canonical_compare_path);
    `)
    console.log('Migration completed: local_folder_mounts table created.')
  } else {
    const localFolderMountColumns = db.prepare("PRAGMA table_info(local_folder_mounts)").all() as Array<{ name: string }>
    const hasCanonicalRootPath = localFolderMountColumns.some((column) => column.name === 'canonical_root_path')
    const hasCanonicalComparePath = localFolderMountColumns.some((column) => column.name === 'canonical_compare_path')
    const hasStatus = localFolderMountColumns.some((column) => column.name === 'status')
    const hasCreatedAt = localFolderMountColumns.some((column) => column.name === 'created_at')
    const hasUpdatedAt = localFolderMountColumns.some((column) => column.name === 'updated_at')

    if (!hasCanonicalRootPath) {
      console.log('Adding canonical_root_path column to local_folder_mounts table...')
      db.exec('ALTER TABLE local_folder_mounts ADD COLUMN canonical_root_path TEXT')
    }
    if (!hasCanonicalComparePath) {
      console.log('Adding canonical_compare_path column to local_folder_mounts table...')
      db.exec('ALTER TABLE local_folder_mounts ADD COLUMN canonical_compare_path TEXT')
    }
    if (!hasStatus) {
      console.log('Adding status column to local_folder_mounts table...')
      db.exec("ALTER TABLE local_folder_mounts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    }
    if (!hasCreatedAt) {
      console.log('Adding created_at column to local_folder_mounts table...')
      db.exec('ALTER TABLE local_folder_mounts ADD COLUMN created_at TEXT')
    }
    if (!hasUpdatedAt) {
      console.log('Adding updated_at column to local_folder_mounts table...')
      db.exec('ALTER TABLE local_folder_mounts ADD COLUMN updated_at TEXT')
    }

    const mountMigrationNow = new Date().toISOString()
    db.prepare(`
      UPDATE local_folder_mounts
      SET canonical_root_path = CASE
            WHEN canonical_root_path IS NULL OR TRIM(canonical_root_path) = '' THEN root_path
            ELSE canonical_root_path
          END,
          status = CASE
              WHEN status IN ('active', 'permission_required', 'missing') THEN status
              WHEN status IS NULL OR TRIM(status) = '' THEN 'active'
              ELSE 'missing'
            END,
          created_at = COALESCE(NULLIF(created_at, ''), ?),
          updated_at = COALESCE(NULLIF(updated_at, ''), ?)
    `).run(mountMigrationNow, mountMigrationNow)

    const mountRows = db.prepare(`
      SELECT notebook_id, root_path, canonical_root_path, canonical_compare_path, status, updated_at
      FROM local_folder_mounts
    `).all() as Array<{
      notebook_id: string
      root_path: string
      canonical_root_path: string | null
      canonical_compare_path: string | null
      status: NotebookStatus | null
      updated_at: string | null
    }>

    const backfillCanonicalComparePathStmt = db.prepare(`
      UPDATE local_folder_mounts
      SET canonical_compare_path = ?
      WHERE notebook_id = ?
    `)

    for (const row of mountRows) {
      const canonicalComparePath = buildCanonicalComparePath(
        row.canonical_root_path,
        row.root_path
      )
      if (row.canonical_compare_path === canonicalComparePath) continue
      backfillCanonicalComparePathStmt.run(canonicalComparePath, row.notebook_id)
    }

    reconcileLocalFolderMountNotebookOwnership({
      allowNotebookPromotion: !hasSourceTypeBeforeMigration,
    })
    reconciledLocalMountOwnership = true

    const updatedRows = db.prepare(`
      SELECT notebook_id, root_path, canonical_root_path, canonical_compare_path, status, updated_at
      FROM local_folder_mounts
    `).all() as Array<{
      notebook_id: string
      root_path: string
      canonical_root_path: string
      canonical_compare_path: string | null
      status: NotebookStatus | null
      updated_at: string | null
    }>

    const groups = new Map<string, LocalFolderMountRowLike[]>()
    for (const row of updatedRows) {
      const persistedCanonicalComparePath = typeof row.canonical_compare_path === 'string'
        ? row.canonical_compare_path.trim()
        : ''
      const canonicalComparePath = persistedCanonicalComparePath
        || buildCanonicalComparePath(row.canonical_root_path, row.root_path)
      const normalizedStatus: NotebookStatus = row.status === 'permission_required' || row.status === 'missing'
        ? row.status
        : 'active'
      const normalizedUpdatedAt = row.updated_at || mountMigrationNow
      const item: LocalFolderMountRowLike = {
        notebook_id: row.notebook_id,
        root_path: row.root_path,
        canonical_root_path: row.canonical_root_path,
        canonical_compare_path: canonicalComparePath,
        status: normalizedStatus,
        updated_at: normalizedUpdatedAt,
      }
      const group = groups.get(canonicalComparePath)
      if (group) {
        group.push(item)
      } else {
        groups.set(canonicalComparePath, [item])
      }
    }

    const deleteDuplicateMountStmt = db.prepare(`
      DELETE FROM local_folder_mounts
      WHERE notebook_id = ?
    `)

    let duplicateGroupCount = 0
    let prunedCount = 0
    for (const rows of groups.values()) {
      if (rows.length <= 1) continue
      duplicateGroupCount += 1
      const sorted = [...rows].sort(compareLocalFolderMountPriority)
      const winnerNotebookId = sorted[0].notebook_id
      for (let index = 1; index < sorted.length; index += 1) {
        const duplicated = sorted[index]
        const deletedMount = deleteDuplicateMountStmt.run(duplicated.notebook_id).changes
        if (deletedMount > 0) {
          prunedCount += 1
          duplicateLocalFolderNotebookRemaps.push({
            winnerNotebookId,
            duplicateNotebookId: duplicated.notebook_id,
          })
        }
      }
    }
    if (prunedCount > 0) {
      console.warn(
        `[Database] Pruned ${prunedCount} duplicate local-folder mount row(s) across ${duplicateGroupCount} canonical path group(s), queued ${duplicateLocalFolderNotebookRemaps.length} notebook remap(s).`
      )
    }

    if (hasLegacyCanonicalRootUniqueLocalFolderMountConstraint()) {
      console.log('Rebuilding local_folder_mounts table to remove legacy canonical_root_path unique constraints...')
      rebuildLocalFolderMountsWithoutHardUniqueConstraint()
      console.log('Migration completed: local_folder_mounts legacy canonical_root_path unique constraints removed.')
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_local_folder_mounts_status ON local_folder_mounts(status)')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_local_folder_mounts_canonical_compare_path_lookup
      ON local_folder_mounts(canonical_compare_path)
    `)
    db.exec('DROP INDEX IF EXISTS idx_local_folder_mounts_canonical_compare_path_active_unique')
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_local_folder_mounts_canonical_compare_path_unique
      ON local_folder_mounts(canonical_compare_path)
    `)
    db.exec('DROP INDEX IF EXISTS idx_local_folder_mounts_canonical_root_path_lookup')

    warnDuplicateCanonicalLocalFolderMountGroups()
  }

  if (!reconciledLocalMountOwnership) {
    reconcileLocalFolderMountNotebookOwnership({
      allowNotebookPromotion: !hasSourceTypeBeforeMigration,
    })
  }

  const localMountValidationNow = new Date().toISOString()
  db.prepare(`
    UPDATE local_folder_mounts
    SET status = CASE
          WHEN status IN ('active', 'permission_required', 'missing') THEN status
          WHEN status IS NULL OR TRIM(status) = '' THEN 'active'
          ELSE 'missing'
        END,
        created_at = COALESCE(NULLIF(created_at, ''), ?),
        updated_at = COALESCE(NULLIF(updated_at, ''), ?)
  `).run(localMountValidationNow, localMountValidationNow)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_local_folder_mounts_status_validate_insert
    BEFORE INSERT ON local_folder_mounts
    FOR EACH ROW
    WHEN NEW.status NOT IN ('active', 'permission_required', 'missing')
    BEGIN
      SELECT RAISE(ABORT, 'invalid local_folder_mounts.status');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_local_folder_mounts_status_validate_update
    BEFORE UPDATE OF status ON local_folder_mounts
    FOR EACH ROW
    WHEN NEW.status NOT IN ('active', 'permission_required', 'missing')
    BEGIN
      SELECT RAISE(ABORT, 'invalid local_folder_mounts.status');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_local_folder_mounts_notebook_source_validate_insert
    BEFORE INSERT ON local_folder_mounts
    FOR EACH ROW
    WHEN NOT EXISTS (
      SELECT 1
      FROM notebooks
      WHERE id = NEW.notebook_id
        AND source_type = 'local-folder'
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid local_folder_mounts.notebook_source_type');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_local_folder_mounts_notebook_source_validate_update
    BEFORE UPDATE OF notebook_id ON local_folder_mounts
    FOR EACH ROW
    WHEN NOT EXISTS (
      SELECT 1
      FROM notebooks
      WHERE id = NEW.notebook_id
        AND source_type = 'local-folder'
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid local_folder_mounts.notebook_source_type');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_notebooks_source_type_validate_local_mounts
    BEFORE UPDATE OF source_type ON notebooks
    FOR EACH ROW
    WHEN OLD.source_type = 'local-folder'
      AND NEW.source_type <> 'local-folder'
      AND EXISTS (
        SELECT 1
        FROM local_folder_mounts
        WHERE notebook_id = OLD.id
      )
    BEGIN
      SELECT RAISE(ABORT, 'invalid notebooks.source_type for mounted local folder');
    END;
  `)

  // Migration: Create local_note_metadata table
  const localNoteMetadataTableExists = tableExists('local_note_metadata')
  if (!localNoteMetadataTableExists) {
    console.log('Creating local_note_metadata table...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS local_note_metadata (
        notebook_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        ai_summary TEXT DEFAULT NULL,
        summary_content_hash TEXT DEFAULT NULL,
        tags_json TEXT DEFAULT NULL,
        ai_tags_json TEXT DEFAULT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (notebook_id, relative_path),
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_local_note_metadata_notebook_id ON local_note_metadata(notebook_id);
      CREATE INDEX IF NOT EXISTS idx_local_note_metadata_is_favorite ON local_note_metadata(is_favorite);
      CREATE INDEX IF NOT EXISTS idx_local_note_metadata_is_pinned ON local_note_metadata(is_pinned);
      CREATE INDEX IF NOT EXISTS idx_local_note_metadata_updated_at ON local_note_metadata(updated_at);
    `)
    console.log('Migration completed: local_note_metadata table created.')
  } else {
    db.exec('CREATE INDEX IF NOT EXISTS idx_local_note_metadata_notebook_id ON local_note_metadata(notebook_id)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_local_note_metadata_is_favorite ON local_note_metadata(is_favorite)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_local_note_metadata_is_pinned ON local_note_metadata(is_pinned)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_local_note_metadata_updated_at ON local_note_metadata(updated_at)')
  }

  const localNoteMetadataColumns = db.prepare("PRAGMA table_info(local_note_metadata)").all() as { name: string }[]
  const hasLocalSummaryContentHash = localNoteMetadataColumns.some((column) => column.name === 'summary_content_hash')
  if (!hasLocalSummaryContentHash) {
    console.log('Adding summary_content_hash column to local_note_metadata table...')
    db.exec('ALTER TABLE local_note_metadata ADD COLUMN summary_content_hash TEXT DEFAULT NULL')
    console.log('Migration completed: summary_content_hash column added to local_note_metadata.')
  }
  const hasLocalTagsJson = localNoteMetadataColumns.some((column) => column.name === 'tags_json')
  if (!hasLocalTagsJson) {
    console.log('Adding tags_json column to local_note_metadata table...')
    db.exec('ALTER TABLE local_note_metadata ADD COLUMN tags_json TEXT DEFAULT NULL')
    console.log('Migration completed: tags_json column added to local_note_metadata.')
  }
  const hasLocalAiTagsJson = localNoteMetadataColumns.some((column) => column.name === 'ai_tags_json')
  if (!hasLocalAiTagsJson) {
    console.log('Adding ai_tags_json column to local_note_metadata table...')
    db.exec('ALTER TABLE local_note_metadata ADD COLUMN ai_tags_json TEXT DEFAULT NULL')
    console.log('Migration completed: ai_tags_json column added to local_note_metadata.')
  }

  // Migration: Create local_note_identity table
  const localNoteIdentityTableExists = tableExists('local_note_identity')
  if (!localNoteIdentityTableExists) {
    console.log('Creating local_note_identity table...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS local_note_identity (
        note_uid TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(notebook_id, relative_path),
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_local_note_identity_notebook_id ON local_note_identity(notebook_id);
      CREATE INDEX IF NOT EXISTS idx_local_note_identity_updated_at ON local_note_identity(updated_at);
    `)
    console.log('Migration completed: local_note_identity table created.')
  } else {
    db.exec('CREATE INDEX IF NOT EXISTS idx_local_note_identity_notebook_id ON local_note_identity(notebook_id)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_local_note_identity_updated_at ON local_note_identity(updated_at)')
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_local_note_identity_note_uid_validate_insert
    BEFORE INSERT ON local_note_identity
    FOR EACH ROW
    WHEN NEW.note_uid IS NULL
      OR LENGTH(TRIM(NEW.note_uid)) = 0
      OR NEW.note_uid <> TRIM(NEW.note_uid)
    BEGIN
      SELECT RAISE(ABORT, 'invalid local_note_identity.note_uid');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_local_note_identity_note_uid_validate_update
    BEFORE UPDATE OF note_uid ON local_note_identity
    FOR EACH ROW
    WHEN NEW.note_uid IS NULL
      OR LENGTH(TRIM(NEW.note_uid)) = 0
      OR NEW.note_uid <> TRIM(NEW.note_uid)
    BEGIN
      SELECT RAISE(ABORT, 'invalid local_note_identity.note_uid');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_local_note_identity_note_uid_conflict_validate_insert
    BEFORE INSERT ON local_note_identity
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1
      FROM notes
      WHERE id = NEW.note_uid
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid local_note_identity.note_uid');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_local_note_identity_note_uid_conflict_validate_update
    BEFORE UPDATE OF note_uid ON local_note_identity
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1
      FROM notes
      WHERE id = NEW.note_uid
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid local_note_identity.note_uid');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_notes_id_conflict_with_local_identity_validate_insert
    BEFORE INSERT ON notes
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1
      FROM local_note_identity
      WHERE note_uid = NEW.id
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid notes.id');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_notes_id_conflict_with_local_identity_validate_update
    BEFORE UPDATE OF id ON notes
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1
      FROM local_note_identity
      WHERE note_uid = NEW.id
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid notes.id');
    END;
  `)

  // Migration: Create notebook_folders table
  const notebookFoldersTableExists = tableExists('notebook_folders')
  if (!notebookFoldersTableExists) {
    console.log('Creating notebook_folders table...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS notebook_folders (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        depth INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(notebook_id, folder_path),
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_notebook_folders_notebook_id ON notebook_folders(notebook_id);
      CREATE INDEX IF NOT EXISTS idx_notebook_folders_path ON notebook_folders(folder_path);
    `)
    console.log('Migration completed: notebook_folders table created.')
  } else {
    db.exec('CREATE INDEX IF NOT EXISTS idx_notebook_folders_notebook_id ON notebook_folders(notebook_id)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_notebook_folders_path ON notebook_folders(folder_path)')
  }

  migrateNotesDeletedAt(
    noteColumns,
    (sql) => db.exec(sql),
    (message) => console.log(message)
  )

  migrateNotesFolderPath(
    noteColumns,
    (sql) => db.exec(sql),
    (message) => console.log(message)
  )
  const detachedFolderPathMigrationDone = db.prepare(
    'SELECT value FROM app_settings WHERE key = ?'
  ).get(DETACHED_FOLDER_PATH_MIGRATION_SETTING_KEY) as { value: string } | undefined
  if (!detachedFolderPathMigrationDone) {
    migrateNotesDetachedFolderPath(
      (sql) => db.exec(sql),
      (message) => console.log(message)
    )

    const now = new Date().toISOString()
    db.prepare(
      'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)'
    ).run(DETACHED_FOLDER_PATH_MIGRATION_SETTING_KEY, JSON.stringify({ migratedAt: now }), now)
    console.log('Migration completed: detached note folder_path repair applied.')
  }

  const frontmatterMigrationDone = db.prepare(
    'SELECT value FROM app_settings WHERE key = ?'
  ).get(FRONTMATTER_NODE_MIGRATION_SETTING_KEY) as { value: string } | undefined

  if (!frontmatterMigrationDone) {
    try {
      console.log('Migrating legacy yaml-frontmatter nodes in notes...')
      const MIGRATION_BATCH_SIZE = 200
      let scanned = 0
      let migrated = 0

      const updateStmt = db.prepare('UPDATE notes SET content = ? WHERE id = ?')
      const selectBatchStmt = db.prepare(
        'SELECT id, content FROM notes ORDER BY id LIMIT ?'
      )
      const selectBatchAfterIdStmt = db.prepare(
        'SELECT id, content FROM notes WHERE id > ? ORDER BY id LIMIT ?'
      )
      let lastId: string | null = null
      while (true) {
        const batch = (
          lastId
            ? selectBatchAfterIdStmt.all(lastId, MIGRATION_BATCH_SIZE)
            : selectBatchStmt.all(MIGRATION_BATCH_SIZE)
        ) as Array<{ id: string; content: string }>
        if (batch.length === 0) break
        scanned += batch.length

        const updates = collectLegacyFrontmatterContentUpdates(batch)
        if (updates.length > 0) {
          const tx = db.transaction((rows: Array<{ id: string; content: string }>) => {
            for (const row of rows) {
              updateStmt.run(row.content, row.id)
            }
          })
          tx(updates)
          migrated += updates.length
        }
        lastId = batch[batch.length - 1]?.id || null
      }

      const now = new Date().toISOString()
      const migrationMeta = JSON.stringify({ scanned, migrated })
      db.prepare(
        'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)'
      ).run(FRONTMATTER_NODE_MIGRATION_SETTING_KEY, migrationMeta, now)

      console.log(
        `Migration completed: legacy yaml-frontmatter normalized (scanned=${scanned}, migrated=${migrated}).`
      )
    } catch (error) {
      console.error('[Database] Failed to migrate legacy frontmatter nodes:', error)
    }
  }

  // Migration: Add shortcut_key column to ai_actions table
  const aiActionColumns = db.prepare("PRAGMA table_info(ai_actions)").all() as { name: string }[]
  const hasShortcutKey = aiActionColumns.some(col => col.name === 'shortcut_key')

  if (!hasShortcutKey) {
    console.log('Adding shortcut_key column to ai_actions table...')
    db.exec("ALTER TABLE ai_actions ADD COLUMN shortcut_key TEXT DEFAULT ''")
    console.log('Migration completed: shortcut_key column added.')
  }

  // Migration: Add description column to ai_actions table
  const hasDescription = aiActionColumns.some(col => col.name === 'description')

  if (!hasDescription) {
    console.log('Adding description column to ai_actions table...')
    db.exec("ALTER TABLE ai_actions ADD COLUMN description TEXT NOT NULL DEFAULT ''")
    console.log('Migration completed: description column added.')
  }

  // Migration: Add AI summary columns to notes table
  const hasAiSummary = noteColumns.some(col => col.name === 'ai_summary')

  if (!hasAiSummary) {
    console.log('Adding AI summary columns to notes table...')
    db.exec('ALTER TABLE notes ADD COLUMN ai_summary TEXT DEFAULT NULL')
    db.exec('ALTER TABLE notes ADD COLUMN summary_content_hash TEXT DEFAULT NULL')
    console.log('Migration completed: AI summary columns added.')
  }

  // Migration: Add source column to note_tags table (for AI-generated tags)
  const noteTagColumns = db.prepare("PRAGMA table_info(note_tags)").all() as { name: string }[]
  const hasSource = noteTagColumns.some(col => col.name === 'source')

  if (!hasSource) {
    console.log('Adding source column to note_tags table...')
    db.exec("ALTER TABLE note_tags ADD COLUMN source TEXT DEFAULT 'user'")
    console.log('Migration completed: source column added to note_tags.')
  }

  // Migration: Add output columns to agent_tasks table
  const agentTaskColumns = db.prepare("PRAGMA table_info(agent_tasks)").all() as { name: string }[]
  const hasOutputBlockId = agentTaskColumns.some(col => col.name === 'output_block_id')

  if (!hasOutputBlockId) {
    console.log('Adding output columns to agent_tasks table...')
    db.exec("ALTER TABLE agent_tasks ADD COLUMN output_block_id TEXT DEFAULT NULL")
    db.exec("ALTER TABLE agent_tasks ADD COLUMN process_mode TEXT DEFAULT 'append'")
    db.exec("ALTER TABLE agent_tasks ADD COLUMN run_timing TEXT DEFAULT 'manual'")
    db.exec("ALTER TABLE agent_tasks ADD COLUMN schedule_config TEXT DEFAULT NULL")
    console.log('Migration completed: output columns added to agent_tasks.')
  }

  // Migration: Add output_format column to agent_tasks table
  const hasOutputFormat = agentTaskColumns.some(col => col.name === 'output_format')
  if (!hasOutputFormat) {
    console.log('Adding output_format column to agent_tasks table...')
    db.exec("ALTER TABLE agent_tasks ADD COLUMN output_format TEXT DEFAULT 'auto'")
    console.log('Migration completed: output_format column added to agent_tasks.')
  }

  // Migration: Create ai_popup_refs table
  // Ensure legacy rows can be normalized/cleaned before strict note-reference validation runs.
  db.exec('DROP TRIGGER IF EXISTS trg_ai_popup_refs_popup_reference_validate_insert')
  db.exec('DROP TRIGGER IF EXISTS trg_ai_popup_refs_popup_reference_validate_update')
  db.exec('DROP TRIGGER IF EXISTS trg_ai_popup_refs_note_reference_validate_insert')
  db.exec('DROP TRIGGER IF EXISTS trg_ai_popup_refs_note_reference_validate_update')

  const aiPopupRefsTableExists = tableExists('ai_popup_refs')
  if (!aiPopupRefsTableExists) {
    console.log('Creating ai_popup_refs table...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_popup_refs (
        popup_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'internal' CHECK (source_type IN ('internal', 'local-folder')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (popup_id, note_id)
      );
    `)
    console.log('Migration completed: ai_popup_refs table created.')
  } else {
    const aiPopupRefsColumns = db.prepare("PRAGMA table_info(ai_popup_refs)").all() as { name: string }[]
    const hasSourceType = aiPopupRefsColumns.some((column) => column.name === 'source_type')
    const hasCreatedAt = aiPopupRefsColumns.some((column) => column.name === 'created_at')
    const hasUpdatedAt = aiPopupRefsColumns.some((column) => column.name === 'updated_at')

    if (!hasSourceType) {
      console.log('Adding source_type column to ai_popup_refs table...')
      db.exec("ALTER TABLE ai_popup_refs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'internal'")
    }
    if (!hasCreatedAt) {
      console.log('Adding created_at column to ai_popup_refs table...')
      db.exec('ALTER TABLE ai_popup_refs ADD COLUMN created_at TEXT')
    }
    if (!hasUpdatedAt) {
      console.log('Adding updated_at column to ai_popup_refs table...')
      db.exec('ALTER TABLE ai_popup_refs ADD COLUMN updated_at TEXT')
    }

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE ai_popup_refs
      SET source_type = CASE
            WHEN source_type IN ('internal', 'local-folder') THEN source_type
            ELSE 'internal'
          END,
          created_at = COALESCE(NULLIF(created_at, ''), ?),
          updated_at = COALESCE(NULLIF(updated_at, ''), ?)
    `).run(now, now)
  }

  // Repair legacy/dirty local note UID values before strict popup-ref pruning.
  const localNoteUidRepairMigrationState = db.prepare(
    'SELECT value FROM app_settings WHERE key = ?'
  ).get(LOCAL_NOTE_UID_REPAIR_MIGRATION_SETTING_KEY) as { value: string } | undefined
  const storedLocalNoteUidRepairMeta = localNoteUidRepairMigrationState
    ? parseStoredLocalNoteUidRepairMigrationMeta(localNoteUidRepairMigrationState.value)
    : null
  if (localNoteUidRepairMigrationState && !storedLocalNoteUidRepairMeta) {
    console.warn('[Database] local_note_identity note_uid repair migration state is invalid; rerunning repair migration.')
  }
  const shouldRunLocalNoteUidRepairMigration = (
    !storedLocalNoteUidRepairMeta
    || storedLocalNoteUidRepairMeta.unresolvedRows > 0
  )
  if (shouldRunLocalNoteUidRepairMigration) {
    const localNoteUidRepairSummary = repairLocalNoteIdentityNoteUidRows()
    if (localNoteUidRepairSummary.unresolvedRows > 0) {
      db.prepare('DELETE FROM app_settings WHERE key = ?').run(LOCAL_NOTE_UID_REPAIR_MIGRATION_SETTING_KEY)
      console.warn(
        `[Database] local_note_identity note_uid repair left ${localNoteUidRepairSummary.unresolvedRows} unresolved row(s); will retry on next startup.`
      )
    } else {
      const now = new Date().toISOString()
      db.prepare(
        'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)'
      ).run(
        LOCAL_NOTE_UID_REPAIR_MIGRATION_SETTING_KEY,
        JSON.stringify({ ...localNoteUidRepairSummary, migratedAt: now }),
        now
      )
    }
  }

  const removedInvalidPopupReferenceRows = db.prepare(`
    DELETE FROM ai_popup_refs
    WHERE popup_id NOT IN (SELECT id FROM ai_popups)
  `).run().changes
  const removedInvalidInternalPopupRefs = db.prepare(`
    DELETE FROM ai_popup_refs
    WHERE source_type = 'internal'
      AND note_id NOT IN (SELECT id FROM notes)
  `).run().changes
  const removedInvalidLocalPopupRefs = db.prepare(`
    DELETE FROM ai_popup_refs
    WHERE source_type = 'local-folder'
      AND note_id NOT IN (SELECT note_uid FROM local_note_identity)
  `).run().changes
  const removedInvalidPopupRefs = removedInvalidPopupReferenceRows + removedInvalidInternalPopupRefs + removedInvalidLocalPopupRefs
  if (removedInvalidPopupRefs > 0) {
    console.warn(
      `[Database] Removed ${removedInvalidPopupRefs} invalid ai_popup_refs row(s) (popup=${removedInvalidPopupReferenceRows}, internal=${removedInvalidInternalPopupRefs}, local-folder=${removedInvalidLocalPopupRefs}).`
    )
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_source_type_validate_insert
    BEFORE INSERT ON ai_popup_refs
    FOR EACH ROW
    WHEN NEW.source_type NOT IN ('internal', 'local-folder')
    BEGIN
      SELECT RAISE(ABORT, 'invalid ai_popup_refs.source_type');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_source_type_validate_update
    BEFORE UPDATE OF source_type ON ai_popup_refs
    FOR EACH ROW
    WHEN NEW.source_type NOT IN ('internal', 'local-folder')
    BEGIN
      SELECT RAISE(ABORT, 'invalid ai_popup_refs.source_type');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_popup_reference_validate_insert
    BEFORE INSERT ON ai_popup_refs
    FOR EACH ROW
    WHEN NOT EXISTS (
      SELECT 1
      FROM ai_popups
      WHERE id = NEW.popup_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid ai_popup_refs.popup_reference');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_popup_reference_validate_update
    BEFORE UPDATE OF popup_id ON ai_popup_refs
    FOR EACH ROW
    WHEN NOT EXISTS (
      SELECT 1
      FROM ai_popups
      WHERE id = NEW.popup_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid ai_popup_refs.popup_reference');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_note_reference_validate_insert
    BEFORE INSERT ON ai_popup_refs
    FOR EACH ROW
    WHEN (
      (NEW.source_type = 'internal' AND NOT EXISTS (
        SELECT 1
        FROM notes
        WHERE id = NEW.note_id
      ))
      OR
      (NEW.source_type = 'local-folder' AND NOT EXISTS (
        SELECT 1
        FROM local_note_identity
        WHERE note_uid = NEW.note_id
      ))
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid ai_popup_refs.note_reference');
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_note_reference_validate_update
    BEFORE UPDATE OF note_id, source_type ON ai_popup_refs
    FOR EACH ROW
    WHEN (
      (NEW.source_type = 'internal' AND NOT EXISTS (
        SELECT 1
        FROM notes
        WHERE id = NEW.note_id
      ))
      OR
      (NEW.source_type = 'local-folder' AND NOT EXISTS (
        SELECT 1
        FROM local_note_identity
        WHERE note_uid = NEW.note_id
      ))
    )
    BEGIN
      SELECT RAISE(ABORT, 'invalid ai_popup_refs.note_reference');
    END;
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_popup_refs_note_id ON ai_popup_refs(note_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_popup_refs_popup_id ON ai_popup_refs(popup_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_popup_refs_source_note_id ON ai_popup_refs(source_type, note_id)')
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_cleanup_internal_note_delete
    AFTER DELETE ON notes
    BEGIN
      DELETE FROM ai_popup_refs
      WHERE source_type = 'internal' AND note_id = OLD.id;
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_cleanup_local_identity_delete
    AFTER DELETE ON local_note_identity
    BEGIN
      DELETE FROM ai_popup_refs
      WHERE source_type = 'local-folder' AND note_id = OLD.note_uid;
    END;
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_ai_popup_refs_cleanup_popup_delete
    AFTER DELETE ON ai_popups
    BEGIN
      DELETE FROM ai_popup_refs
      WHERE popup_id = OLD.id;
    END;
  `)

  consolidateDuplicateLocalFolderNotebooks(duplicateLocalFolderNotebookRemaps)
  cleanupDanglingLocalFolderNotebooksWithoutMount()

  // Migration: Create templates table
  const templatesTableExists = tableExists('templates')

  if (!templatesTableExists) {
    console.log('Creating templates table...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        content TEXT NOT NULL,
        icon TEXT DEFAULT '',
        is_daily_default INTEGER DEFAULT 0,
        order_index INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_templates_order ON templates(order_index);
      CREATE INDEX IF NOT EXISTS idx_templates_daily ON templates(is_daily_default);
    `)
    console.log('Migration completed: templates table created.')
  }
}
