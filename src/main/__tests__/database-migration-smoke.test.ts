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
  updateLocalFolderMountStatus,
} from '../database'
import { getDb } from '../database/connection'

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
    // Legacy corruption sample: orphan mount row whose notebook no longer exists.
    // This used to create invisible canonical conflicts in runtime lookups.
    legacyDb.exec('PRAGMA foreign_keys = OFF')
    legacyDb.prepare(`
      INSERT INTO local_folder_mounts (notebook_id, root_path)
      VALUES (?, ?)
    `).run('nb-legacy-orphan', '/tmp/sanqian-legacy-orphan')
    legacyDb.exec('PRAGMA foreign_keys = ON')
  } finally {
    legacyDb.close()
  }
}

function createDuplicateLocalFolderRemapSnapshotDatabase(dbPath: string): void {
  const Sqlite = getSqliteCtor()
  const legacyDb = new Sqlite(dbPath)
  try {
    legacyDb.exec(`
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT DEFAULT 'logo:notes',
        source_type TEXT NOT NULL DEFAULT 'internal',
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE local_folder_mounts (
        notebook_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        canonical_root_path TEXT NOT NULL,
        canonical_compare_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX idx_local_folder_mounts_canonical_compare_path_active_unique
        ON local_folder_mounts(canonical_compare_path)
        WHERE status = 'active';

      CREATE TABLE local_note_metadata (
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

      CREATE TABLE local_note_identity (
        note_uid TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(notebook_id, relative_path),
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );

      CREATE TABLE ai_popup_refs (
        popup_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'internal',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (popup_id, note_id)
      );

      CREATE TABLE ai_popups (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        action_name TEXT NOT NULL DEFAULT '',
        target_text TEXT NOT NULL,
        document_title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

    `)

    const now = '2026-03-01T00:00:00.000Z'
    const canonical = '/tmp/sanqian-remap-shared'

    legacyDb.prepare(`
      INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('nb-remap-winner', 'Winner Mount', 'logo:notes', 'local-folder', 0, now)
    legacyDb.prepare(`
      INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('nb-remap-dup', 'Duplicate Mount', 'logo:notes', 'local-folder', 1, now)
    legacyDb.prepare(`
      INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('nb-remap-dup-2', 'Duplicate Mount 2', 'logo:notes', 'local-folder', 2, now)

    legacyDb.prepare(`
      INSERT INTO local_folder_mounts (
        notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('nb-remap-winner', canonical, canonical, canonical, 'active', now, now)
    legacyDb.prepare(`
      INSERT INTO local_folder_mounts (
        notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('nb-remap-dup', canonical, canonical, canonical, 'missing', now, now)
    legacyDb.prepare(`
      INSERT INTO local_folder_mounts (
        notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('nb-remap-dup-2', canonical, canonical, canonical, 'permission_required', now, '2026-02-28T00:00:00.000Z')

    legacyDb.prepare(`
      INSERT INTO local_note_metadata (
        notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('nb-remap-winner', 'notes/a.md', 0, 0, null, null, JSON.stringify(['core']), null, now)
    legacyDb.prepare(`
      INSERT INTO local_note_metadata (
        notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'nb-remap-dup',
      'notes/a.md',
      1,
      1,
      'from duplicate',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      JSON.stringify(['dup', 'Core']),
      JSON.stringify(['ai-dup']),
      now
    )
    legacyDb.prepare(`
      INSERT INTO local_note_metadata (
        notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'nb-remap-dup',
      'notes/c.md',
      1,
      0,
      'unique duplicate',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      null,
      null,
      now
    )
    legacyDb.prepare(`
      INSERT INTO local_note_metadata (
        notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'nb-remap-dup-2',
      'notes/a.md',
      0,
      1,
      'from duplicate 2',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      JSON.stringify(['dup2']),
      JSON.stringify(['ai-dup2']),
      '2026-02-28T00:00:00.000Z'
    )
    legacyDb.prepare(`
      INSERT INTO local_note_metadata (
        notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'nb-remap-dup-2',
      'notes/d.md',
      0,
      1,
      'unique duplicate 2',
      'dddddddddddddddddddddddddddddddd',
      JSON.stringify(['dup2-only']),
      null,
      '2026-02-28T00:00:00.000Z'
    )

    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('uid-win-a', 'nb-remap-winner', 'notes/a.md', now, now)
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(' uid-dup-a ', 'nb-remap-dup', 'notes/a.md', now, now)
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('uid-dup-c', 'nb-remap-dup', 'notes/c.md', now, now)
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('uid-dup2-a', 'nb-remap-dup-2', 'notes/a.md', now, '2026-02-28T00:00:00.000Z')
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('uid-dup2-d', 'nb-remap-dup-2', 'notes/d.md', now, '2026-02-28T00:00:00.000Z')

    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-shared', 'legacy', 'Explain', 'target', 'Legacy', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-from-dup', 'legacy', 'Explain', 'target', 'Legacy', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-c', 'legacy', 'Explain', 'target', 'Legacy', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-collision', 'legacy', 'Explain', 'target', 'Legacy', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-from-dup2', 'legacy', 'Explain', 'target', 'Legacy', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-d', 'legacy', 'Explain', 'target', 'Legacy', now, now)

    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-shared', 'uid-win-a', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-from-dup', ' uid-dup-a ', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-c', 'uid-dup-c', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-collision', 'uid-win-a', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-collision', ' uid-dup-a ', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-from-dup2', 'uid-dup2-a', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-d', 'uid-dup2-d', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-collision', 'uid-dup2-a', 'local-folder', now, now)
  } finally {
    legacyDb.close()
  }
}

function relaxLegacyLocalNoteIdentityUniqueness(legacyDb: SqliteDatabase): void {
  legacyDb.exec('PRAGMA foreign_keys = OFF')
  try {
    legacyDb.exec(`
      ALTER TABLE local_note_identity RENAME TO local_note_identity_legacy;
      CREATE TABLE local_note_identity (
        note_uid TEXT NOT NULL,
        notebook_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity_legacy;
      DROP TABLE local_note_identity_legacy;
    `)
  } finally {
    legacyDb.exec('PRAGMA foreign_keys = ON')
  }
}

function createDuplicateLocalFolderRemapStaleWinnerIdentitySnapshotDatabase(dbPath: string): void {
  createDuplicateLocalFolderRemapSnapshotDatabase(dbPath)
  const Sqlite = getSqliteCtor()
  const legacyDb = new Sqlite(dbPath)
  try {
    relaxLegacyLocalNoteIdentityUniqueness(legacyDb)
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'uid-win-a-stale',
      'nb-remap-winner',
      'notes/a.md',
      '2026-02-27T00:00:00.000Z',
      '2026-02-27T00:00:00.000Z'
    )
  } finally {
    legacyDb.close()
  }
}

function createDuplicateLocalFolderRemapSameUidAliasSnapshotDatabase(dbPath: string): void {
  createDuplicateLocalFolderRemapSnapshotDatabase(dbPath)
  const Sqlite = getSqliteCtor()
  const legacyDb = new Sqlite(dbPath)
  try {
    relaxLegacyLocalNoteIdentityUniqueness(legacyDb)
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'uid-win-a',
      'nb-remap-dup',
      'notes/a.md',
      '2026-03-02T00:00:00.000Z',
      '2026-03-02T00:00:00.000Z'
    )
  } finally {
    legacyDb.close()
  }
}

function createDanglingLocalFolderNotebookSnapshotDatabase(dbPath: string): void {
  const Sqlite = getSqliteCtor()
  const legacyDb = new Sqlite(dbPath)
  try {
    legacyDb.exec(`
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT DEFAULT 'logo:notes',
        source_type TEXT NOT NULL DEFAULT 'internal',
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE local_folder_mounts (
        notebook_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        canonical_root_path TEXT NOT NULL,
        canonical_compare_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX idx_local_folder_mounts_canonical_compare_path_unique
        ON local_folder_mounts(canonical_compare_path);

      CREATE TABLE local_note_metadata (
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

      CREATE TABLE local_note_identity (
        note_uid TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(notebook_id, relative_path),
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );

      CREATE TABLE ai_popup_refs (
        popup_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'internal',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (popup_id, note_id)
      );

      CREATE TABLE ai_popups (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        action_name TEXT NOT NULL DEFAULT '',
        target_text TEXT NOT NULL,
        document_title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)

    const now = '2026-03-15T00:00:00.000Z'
    const canonical = '/tmp/sanqian-valid-mount'
    legacyDb.prepare(`
      INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('nb-valid', 'Valid Mount', 'logo:notes', 'local-folder', 0, now)
    legacyDb.prepare(`
      INSERT INTO local_folder_mounts (
        notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('nb-valid', canonical, canonical, canonical, 'active', now, now)

    legacyDb.prepare(`
      INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('nb-dangling', 'Dangling Mount', 'logo:notes', 'local-folder', 1, now)

    legacyDb.prepare(`
      INSERT INTO local_note_metadata (
        notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'nb-dangling',
      'dangling.md',
      1,
      0,
      'dangling summary',
      'cccccccccccccccccccccccccccccccc',
      JSON.stringify(['dangling']),
      null,
      now
    )
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('uid-dangling', 'nb-dangling', 'dangling.md', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-dangling', 'legacy', 'Explain', 'target', 'Legacy', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-orphan-local', 'legacy', 'Explain', 'target', 'Legacy', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-orphan-internal', 'legacy', 'Explain', 'target', 'Legacy', now, now)

    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-dangling', 'uid-dangling', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-orphan-local', 'uid-orphan-local', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-orphan-internal', 'note-orphan-internal', 'internal', now, now)
  } finally {
    legacyDb.close()
  }
}

function createInternalNotebookInvalidMountSnapshotDatabase(dbPath: string): void {
  const Sqlite = getSqliteCtor()
  const legacyDb = new Sqlite(dbPath)
  try {
    legacyDb.exec(`
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT DEFAULT 'logo:notes',
        source_type TEXT NOT NULL DEFAULT 'internal',
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE local_folder_mounts (
        notebook_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        canonical_root_path TEXT NOT NULL,
        canonical_compare_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX idx_local_folder_mounts_canonical_compare_path_unique
        ON local_folder_mounts(canonical_compare_path);
    `)

    const now = '2026-03-16T00:00:00.000Z'
    const validCanonical = '/tmp/sanqian-local-valid'
    const invalidCanonical = '/tmp/sanqian-internal-invalid-mount'
    legacyDb.prepare(`
      INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('nb-local-valid', 'Valid Local', 'logo:notes', 'local-folder', 0, now)
    legacyDb.prepare(`
      INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('nb-internal-corrupt', 'Internal Notebook', 'logo:notes', 'internal', 1, now)

    legacyDb.prepare(`
      INSERT INTO local_folder_mounts (
        notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('nb-local-valid', validCanonical, validCanonical, validCanonical, 'active', now, now)
    legacyDb.prepare(`
      INSERT INTO local_folder_mounts (
        notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('nb-internal-corrupt', invalidCanonical, invalidCanonical, invalidCanonical, 'active', now, now)
  } finally {
    legacyDb.close()
  }
}

function createLegacyLocalNoteUidRepairSnapshotDatabase(
  dbPath: string,
  options?: { bulkDirtyUidRows?: number }
): void {
  const Sqlite = getSqliteCtor()
  const legacyDb = new Sqlite(dbPath)
  try {
    legacyDb.exec(`
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT DEFAULT 'logo:notes',
        source_type TEXT NOT NULL DEFAULT 'internal',
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

      CREATE TABLE local_folder_mounts (
        notebook_id TEXT PRIMARY KEY,
        root_path TEXT NOT NULL,
        canonical_root_path TEXT NOT NULL,
        canonical_compare_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX idx_local_folder_mounts_canonical_compare_path_unique
        ON local_folder_mounts(canonical_compare_path);

      CREATE TABLE local_note_identity (
        note_uid TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(notebook_id, relative_path),
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );

      CREATE TABLE ai_popup_refs (
        popup_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'internal',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (popup_id, note_id)
      );

      CREATE TABLE ai_popups (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        action_name TEXT NOT NULL DEFAULT '',
        target_text TEXT NOT NULL,
        document_title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)

    const now = '2026-03-20T00:00:00.000Z'
    const canonical = '/tmp/sanqian-uid-repair'
    legacyDb.prepare(`
      INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('nb-uid-repair', 'UID Repair Mount', 'logo:notes', 'local-folder', 0, now)
    legacyDb.prepare(`
      INSERT INTO local_folder_mounts (
        notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('nb-uid-repair', canonical, canonical, canonical, 'active', now, now)

    legacyDb.prepare(`
      INSERT INTO notes (id, title, content, notebook_id, is_daily, daily_date, is_favorite, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('note-collision', 'Internal Collision', '{"type":"doc","content":[]}', null, 0, null, 0, now, now)

    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(' UID-TRIM-A ', 'nb-uid-repair', 'docs/a.md', now, now)
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('UID-TRIM-A', 'nb-uid-repair', 'docs/b.md', now, now)
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53', 'nb-uid-repair', 'docs/c.md', now, now)
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('note-collision', 'nb-uid-repair', 'docs/d.md', now, now)
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('   ', 'nb-uid-repair', 'docs/e.md', now, now)
    const bulkDirtyUidRows = Math.max(0, Math.trunc(Number(options?.bulkDirtyUidRows || 0)))
    for (let index = 0; index < bulkDirtyUidRows; index += 1) {
      legacyDb.prepare(`
        INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(` uid-bulk-${index} `, 'nb-uid-repair', `docs/bulk-${index}.md`, now, now)
    }

    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-trim', 'legacy', 'Explain', 'target', 'Legacy', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-uuid', 'legacy', 'Explain', 'target', 'Legacy', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-collision', 'legacy', 'Explain', 'target', 'Legacy', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-blank', 'legacy', 'Explain', 'target', 'Legacy', now, now)

    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-trim', ' UID-TRIM-A ', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-uuid', 'EF84FB2A-8F5E-4E21-BD24-E1D6F2627D53', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-collision', 'note-collision', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-blank', '   ', 'local-folder', now, now)
    legacyDb.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run('migration.local-note-uid-repair.v1', 'invalid-json', now)
  } finally {
    legacyDb.close()
  }
}

function createLegacyDuplicateUidLocalNoteIdentitySnapshotDatabase(dbPath: string): void {
  createLegacyLocalNoteUidRepairSnapshotDatabase(dbPath)
  const Sqlite = getSqliteCtor()
  const legacyDb = new Sqlite(dbPath)
  try {
    legacyDb.exec('PRAGMA foreign_keys = OFF')
    legacyDb.exec(`
      ALTER TABLE local_note_identity RENAME TO local_note_identity_legacy;
      CREATE TABLE local_note_identity (
        note_uid TEXT NOT NULL,
        notebook_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity_legacy;
      DROP TABLE local_note_identity_legacy;
    `)

    const now = '2026-03-21T00:00:00.000Z'
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('UID-TRIM-A', 'nb-uid-repair', 'docs/dup.md', now, now)
  } finally {
    legacyDb.exec('PRAGMA foreign_keys = ON')
    legacyDb.close()
  }
}

function createLegacyAmbiguousLocalUidPopupRefSnapshotDatabase(dbPath: string): void {
  createLegacyDuplicateUidLocalNoteIdentitySnapshotDatabase(dbPath)
  const Sqlite = getSqliteCtor()
  const legacyDb = new Sqlite(dbPath)
  try {
    const now = '2026-03-22T00:00:00.000Z'
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(' DUP-AMBIG ', 'nb-uid-repair', 'docs/ambig-a.md', now, now)
    legacyDb.prepare(`
      INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(' DUP-AMBIG ', 'nb-uid-repair', 'docs/ambig-b.md', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', ?, ?, ?, ?, ?, ?)
    `).run('popup-ambig', 'legacy', 'Explain', 'target', 'Legacy', now, now)
    legacyDb.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('popup-ambig', ' DUP-AMBIG ', 'local-folder', now, now)
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

    // Legacy duplicates are pruned so canonical local-folder mounts stay globally unique.
    const duplicateConflict = getLocalFolderMountByCanonicalPath('/tmp/sanqian-legacy-mount', {
      excludeNotebookId: 'nb-legacy',
      activeOnly: true,
    })
    expect(duplicateConflict).toBeNull()
    const orphanConflict = getLocalFolderMountByCanonicalPath('/tmp/sanqian-legacy-orphan')
    expect(orphanConflict).toBeNull()

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
      expect(notebookSourceType?.source_type).toBe('local-folder')

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
      expect(indexNames).toContain('idx_local_folder_mounts_canonical_compare_path_unique')
      expect(indexNames).toContain('idx_local_note_identity_notebook_id')
      expect(indexNames).toContain('idx_local_note_identity_updated_at')
      expect(indexNames).not.toContain('idx_local_folder_mounts_canonical_root_path_lookup')

      const triggerNames = (
        verifyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{ name: string }>
      ).map((row) => row.name)
      expect(triggerNames).toContain('trg_notebooks_source_type_validate_insert')
      expect(triggerNames).toContain('trg_notebooks_source_type_validate_update')
      expect(triggerNames).toContain('trg_notebooks_source_type_validate_local_mounts')
      expect(triggerNames).toContain('trg_local_folder_mounts_status_validate_insert')
      expect(triggerNames).toContain('trg_local_folder_mounts_status_validate_update')
      expect(triggerNames).toContain('trg_local_folder_mounts_notebook_source_validate_insert')
      expect(triggerNames).toContain('trg_local_folder_mounts_notebook_source_validate_update')
      expect(triggerNames).toContain('trg_local_note_identity_note_uid_validate_insert')
      expect(triggerNames).toContain('trg_local_note_identity_note_uid_validate_update')
      expect(triggerNames).toContain('trg_local_note_identity_note_uid_conflict_validate_insert')
      expect(triggerNames).toContain('trg_local_note_identity_note_uid_conflict_validate_update')
      expect(triggerNames).toContain('trg_notes_id_conflict_with_local_identity_validate_insert')
      expect(triggerNames).toContain('trg_notes_id_conflict_with_local_identity_validate_update')
      expect(triggerNames).toContain('trg_ai_popup_refs_source_type_validate_insert')
      expect(triggerNames).toContain('trg_ai_popup_refs_source_type_validate_update')
      expect(triggerNames).toContain('trg_ai_popup_refs_popup_reference_validate_insert')
      expect(triggerNames).toContain('trg_ai_popup_refs_popup_reference_validate_update')
      expect(triggerNames).toContain('trg_ai_popup_refs_note_reference_validate_insert')
      expect(triggerNames).toContain('trg_ai_popup_refs_note_reference_validate_update')

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

      const legacyDuplicateMountCount = verifyDb.prepare(`
        SELECT COUNT(*) as count
        FROM local_folder_mounts
        WHERE notebook_id = 'nb-legacy-dup'
      `).get() as { count: number }
      expect(legacyDuplicateMountCount.count).toBe(0)
      const orphanMountCount = verifyDb.prepare(`
        SELECT COUNT(*) as count
        FROM local_folder_mounts
        WHERE notebook_id = 'nb-legacy-orphan'
      `).get() as { count: number }
      expect(orphanMountCount.count).toBe(0)

      const activeMountCount = verifyDb.prepare(`
        SELECT COUNT(*) as count
        FROM local_folder_mounts
        WHERE canonical_root_path = ?
          AND status = 'active'
      `).get('/tmp/sanqian-legacy-mount') as { count: number }
      expect(activeMountCount.count).toBe(1)

      const now = new Date().toISOString()
      expect(() => {
        verifyDb.prepare(`
          INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run('nb-legacy-invalid-source', 'Legacy Invalid', 'logo:notes', 'external', 98, now)
      }).toThrow()
      expect(() => {
        verifyDb.prepare(`
          UPDATE notebooks
          SET source_type = 'external'
          WHERE id = 'nb-legacy'
        `).run()
      }).toThrow()
      expect(() => {
        verifyDb.prepare(`
          UPDATE notebooks
          SET source_type = 'internal'
          WHERE id = 'nb-legacy'
        `).run()
      }).toThrow()

      verifyDb.prepare(`
        INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('nb-legacy-internal-1', 'Legacy Internal 1', 'logo:notes', 'internal', 97, now)
      expect(() => {
        verifyDb.prepare(`
          INSERT INTO local_folder_mounts (
            notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          'nb-legacy-internal-1',
          '/tmp/sanqian-legacy-internal-mount',
          '/tmp/sanqian-legacy-internal-mount',
          '/tmp/sanqian-legacy-internal-mount',
          'active',
          now,
          now
        )
      }).toThrow()

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
      }).toThrow()
      expect(() => {
        verifyDb.prepare(`
          UPDATE local_folder_mounts
          SET status = 'external', updated_at = ?
          WHERE notebook_id = ?
        `).run(now, 'nb-legacy')
      }).toThrow()

      const aiActionCount = verifyDb.prepare('SELECT COUNT(*) as count FROM ai_actions').get() as { count: number }
      expect(aiActionCount.count).toBeGreaterThan(0)

      verifyDb.prepare(`
        INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
        VALUES (?, '', ?, ?, ?, ?, ?, ?)
      `).run('popup-valid-source', 'legacy', 'Explain', 'target', 'Legacy', now, now)
      verifyDb.prepare(`
        INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
        VALUES (?, '', ?, ?, ?, ?, ?, ?)
      `).run('popup-valid-note-local', 'legacy', 'Explain', 'target', 'Legacy', now, now)
      verifyDb.prepare(`
        INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
        VALUES (?, '', ?, ?, ?, ?, ?, ?)
      `).run('popup-invalid-note-internal', 'legacy', 'Explain', 'target', 'Legacy', now, now)
      verifyDb.prepare(`
        INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
        VALUES (?, '', ?, ?, ?, ?, ?, ?)
      `).run('popup-invalid-note-local', 'legacy', 'Explain', 'target', 'Legacy', now, now)

      expect(() => {
        verifyDb.prepare(`
          INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('popup-invalid-source', 'note-legacy', 'external', now, now)
      }).toThrow()
      expect(() => {
        verifyDb.prepare(`
          INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('popup-missing-reference', 'note-legacy', 'internal', now, now)
      }).toThrow()
      expect(() => {
        verifyDb.prepare(`
          INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('popup-valid-source', 'note-legacy', 'internal', now, now)
      }).not.toThrow()
      expect(() => {
        verifyDb.prepare(`
          INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('popup-invalid-note-internal', 'note-missing-ref', 'internal', now, now)
      }).toThrow()
      expect(() => {
        verifyDb.prepare(`
          INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('popup-invalid-note-local', 'uid-missing-ref', 'local-folder', now, now)
      }).toThrow()
      verifyDb.prepare(`
        INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('uid-valid-ref', 'nb-legacy', 'docs/valid-ref.md', now, now)
      expect(() => {
        verifyDb.prepare(`
          INSERT INTO notes (id, title, content, notebook_id, is_daily, daily_date, is_favorite, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          'uid-valid-ref',
          'Collision Note',
          '{"type":"doc","content":[]}',
          'nb-legacy',
          0,
          null,
          0,
          now,
          now
        )
      }).toThrow()
      expect(() => {
        verifyDb.prepare(`
          INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('popup-valid-note-local', 'uid-valid-ref', 'local-folder', now, now)
      }).not.toThrow()
      expect(() => {
        verifyDb.prepare(`
          UPDATE ai_popup_refs
          SET source_type = 'external'
          WHERE popup_id = 'popup-valid-source' AND note_id = 'note-legacy'
        `).run()
      }).toThrow()

      const migrationFlag = verifyDb.prepare(
        "SELECT value FROM app_settings WHERE key = 'migration.frontmatter-node.v1'"
      ).get() as { value: string } | undefined
      expect(migrationFlag?.value).toBeTruthy()
    } finally {
      const duplicateCanonicalWarnings = warnSpy.mock.calls
        .map((call) => String(call[0] ?? ''))
        .filter((message) =>
          message.includes('Found')
          && message.includes('duplicate canonical local-folder mount group')
        )
      expect(duplicateCanonicalWarnings).toHaveLength(0)
      const prunedDuplicateWarnings = warnSpy.mock.calls
        .map((call) => String(call[0] ?? ''))
        .filter((message) =>
          message.includes('Pruned')
          && message.includes('duplicate local-folder mount row')
        )
      expect(prunedDuplicateWarnings.length).toBeGreaterThan(0)

      warnSpy.mockRestore()
      verifyDb.close()
    }
  })

  it('blocks duplicate canonical path mount even when existing mount is missing', () => {
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
    }).toThrow()

    const matchedMount = getLocalFolderMountByCanonicalPath(canonicalPath)
    expect(matchedMount?.status).toBe('missing')

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

      const notebooksTableSql = (verifyDb.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notebooks'"
      ).get() as { sql: string | null } | undefined)?.sql || ''
      const normalizedNotebooksTableSql = notebooksTableSql.toLowerCase().replace(/\s+/g, ' ')
      expect(normalizedNotebooksTableSql).toContain("check (source_type in ('internal', 'local-folder'))")

      const aiPopupRefsTableSql = (verifyDb.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ai_popup_refs'"
      ).get() as { sql: string | null } | undefined)?.sql || ''
      const normalizedAiPopupRefsTableSql = aiPopupRefsTableSql.toLowerCase().replace(/\s+/g, ' ')
      expect(normalizedAiPopupRefsTableSql).toContain("check (source_type in ('internal', 'local-folder'))")

      const mountStatusRows = verifyDb.prepare(`
        SELECT status, COUNT(*) as count
        FROM local_folder_mounts
        WHERE canonical_compare_path = ?
        GROUP BY status
      `).all(canonicalPath) as Array<{ status: string; count: number }>

      const countByStatus = new Map(mountStatusRows.map((row) => [row.status, row.count]))
      expect(countByStatus.get('missing') || 0).toBe(1)
      expect(countByStatus.get('active') || 0).toBe(0)
    } finally {
      verifyDb.close()
    }
  })

  it('enforces global canonical path uniqueness at SQL level for all mount statuses', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => initDatabase()).not.toThrow()
    const db = getDb()
    const now = new Date().toISOString()
    const canonicalPath = '/tmp/sanqian-legacy-global-unique'
    const missingNotebookId = 'nb-legacy-missing-promote'
    db.prepare(`
      INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(missingNotebookId, 'Legacy Missing Promote', 'logo:notes', 'local-folder', 100, now)
    db.prepare(`
      INSERT INTO local_folder_mounts (
        notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      missingNotebookId,
      canonicalPath,
      canonicalPath,
      canonicalPath,
      'missing',
      now,
      now
    )
    expect(updateLocalFolderMountStatus(missingNotebookId, 'active')).toBe('updated')
    expect(updateLocalFolderMountStatus(missingNotebookId, 'active')).toBe('no_change')
    expect(() => {
      db.prepare(`
        INSERT INTO notebooks (id, name, icon, source_type, order_index, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('nb-legacy-missing-promote-dup', 'Legacy Missing Promote Dup', 'logo:notes', 'local-folder', 101, now)
      db.prepare(`
        INSERT INTO local_folder_mounts (
          notebook_id, root_path, canonical_root_path, canonical_compare_path, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        'nb-legacy-missing-promote-dup',
        canonicalPath,
        canonicalPath,
        canonicalPath,
        'missing',
        now,
        now
      )
    }).toThrow()
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining(
      'Skip local-folder status update due canonical-path conflict'
    ))
    warnSpy.mockRestore()
  })

  it('removes invalid local-folder mount rows for internal notebooks without coercing notebook source_type', () => {
    closeDatabase()
    removeDbFiles(testDbDir)
    createInternalNotebookInvalidMountSnapshotDatabase(dbPath)

    expect(() => initDatabase()).not.toThrow()
    const db = getDb()

    const internalSourceType = db.prepare(`
      SELECT source_type
      FROM notebooks
      WHERE id = 'nb-internal-corrupt'
    `).get() as { source_type: string } | undefined
    expect(internalSourceType?.source_type).toBe('internal')

    const invalidMountCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_folder_mounts
      WHERE notebook_id = 'nb-internal-corrupt'
    `).get() as { count: number }
    expect(invalidMountCount.count).toBe(0)

    const validMountCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_folder_mounts
      WHERE notebook_id = 'nb-local-valid'
    `).get() as { count: number }
    expect(validMountCount.count).toBe(1)
  })

  it('consolidates duplicate notebook artifacts when pruning duplicate canonical mounts', () => {
    closeDatabase()
    removeDbFiles(testDbDir)
    createDuplicateLocalFolderRemapSnapshotDatabase(dbPath)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => initDatabase()).not.toThrow()

    const db = getDb()
    const duplicatedNotebookCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM notebooks
      WHERE id IN ('nb-remap-dup', 'nb-remap-dup-2')
    `).get() as { count: number }
    expect(duplicatedNotebookCount.count).toBe(0)

    const winnerMetadata = db.prepare(`
      SELECT is_favorite, is_pinned, ai_summary, tags_json, ai_tags_json
      FROM local_note_metadata
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-remap-winner', 'notes/a.md') as {
      is_favorite: number
      is_pinned: number
      ai_summary: string | null
      tags_json: string | null
      ai_tags_json: string | null
    } | undefined
    expect(winnerMetadata?.is_favorite).toBe(1)
    expect(winnerMetadata?.is_pinned).toBe(1)
    expect(winnerMetadata?.ai_summary).toBe('from duplicate')
    const mergedTags = new Set(
      (winnerMetadata?.tags_json ? JSON.parse(winnerMetadata.tags_json) as string[] : []).map((tag) => tag.toLowerCase())
    )
    expect(mergedTags.has('core')).toBe(true)
    expect(mergedTags.has('dup')).toBe(true)
    expect(mergedTags.has('dup2')).toBe(true)
    const mergedAiTags = new Set(
      (winnerMetadata?.ai_tags_json ? JSON.parse(winnerMetadata.ai_tags_json) as string[] : []).map((tag) => tag.toLowerCase())
    )
    expect(mergedAiTags.has('ai-dup')).toBe(true)
    expect(mergedAiTags.has('ai-dup2')).toBe(true)

    const movedMetadata = db.prepare(`
      SELECT is_favorite, ai_summary
      FROM local_note_metadata
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-remap-winner', 'notes/c.md') as { is_favorite: number; ai_summary: string | null } | undefined
    expect(movedMetadata?.is_favorite).toBe(1)
    expect(movedMetadata?.ai_summary).toBe('unique duplicate')
    const movedMetadataD = db.prepare(`
      SELECT is_pinned, ai_summary
      FROM local_note_metadata
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-remap-winner', 'notes/d.md') as { is_pinned: number; ai_summary: string | null } | undefined
    expect(movedMetadataD?.is_pinned).toBe(1)
    expect(movedMetadataD?.ai_summary).toBe('unique duplicate 2')

    const winnerIdentityA = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-remap-winner', 'notes/a.md') as { note_uid: string } | undefined
    expect(winnerIdentityA?.note_uid).toBe('uid-win-a')
    const winnerIdentityC = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-remap-winner', 'notes/c.md') as { note_uid: string } | undefined
    expect(winnerIdentityC?.note_uid).toBe('uid-dup-c')
    const winnerIdentityD = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-remap-winner', 'notes/d.md') as { note_uid: string } | undefined
    expect(winnerIdentityD?.note_uid).toBe('uid-dup2-d')

    const duplicateIdentityCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_note_identity
      WHERE notebook_id IN ('nb-remap-dup', 'nb-remap-dup-2')
    `).get() as { count: number }
    expect(duplicateIdentityCount.count).toBe(0)

    const duplicatePopupRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE source_type = 'local-folder' AND note_id = ?
    `).get(' uid-dup-a ') as { count: number }
    expect(duplicatePopupRefCount.count).toBe(0)
    const duplicatePopupRefCount2 = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE source_type = 'local-folder' AND note_id = 'uid-dup2-a'
    `).get() as { count: number }
    expect(duplicatePopupRefCount2.count).toBe(0)
    const remappedPopup = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = 'popup-from-dup'
    `).get() as { note_id: string } | undefined
    expect(remappedPopup?.note_id).toBe('uid-win-a')
    const remappedPopup2 = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = 'popup-from-dup2'
    `).get() as { note_id: string } | undefined
    expect(remappedPopup2?.note_id).toBe('uid-win-a')
    const remappedPopupD = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = 'popup-d'
    `).get() as { note_id: string } | undefined
    expect(remappedPopupD?.note_id).toBe('uid-dup2-d')
    const collisionPopupCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE popup_id = 'popup-collision' AND note_id = 'uid-win-a'
    `).get() as { count: number }
    expect(collisionPopupCount.count).toBe(1)

    const consolidateWarnings = warnSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((message) => message.includes('Consolidated duplicate local-folder notebooks'))
    expect(consolidateWarnings.length).toBeGreaterThan(0)
    closeDatabase()
    expect(() => initDatabase()).not.toThrow()

    const consolidateWarningsAfterSecondRun = warnSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((message) => message.includes('Consolidated duplicate local-folder notebooks'))
    expect(consolidateWarningsAfterSecondRun.length).toBe(consolidateWarnings.length)

    const dbAfterSecondRun = getDb()
    const duplicatedNotebookCountAfterSecondRun = dbAfterSecondRun.prepare(`
      SELECT COUNT(*) as count
      FROM notebooks
      WHERE id IN ('nb-remap-dup', 'nb-remap-dup-2')
    `).get() as { count: number }
    expect(duplicatedNotebookCountAfterSecondRun.count).toBe(0)
    const winnerIdentityAfterSecondRun = dbAfterSecondRun.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-remap-winner', 'notes/c.md') as { note_uid: string } | undefined
    expect(winnerIdentityAfterSecondRun?.note_uid).toBe('uid-dup-c')
    const winnerIdentityDAfterSecondRun = dbAfterSecondRun.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-remap-winner', 'notes/d.md') as { note_uid: string } | undefined
    expect(winnerIdentityDAfterSecondRun?.note_uid).toBe('uid-dup2-d')

    warnSpy.mockRestore()
  })

  it('remaps duplicate notebook popup refs to freshest winner uid when winner path has stale dirty aliases', () => {
    closeDatabase()
    removeDbFiles(testDbDir)
    createDuplicateLocalFolderRemapStaleWinnerIdentitySnapshotDatabase(dbPath)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => initDatabase()).not.toThrow()
    const db = getDb()

    const remappedPopup = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = 'popup-from-dup'
    `).get() as { note_id: string } | undefined
    expect(remappedPopup?.note_id).toBe('uid-win-a')

    const remappedPopup2 = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = 'popup-from-dup2'
    `).get() as { note_id: string } | undefined
    expect(remappedPopup2?.note_id).toBe('uid-win-a')

    warnSpy.mockRestore()
  })

  it('merges same-uid same-path identity aliases instead of moving duplicate rows into winner notebook', () => {
    closeDatabase()
    removeDbFiles(testDbDir)
    createDuplicateLocalFolderRemapSameUidAliasSnapshotDatabase(dbPath)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => initDatabase()).not.toThrow()
    const db = getDb()

    const winnerUidCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_note_identity
      WHERE notebook_id = ?
        AND relative_path = ?
        AND note_uid = ?
    `).get('nb-remap-winner', 'notes/a.md', 'uid-win-a') as { count: number }
    expect(winnerUidCount.count).toBe(1)

    const duplicatedNotebookCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM notebooks
      WHERE id = ?
    `).get('nb-remap-dup') as { count: number }
    expect(duplicatedNotebookCount.count).toBe(0)

    warnSpy.mockRestore()
  })

  it('cleans dangling local-folder notebooks without mount and cascades local artifacts', () => {
    closeDatabase()
    removeDbFiles(testDbDir)
    createDanglingLocalFolderNotebookSnapshotDatabase(dbPath)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => initDatabase()).not.toThrow()

    const db = getDb()
    const danglingNotebookCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM notebooks
      WHERE id = 'nb-dangling'
    `).get() as { count: number }
    expect(danglingNotebookCount.count).toBe(0)

    const validNotebookCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM notebooks
      WHERE id = 'nb-valid'
    `).get() as { count: number }
    expect(validNotebookCount.count).toBe(1)

    const danglingMetadataCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_note_metadata
      WHERE notebook_id = 'nb-dangling'
    `).get() as { count: number }
    expect(danglingMetadataCount.count).toBe(0)

    const danglingIdentityCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_note_identity
      WHERE notebook_id = 'nb-dangling'
    `).get() as { count: number }
    expect(danglingIdentityCount.count).toBe(0)

    const danglingPopupRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE source_type = 'local-folder' AND note_id = 'uid-dangling'
    `).get() as { count: number }
    expect(danglingPopupRefCount.count).toBe(0)
    const orphanLocalPopupRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE source_type = 'local-folder' AND note_id = 'uid-orphan-local'
    `).get() as { count: number }
    expect(orphanLocalPopupRefCount.count).toBe(0)
    const orphanInternalPopupRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE source_type = 'internal' AND note_id = 'note-orphan-internal'
    `).get() as { count: number }
    expect(orphanInternalPopupRefCount.count).toBe(0)

    const danglingWarnings = warnSpy.mock.calls
      .map((call) => String(call[0] ?? ''))
      .filter((message) => message.includes('Removed') && message.includes('dangling local-folder notebook'))
    expect(danglingWarnings.length).toBeGreaterThan(0)
    warnSpy.mockRestore()
  })

  it('repairs legacy local note uid aliases and remaps local-folder popup refs', () => {
    closeDatabase()
    removeDbFiles(testDbDir)
    createLegacyLocalNoteUidRepairSnapshotDatabase(dbPath)

    expect(() => initDatabase()).not.toThrow()
    const db = getDb()

    const uidA = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-uid-repair', 'docs/a.md') as { note_uid: string } | undefined
    const uidB = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-uid-repair', 'docs/b.md') as { note_uid: string } | undefined
    const uidC = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-uid-repair', 'docs/c.md') as { note_uid: string } | undefined
    const uidD = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-uid-repair', 'docs/d.md') as { note_uid: string } | undefined
    const uidE = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-uid-repair', 'docs/e.md') as { note_uid: string } | undefined

    expect(uidA?.note_uid).toBeTruthy()
    expect(uidA?.note_uid).toBe(uidA?.note_uid.trim())
    expect(uidA?.note_uid).not.toBe(' UID-TRIM-A ')
    expect(uidA?.note_uid).not.toBe('UID-TRIM-A')
    expect(uidB?.note_uid).toBe('UID-TRIM-A')
    expect(uidC?.note_uid).toBe('ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
    expect(uidD?.note_uid).toBeTruthy()
    expect(uidD?.note_uid).not.toBe('note-collision')
    expect(uidE?.note_uid).toBeTruthy()
    expect(uidE?.note_uid).toBe(uidE?.note_uid.trim())
    expect(uidE?.note_uid).not.toBe('   ')

    const popupTrim = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-trim') as { note_id: string } | undefined
    const popupUuid = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-uuid') as { note_id: string } | undefined
    const popupCollision = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-collision') as { note_id: string } | undefined
    const popupBlank = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-blank') as { note_id: string } | undefined
    expect(popupTrim?.note_id).toBe(uidA?.note_uid)
    expect(popupUuid?.note_id).toBe('ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
    expect(popupCollision?.note_id).toBe(uidD?.note_uid)
    expect(popupCollision?.note_id).not.toBe('note-collision')
    expect(popupBlank?.note_id).toBe(uidE?.note_uid)

    const invalidUidCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_note_identity
      WHERE note_uid <> TRIM(note_uid)
         OR LENGTH(TRIM(note_uid)) = 0
    `).get() as { count: number }
    expect(invalidUidCount.count).toBe(0)

    const orphanLocalPopupRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE source_type = 'local-folder'
        AND note_id NOT IN (SELECT note_uid FROM local_note_identity)
    `).get() as { count: number }
    expect(orphanLocalPopupRefCount.count).toBe(0)

    const localNoteUidRepairMigrationSetting = db.prepare(`
      SELECT value
      FROM app_settings
      WHERE key = ?
    `).get('migration.local-note-uid-repair.v1') as { value: string } | undefined
    expect(localNoteUidRepairMigrationSetting?.value).toBeTruthy()
    const localNoteUidRepairMigrationMeta = localNoteUidRepairMigrationSetting
      ? JSON.parse(localNoteUidRepairMigrationSetting.value) as {
        normalizedUidRows: number
        regeneratedUidRows: number
        mergedAliasRows: number
        removedInvalidUidRows: number
        remappedPopupRefs: number
        removedPopupRefs: number
        unresolvedRows: number
        migratedAt: string
      }
      : null
    expect(localNoteUidRepairMigrationMeta?.unresolvedRows).toBe(0)
    expect(
      Number(localNoteUidRepairMigrationMeta?.normalizedUidRows || 0)
      + Number(localNoteUidRepairMigrationMeta?.regeneratedUidRows || 0)
      + Number(localNoteUidRepairMigrationMeta?.mergedAliasRows || 0)
      + Number(localNoteUidRepairMigrationMeta?.remappedPopupRefs || 0)
    ).toBeGreaterThan(0)
    expect(typeof localNoteUidRepairMigrationMeta?.migratedAt).toBe('string')

    const now = new Date().toISOString()
    expect(() => {
      db.prepare(`
        INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(' uid-invalid ', 'nb-uid-repair', 'docs/f.md', now, now)
    }).toThrow()
    expect(() => {
      db.prepare(`
        INSERT INTO local_note_identity (note_uid, notebook_id, relative_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('note-collision', 'nb-uid-repair', 'docs/g.md', now, now)
    }).toThrow()

    const firstUidA = uidA?.note_uid || null
    const firstUidD = uidD?.note_uid || null
    const firstUidE = uidE?.note_uid || null
    const firstLocalNoteUidRepairMigrationSettingValue = localNoteUidRepairMigrationSetting?.value || null
    closeDatabase()
    expect(() => initDatabase()).not.toThrow()
    const dbAfterSecondRun = getDb()
    const uidAAfterSecondRun = dbAfterSecondRun.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-uid-repair', 'docs/a.md') as { note_uid: string } | undefined
    const uidDAfterSecondRun = dbAfterSecondRun.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-uid-repair', 'docs/d.md') as { note_uid: string } | undefined
    const uidEAfterSecondRun = dbAfterSecondRun.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get('nb-uid-repair', 'docs/e.md') as { note_uid: string } | undefined
    expect(uidAAfterSecondRun?.note_uid || null).toBe(firstUidA)
    expect(uidDAfterSecondRun?.note_uid || null).toBe(firstUidD)
    expect(uidEAfterSecondRun?.note_uid || null).toBe(firstUidE)
    const localNoteUidRepairMigrationSettingAfterSecondRun = dbAfterSecondRun.prepare(`
      SELECT value
      FROM app_settings
      WHERE key = ?
    `).get('migration.local-note-uid-repair.v1') as { value: string } | undefined
    expect(localNoteUidRepairMigrationSettingAfterSecondRun?.value || null).toBe(
      firstLocalNoteUidRepairMigrationSettingValue
    )
  })

  it('repairs local note uid aliases across multiple migration batches', () => {
    closeDatabase()
    removeDbFiles(testDbDir)
    const bulkDirtyUidRows = 650
    createLegacyLocalNoteUidRepairSnapshotDatabase(dbPath, { bulkDirtyUidRows })

    expect(() => initDatabase()).not.toThrow()
    const db = getDb()

    const bulkRows = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_note_identity
      WHERE notebook_id = ?
        AND relative_path LIKE 'docs/bulk-%'
    `).get('nb-uid-repair') as { count: number }
    expect(bulkRows.count).toBe(bulkDirtyUidRows)

    const normalizedBulkRows = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_note_identity
      WHERE notebook_id = ?
        AND relative_path LIKE 'docs/bulk-%'
        AND note_uid LIKE 'uid-bulk-%'
        AND note_uid = TRIM(note_uid)
    `).get('nb-uid-repair') as { count: number }
    expect(normalizedBulkRows.count).toBe(bulkDirtyUidRows)

    const localNoteUidRepairMigrationSetting = db.prepare(`
      SELECT value
      FROM app_settings
      WHERE key = ?
    `).get('migration.local-note-uid-repair.v1') as { value: string } | undefined
    expect(localNoteUidRepairMigrationSetting?.value).toBeTruthy()
    const localNoteUidRepairMigrationMeta = localNoteUidRepairMigrationSetting
      ? JSON.parse(localNoteUidRepairMigrationSetting.value) as {
        normalizedUidRows: number
        unresolvedRows: number
      }
      : null
    expect(localNoteUidRepairMigrationMeta?.unresolvedRows).toBe(0)
    expect(Number(localNoteUidRepairMigrationMeta?.normalizedUidRows || 0)).toBeGreaterThanOrEqual(bulkDirtyUidRows)
  })

  it('does not crash uid repair migration when legacy local_note_identity contains duplicate note_uid rows', () => {
    closeDatabase()
    removeDbFiles(testDbDir)
    createLegacyDuplicateUidLocalNoteIdentitySnapshotDatabase(dbPath)

    expect(() => initDatabase()).not.toThrow()
    const db = getDb()

    const duplicateUidRows = db.prepare(`
      SELECT relative_path
      FROM local_note_identity
      WHERE note_uid = ?
      ORDER BY relative_path ASC
    `).all('UID-TRIM-A') as Array<{ relative_path: string }>
    expect(duplicateUidRows.length).toBeGreaterThanOrEqual(2)

    const invalidUidCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_note_identity
      WHERE note_uid <> TRIM(note_uid)
         OR LENGTH(TRIM(note_uid)) = 0
    `).get() as { count: number }
    expect(invalidUidCount.count).toBe(0)

    const popupTrim = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-trim') as { note_id: string } | undefined
    expect(popupTrim?.note_id).toBeTruthy()
    const popupTrimRefExists = db.prepare(`
      SELECT 1 as ok
      FROM local_note_identity
      WHERE note_uid = ?
      LIMIT 1
    `).get(popupTrim?.note_id || null) as { ok: number } | undefined
    expect(Boolean(popupTrimRefExists?.ok)).toBe(true)

    const localNoteUidRepairMigrationSetting = db.prepare(`
      SELECT value
      FROM app_settings
      WHERE key = ?
    `).get('migration.local-note-uid-repair.v1') as { value: string } | undefined
    expect(localNoteUidRepairMigrationSetting?.value).toBeTruthy()
    const localNoteUidRepairMigrationMeta = localNoteUidRepairMigrationSetting
      ? JSON.parse(localNoteUidRepairMigrationSetting.value) as { unresolvedRows: number }
      : null
    expect(localNoteUidRepairMigrationMeta?.unresolvedRows).toBe(0)
  })

  it('fails closed for popup ref remap when legacy uid aliases are ambiguous across multiple rows', () => {
    closeDatabase()
    removeDbFiles(testDbDir)
    createLegacyAmbiguousLocalUidPopupRefSnapshotDatabase(dbPath)

    expect(() => initDatabase()).not.toThrow()
    const db = getDb()

    const repairedAmbiguousRows = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ?
        AND relative_path IN ('docs/ambig-a.md', 'docs/ambig-b.md')
      ORDER BY relative_path ASC
    `).all('nb-uid-repair') as Array<{ note_uid: string }>
    expect(repairedAmbiguousRows.length).toBe(2)
    expect(repairedAmbiguousRows[0]?.note_uid).not.toBe(' DUP-AMBIG ')
    expect(repairedAmbiguousRows[1]?.note_uid).not.toBe(' DUP-AMBIG ')
    expect(new Set(repairedAmbiguousRows.map((row) => row.note_uid)).size).toBe(2)
    expect(repairedAmbiguousRows.some((row) => row.note_uid === 'DUP-AMBIG')).toBe(true)

    const popupAmbig = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-ambig') as { note_id: string } | undefined
    expect(popupAmbig).toBeUndefined()

    const orphanLocalPopupRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE source_type = 'local-folder'
        AND note_id NOT IN (SELECT note_uid FROM local_note_identity)
    `).get() as { count: number }
    expect(orphanLocalPopupRefCount.count).toBe(0)

    const localNoteUidRepairMigrationSetting = db.prepare(`
      SELECT value
      FROM app_settings
      WHERE key = ?
    `).get('migration.local-note-uid-repair.v1') as { value: string } | undefined
    expect(localNoteUidRepairMigrationSetting?.value).toBeTruthy()
    const localNoteUidRepairMigrationMeta = localNoteUidRepairMigrationSetting
      ? JSON.parse(localNoteUidRepairMigrationSetting.value) as {
        unresolvedRows: number
        skippedPopupRefRemapRows: number
      }
      : null
    expect(localNoteUidRepairMigrationMeta?.unresolvedRows).toBe(0)
    expect(Number(localNoteUidRepairMigrationMeta?.skippedPopupRefRemapRows || 0)).toBeGreaterThan(0)
  })
})
