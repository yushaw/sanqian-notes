import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import {
  closeDatabase,
  createLocalFolderNotebookMount,
  getLocalFolderMountByCanonicalPath,
  initDatabase,
} from '../database'

const removeDbFiles = (dir: string) => {
  rmSync(join(dir, 'notes.db'), { force: true })
  rmSync(join(dir, 'notes.db-wal'), { force: true })
  rmSync(join(dir, 'notes.db-shm'), { force: true })
}

const require = createRequire(import.meta.url)
let sqliteAvailable = false

interface SqliteStatement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

type SqliteDatabaseCtor = new (path: string, options?: { readonly?: boolean }) => SqliteDatabase

let BetterSqlite: SqliteDatabaseCtor | null = null

try {
  BetterSqlite = require('better-sqlite3') as SqliteDatabaseCtor
  const probe = new BetterSqlite(':memory:')
  probe.close()
  sqliteAvailable = true
} catch (error) {
  sqliteAvailable = false
  console.warn('[Database Smoke Tests] better-sqlite3 unavailable, skipping migration smoke tests:', error)
}

if (process.env.CI && !sqliteAvailable) {
  throw new Error(
    '[Database Smoke Tests] better-sqlite3 unavailable in CI. Run `electron-rebuild` or `npm rebuild better-sqlite3` before tests.'
  )
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

function getSqliteCtor(): SqliteDatabaseCtor {
  if (!BetterSqlite) {
    throw new Error('better-sqlite3 is not available')
  }
  return BetterSqlite
}

function createLegacySnapshotDatabase(dbPath: string): void {
  const Sqlite = getSqliteCtor()
  const legacyDb = new Sqlite(dbPath)
  try {
    legacyDb.exec(`
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        notebook_id TEXT,
        is_daily INTEGER NOT NULL DEFAULT 0,
        daily_date TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE ai_actions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '✨',
        prompt TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'replace',
        show_in_context_menu INTEGER NOT NULL DEFAULT 1,
        show_in_slash_command INTEGER NOT NULL DEFAULT 1,
        show_in_shortcut INTEGER NOT NULL DEFAULT 1,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Legacy local mount schema (before canonical path + status/timestamps)
      CREATE TABLE local_folder_mounts (
        notebook_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
    `)

    const now = '2026-02-25T00:00:00.000Z'
    legacyDb.prepare(`
      INSERT INTO notebooks (id, name, order_index, created_at)
      VALUES (?, ?, ?, ?)
    `).run('nb-legacy', 'Legacy Notebook', 0, now)
    legacyDb.prepare(`
      INSERT INTO notebooks (id, name, order_index, created_at)
      VALUES (?, ?, ?, ?)
    `).run('nb-legacy-dup', 'Legacy Notebook Duplicate', 1, now)
    legacyDb.prepare(`
      INSERT INTO notes (id, title, content, notebook_id, is_daily, daily_date, is_favorite, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'note-legacy',
      'Legacy Note',
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'yaml-frontmatter' },
            content: [{ type: 'text', text: 'tags:\\n  - legacy' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'legacy body' }],
          },
        ],
      }),
      'nb-legacy',
      0,
      null,
      0,
      now,
      now
    )
    legacyDb.prepare(`
      INSERT INTO local_folder_mounts (notebook_id, root_path)
      VALUES (?, ?)
    `).run('nb-legacy', '/tmp/sanqian-legacy-mount')
    legacyDb.prepare(`
      INSERT INTO local_folder_mounts (notebook_id, root_path)
      VALUES (?, ?)
    `).run('nb-legacy-dup', '/tmp/sanqian-legacy-mount')
  } finally {
    legacyDb.close()
  }
}

describeSqlite('database migration smoke (legacy snapshot)', () => {
  const testDbDir = mkdtempSync(join(tmpdir(), 'sanqian-notes-db-smoke-'))
  const dbPath = join(testDbDir, 'notes.db')

  beforeAll(() => {
    vi.spyOn(app, 'getPath').mockReturnValue(testDbDir)
  })

  beforeEach(() => {
    closeDatabase()
    removeDbFiles(testDbDir)
    createLegacySnapshotDatabase(dbPath)
  })

  afterAll(() => {
    closeDatabase()
    rmSync(testDbDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('migrates legacy schema on startup without missing-column crashes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => initDatabase()).not.toThrow()

    // Legacy duplicates are demoted to non-active status so active mounts stay unique.
    const duplicateConflict = getLocalFolderMountByCanonicalPath('/tmp/sanqian-legacy-mount', {
      excludeNotebookId: 'nb-legacy',
      activeOnly: true,
    })
    expect(duplicateConflict).toBeNull()

    closeDatabase()
    expect(() => initDatabase()).not.toThrow()
    closeDatabase()

    const Sqlite = getSqliteCtor()
    const verifyDb = new Sqlite(dbPath)
    try {
      const notebookColumns = (
        verifyDb.prepare("PRAGMA table_info(notebooks)").all() as Array<{ name: string }>
      ).map((column) => column.name)
      expect(notebookColumns).toContain('source_type')
      expect(notebookColumns).toContain('icon')

      const noteColumns = (
        verifyDb.prepare("PRAGMA table_info(notes)").all() as Array<{ name: string }>
      ).map((column) => column.name)
      expect(noteColumns).toContain('is_pinned')
      expect(noteColumns).toContain('deleted_at')
      expect(noteColumns).toContain('revision')
      expect(noteColumns).toContain('folder_path')

      const notebookSourceType = verifyDb.prepare(
        "SELECT source_type FROM notebooks WHERE id = 'nb-legacy'"
      ).get() as { source_type: string } | undefined
      expect(notebookSourceType?.source_type).toBe('internal')

      const legacyNote = verifyDb.prepare(
        "SELECT is_pinned, deleted_at, revision, content FROM notes WHERE id = 'note-legacy'"
      ).get() as { is_pinned: number; deleted_at: string | null; revision: number; content: string } | undefined
      expect(legacyNote?.is_pinned).toBe(0)
      expect(legacyNote?.deleted_at).toBeNull()
      expect(legacyNote?.revision).toBe(0)
      const migratedDoc = legacyNote ? JSON.parse(legacyNote.content) as { content?: Array<{ type?: string }> } : null
      expect(migratedDoc?.content?.[0]?.type).toBe('frontmatter')

      const indexNames = (
        verifyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>
      ).map((row) => row.name)
      expect(indexNames).toContain('idx_notebooks_source_type')
      expect(indexNames).toContain('idx_notes_is_pinned')
      expect(indexNames).toContain('idx_notes_deleted_at')
      expect(indexNames).toContain('idx_notes_folder_path')
      expect(indexNames).toContain('idx_notes_notebook_folder_path')
      expect(indexNames).toContain('idx_local_folder_mounts_status')
      expect(indexNames).toContain('idx_local_folder_mounts_canonical_compare_path_lookup')
      expect(indexNames).toContain('idx_local_folder_mounts_canonical_compare_path_active_unique')
      expect(indexNames).toContain('idx_local_note_identity_notebook_id')
      expect(indexNames).toContain('idx_local_note_identity_updated_at')
      expect(indexNames).not.toContain('idx_local_folder_mounts_canonical_root_path_lookup')

      const localMountColumns = (
        verifyDb.prepare("PRAGMA table_info(local_folder_mounts)").all() as Array<{ name: string }>
      ).map((column) => column.name)
      expect(localMountColumns).toContain('canonical_root_path')
      expect(localMountColumns).toContain('canonical_compare_path')
      expect(localMountColumns).toContain('status')
      expect(localMountColumns).toContain('created_at')
      expect(localMountColumns).toContain('updated_at')

      const localMountTableSql = (verifyDb.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'local_folder_mounts'"
      ).get() as { sql: string | null } | undefined)?.sql || ''
      const normalizedMountTableSql = localMountTableSql.toLowerCase().replace(/\s+/g, ' ')
      expect(normalizedMountTableSql).not.toContain('canonical_root_path text not null unique')
      expect(normalizedMountTableSql).not.toContain('canonical_compare_path text not null unique')

      const localIdentityColumns = (
        verifyDb.prepare("PRAGMA table_info(local_note_identity)").all() as Array<{ name: string }>
      ).map((column) => column.name)
      expect(localIdentityColumns).toContain('note_uid')
      expect(localIdentityColumns).toContain('notebook_id')
      expect(localIdentityColumns).toContain('relative_path')
      expect(localIdentityColumns).toContain('created_at')
      expect(localIdentityColumns).toContain('updated_at')

      const migratedMount = verifyDb.prepare(`
        SELECT root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
        FROM local_folder_mounts
        WHERE notebook_id = 'nb-legacy'
      `).get() as {
        root_path: string
        canonical_root_path: string | null
        canonical_compare_path: string | null
        status: string | null
        created_at: string | null
        updated_at: string | null
      } | undefined
      expect(migratedMount?.canonical_root_path).toBe(migratedMount?.root_path)
      expect(migratedMount?.canonical_compare_path).toBe(migratedMount?.canonical_root_path)
      expect(migratedMount?.status).toBe('active')
      expect(migratedMount?.created_at).toBeTruthy()
      expect(migratedMount?.updated_at).toBeTruthy()

      const legacyDuplicateMount = verifyDb.prepare(`
        SELECT status
        FROM local_folder_mounts
        WHERE notebook_id = 'nb-legacy-dup'
      `).get() as { status: string | null } | undefined
      expect(legacyDuplicateMount?.status).toBe('missing')

      const activeMountCount = verifyDb.prepare(`
        SELECT COUNT(*) as count
        FROM local_folder_mounts
        WHERE canonical_root_path = ?
          AND status = 'active'
      `).get('/tmp/sanqian-legacy-mount') as { count: number }
      expect(activeMountCount.count).toBe(1)

      const now = new Date().toISOString()
      verifyDb.prepare(`
        INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('nb-legacy-missing-2', 'Legacy Missing 2', 'logo:notes', 'local-folder', 99, now)
      expect(() => {
        verifyDb.prepare(`
          INSERT INTO local_folder_mounts (
            notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          'nb-legacy-missing-2',
          '/tmp/sanqian-legacy-mount',
          '/tmp/sanqian-legacy-mount',
          '/tmp/sanqian-legacy-mount',
          'missing',
          now,
          now
        )
      }).not.toThrow()

      expect(() => {
        verifyDb.prepare(`
          UPDATE local_folder_mounts
          SET status = 'active', updated_at = ?
          WHERE notebook_id = ?
        `).run(now, 'nb-legacy-missing-2')
      }).toThrow()

      const aiActionCount = verifyDb.prepare('SELECT COUNT(*) as count FROM ai_actions').get() as { count: number }
      expect(aiActionCount.count).toBeGreaterThan(0)

      const migrationFlag = verifyDb.prepare(
        "SELECT value FROM app_settings WHERE key = 'migration.frontmatter-node.v1'"
      ).get() as { value: string } | undefined
      expect(migrationFlag?.value).toBeTruthy()
    } finally {
      const failedUniqueIndexWarnings = warnSpy.mock.calls
        .map((call) => String(call[0] ?? ''))
        .filter((message) =>
          message.includes('Failed to enforce active unique canonical_compare_path index for local_folder_mounts')
        )
      expect(failedUniqueIndexWarnings).toHaveLength(0)
      warnSpy.mockRestore()
      verifyDb.close()
    }
  })

  it('allows remounting same canonical path when existing mount is missing on fresh schema', () => {
    closeDatabase()
    removeDbFiles(testDbDir)
    expect(() => initDatabase()).not.toThrow()

    const canonicalPath = '/tmp/sanqian-fresh-remount'
    expect(() => {
      createLocalFolderNotebookMount({
        name: 'Fresh Missing Mount',
        root_path: canonicalPath,
        canonical_root_path: canonicalPath,
        status: 'missing',
      })
    }).not.toThrow()

    expect(() => {
      createLocalFolderNotebookMount({
        name: 'Fresh Active Mount',
        root_path: canonicalPath,
        canonical_root_path: canonicalPath,
        status: 'active',
      })
    }).not.toThrow()

    const activeMount = getLocalFolderMountByCanonicalPath(canonicalPath, { activeOnly: true })
    expect(activeMount?.status).toBe('active')

    closeDatabase()
    const Sqlite = getSqliteCtor()
    const verifyDb = new Sqlite(dbPath, { readonly: true })
    try {
      const localMountTableSql = (verifyDb.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'local_folder_mounts'"
      ).get() as { sql: string | null } | undefined)?.sql || ''
      const normalizedMountTableSql = localMountTableSql.toLowerCase().replace(/\s+/g, ' ')
      expect(normalizedMountTableSql).not.toContain('canonical_root_path text not null unique')
      expect(normalizedMountTableSql).not.toContain('canonical_compare_path text not null unique')

      const mountStatusRows = verifyDb.prepare(`
        SELECT status, COUNT(*) as count
        FROM local_folder_mounts
        WHERE canonical_compare_path = ?
        GROUP BY status
      `).all(canonicalPath) as Array<{ status: string; count: number }>

      const countByStatus = new Map(mountStatusRows.map((row) => [row.status, row.count]))
      expect(countByStatus.get('active') || 0).toBe(1)
      expect(countByStatus.get('missing') || 0).toBe(1)
    } finally {
      verifyDb.close()
    }
  })
})
