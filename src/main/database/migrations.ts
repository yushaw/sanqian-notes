import { getDb } from './connection'
import { buildCanonicalComparePath, compareLocalFolderMountPriority } from './helpers'
import type { LocalFolderMountRowLike } from './helpers'
import type { NotebookStatus } from '../../shared/types'

const DETACHED_FOLDER_PATH_MIGRATION_SETTING_KEY = 'migration.detached-folder-path.v1'
const FRONTMATTER_NODE_MIGRATION_SETTING_KEY = 'migration.frontmatter-node.v1'

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

function hasHardUniqueLocalFolderMountPathConstraint(): boolean {
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
    || tableSql.includes('canonical_compare_path text not null unique')
    || tableSql.includes('unique (canonical_root_path')
    || tableSql.includes('unique(canonical_root_path')
    || tableSql.includes('unique (canonical_compare_path')
    || tableSql.includes('unique(canonical_compare_path')
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
        status TEXT NOT NULL DEFAULT 'active',
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
        COALESCE(NULLIF(status, ''), 'active'),
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

export function runMigrations(): void {
  const db = getDb()
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
  const localFolderMountsTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='local_folder_mounts'"
  ).get()
  if (!localFolderMountsTableExists) {
    console.log('Creating local_folder_mounts table...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS local_folder_mounts (
        notebook_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        canonical_root_path TEXT NOT NULL,
        canonical_compare_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_local_folder_mounts_status ON local_folder_mounts(status);
      CREATE INDEX IF NOT EXISTS idx_local_folder_mounts_canonical_compare_path_lookup ON local_folder_mounts(canonical_compare_path);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_local_folder_mounts_canonical_compare_path_active_unique
        ON local_folder_mounts(canonical_compare_path)
        WHERE status = 'active';
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
      SET canonical_root_path = COALESCE(NULLIF(canonical_root_path, ''), root_path),
          status = COALESCE(NULLIF(status, ''), 'active'),
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
      const canonicalRootPath = row.canonical_root_path || row.root_path
      const canonicalComparePath = buildCanonicalComparePath(canonicalRootPath, row.root_path)
      if (row.canonical_compare_path === canonicalComparePath) continue
      backfillCanonicalComparePathStmt.run(canonicalComparePath, row.notebook_id)
    }

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
      const canonicalComparePath = row.canonical_compare_path || buildCanonicalComparePath(row.canonical_root_path, row.root_path)
      const normalizedStatus = (row.status || 'active') as NotebookStatus
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

    const demoteDuplicateStmt = db.prepare(`
      UPDATE local_folder_mounts
      SET status = 'missing', updated_at = ?
      WHERE notebook_id = ?
    `)

    let demotedCount = 0
    for (const rows of groups.values()) {
      if (rows.length <= 1) continue
      const sorted = [...rows].sort(compareLocalFolderMountPriority)
      for (let index = 1; index < sorted.length; index += 1) {
        const duplicated = sorted[index]
        if (duplicated.status !== 'active') continue
        demoteDuplicateStmt.run(mountMigrationNow, duplicated.notebook_id)
        demotedCount += 1
      }
    }
    if (demotedCount > 0) {
      console.warn(`[Database] Demoted ${demotedCount} duplicate local-folder mounts to missing status.`)
    }

    if (hasHardUniqueLocalFolderMountPathConstraint()) {
      console.log('Rebuilding local_folder_mounts table to remove hard unique path constraints...')
      rebuildLocalFolderMountsWithoutHardUniqueConstraint()
      console.log('Migration completed: local_folder_mounts hard unique path constraints removed.')
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_local_folder_mounts_status ON local_folder_mounts(status)')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_local_folder_mounts_canonical_compare_path_lookup
      ON local_folder_mounts(canonical_compare_path)
    `)
    try {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_local_folder_mounts_canonical_compare_path_active_unique
        ON local_folder_mounts(canonical_compare_path)
        WHERE status = 'active'
      `)
    } catch (error) {
      console.warn(
        '[Database] Failed to enforce active unique canonical_compare_path index for local_folder_mounts:',
        error
      )
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_local_folder_mounts_canonical_root_path_lookup
        ON local_folder_mounts(canonical_root_path)
      `)
    }
  }

  // Migration: Create local_note_metadata table
  const localNoteMetadataTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='local_note_metadata'"
  ).get()
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
  const localNoteIdentityTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='local_note_identity'"
  ).get()
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

  // Migration: Create notebook_folders table
  const notebookFoldersTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='notebook_folders'"
  ).get()
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
      const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM notes').get() as { cnt: number }
      const totalCount = countRow?.cnt ?? 0
      let scanned = 0
      let migrated = 0

      const updateStmt = db.prepare('UPDATE notes SET content = ? WHERE id = ?')
      for (let offset = 0; offset < totalCount; offset += MIGRATION_BATCH_SIZE) {
        const batch = db.prepare(
          'SELECT id, content FROM notes ORDER BY id LIMIT ? OFFSET ?'
        ).all(MIGRATION_BATCH_SIZE, offset) as Array<{ id: string; content: string }>
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
  const aiPopupRefsTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='ai_popup_refs'"
  ).get()
  if (!aiPopupRefsTableExists) {
    console.log('Creating ai_popup_refs table...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_popup_refs (
        popup_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'internal',
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
      SET source_type = COALESCE(NULLIF(source_type, ''), 'internal'),
          created_at = COALESCE(NULLIF(created_at, ''), ?),
          updated_at = COALESCE(NULLIF(updated_at, ''), ?)
    `).run(now, now)
  }
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

  // Migration: Create templates table
  const templatesTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='templates'"
  ).get()

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
