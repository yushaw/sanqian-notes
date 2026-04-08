import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import {
  addNotebook,
  closeDatabase,
  createLocalFolderNotebookMount,
  deleteLocalNoteIdentityByPath,
  deleteLocalNoteMetadataByPath,
  ensureLocalNoteIdentity,
  ensureLocalNoteIdentitiesBatch,
  getLocalNoteIdentityByPath,
  getLocalNoteIdentityByUid,
  getLocalNoteIdentityUidsByNotebook,
  getLocalNoteMetadata,
  getLocalNoteSummaryInfo,
  initDatabase,
  listLocalNoteIdentity,
  moveLocalNoteIdentity,
  renameLocalNoteIdentityFolderPath,
  renameLocalNoteIdentityPath,
  listLocalNoteMetadata,
  renameLocalNoteMetadataFolderPath,
  renameLocalNoteMetadataPath,
  updateLocalNoteSummary,
  updateLocalNoteMetadata,
  updateLocalNoteTagsBatch,
} from '../database'
import { getDb } from '../database/connection'

const removeDbFiles = (dir: string) => {
  rmSync(join(dir, 'notes.db'), { force: true })
  rmSync(join(dir, 'notes.db-wal'), { force: true })
  rmSync(join(dir, 'notes.db-shm'), { force: true })
}

const require = createRequire(import.meta.url)
let sqliteAvailable = false

try {
  const BetterSqlite = require('better-sqlite3')
  const probe = new BetterSqlite(':memory:')
  probe.close()
  sqliteAvailable = true
} catch (error) {
  sqliteAvailable = false
  console.warn('[Database Local Metadata Tests] better-sqlite3 unavailable, skipping tests:', error)
}

if (process.env.CI && !sqliteAvailable) {
  throw new Error(
    '[Database Local Metadata Tests] better-sqlite3 unavailable in CI. Run `electron-rebuild` or `npm rebuild better-sqlite3` before tests.'
  )
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

let localMountSeed = 0
function createLocalNotebook(name: string): ReturnType<typeof addNotebook> {
  localMountSeed += 1
  const mountPath = `/tmp/sanqian-db-local-note-metadata-${localMountSeed}`
  return createLocalFolderNotebookMount({
    name,
    root_path: mountPath,
    canonical_root_path: mountPath,
  }).notebook
}

function rebuildLocalNoteMetadataTable(db: ReturnType<typeof getDb>): void {
  db.exec(`
    ALTER TABLE local_note_metadata RENAME TO local_note_metadata_legacy;
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
    INSERT INTO local_note_metadata (
      notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
    )
    SELECT
      notebook_id, relative_path, is_favorite, is_pinned, ai_summary, summary_content_hash, tags_json, ai_tags_json, updated_at
    FROM local_note_metadata_legacy;
    DROP TABLE local_note_metadata_legacy;
    CREATE INDEX IF NOT EXISTS idx_local_note_metadata_notebook_id ON local_note_metadata(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_local_note_metadata_is_favorite ON local_note_metadata(is_favorite);
    CREATE INDEX IF NOT EXISTS idx_local_note_metadata_is_pinned ON local_note_metadata(is_pinned);
    CREATE INDEX IF NOT EXISTS idx_local_note_metadata_updated_at ON local_note_metadata(updated_at);
  `)
}

function rebuildLocalNoteIdentityTable(db: ReturnType<typeof getDb>): void {
  db.exec(`
    ALTER TABLE local_note_identity RENAME TO local_note_identity_legacy;
    CREATE TABLE local_note_identity (
      note_uid TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(notebook_id, relative_path),
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
    );
    INSERT INTO local_note_identity (
      note_uid, notebook_id, relative_path, created_at, updated_at
    )
    SELECT
      note_uid, notebook_id, relative_path, created_at, updated_at
    FROM local_note_identity_legacy;
    DROP TABLE local_note_identity_legacy;
    CREATE INDEX IF NOT EXISTS idx_local_note_identity_notebook_id ON local_note_identity(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_local_note_identity_updated_at ON local_note_identity(updated_at);
  `)
}

describeSqlite('database local_note_metadata', () => {
  const testDbDir = mkdtempSync(join(tmpdir(), 'sanqian-notes-db-local-metadata-'))

  beforeAll(() => {
    vi.spyOn(app, 'getPath').mockReturnValue(testDbDir)
  })

  beforeEach(() => {
    closeDatabase()
    removeDbFiles(testDbDir)
    initDatabase()
    localMountSeed = 0
  })

  afterAll(() => {
    closeDatabase()
    rmSync(testDbDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('creates and compacts local metadata rows', () => {
    const localNotebook = createLocalNotebook('Local')
    const updated = updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
      ai_summary: 'local summary',
      tags: ['project', 'local'],
    })

    expect(updated).not.toBeNull()
    expect(updated?.is_favorite).toBe(true)
    expect(updated?.is_pinned).toBe(false)
    expect(updated?.ai_summary).toBe('local summary')
    expect(updated?.tags).toEqual(['project', 'local'])

    const queried = getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(queried?.is_favorite).toBe(true)
    expect(queried?.tags).toEqual(['project', 'local'])

    const compacted = updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: false,
      is_pinned: false,
      ai_summary: null,
      tags: null,
    })
    expect(compacted).not.toBeNull()
    expect(compacted?.is_favorite).toBe(false)
    expect(compacted?.is_pinned).toBe(false)
    expect(compacted?.ai_summary).toBeNull()

    expect(listLocalNoteMetadata().length).toBe(0)
  })

  it('normalizes dot path aliases when writing and reading metadata', () => {
    const localNotebook = createLocalNotebook('Local')
    const updated = updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: './docs/./a.md',
      is_favorite: true,
      tags: ['project'],
    })

    expect(updated).not.toBeNull()
    expect(updated?.relative_path).toBe('docs/a.md')

    const queried = getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(queried?.relative_path).toBe('docs/a.md')
    expect(queried?.is_favorite).toBe(true)
    expect(listLocalNoteMetadata({ notebookIds: [localNotebook.id] })).toHaveLength(1)
  })

  it('treats notebook_id as opaque value for metadata lookups and updates', () => {
    const localNotebook = createLocalNotebook('Local')
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
    })

    const trimAliasNotebookId = `  ${localNotebook.id}  `
    expect(getLocalNoteMetadata({
      notebook_id: trimAliasNotebookId,
      relative_path: 'docs/a.md',
    })).toBeNull()

    expect(updateLocalNoteMetadata({
      notebook_id: trimAliasNotebookId,
      relative_path: 'docs/a.md',
      is_favorite: false,
    })).toBeNull()

    expect(listLocalNoteMetadata({ notebookIds: [trimAliasNotebookId] })).toHaveLength(0)
    expect(listLocalNoteMetadata({ notebookIds: [trimAliasNotebookId, localNotebook.id] })).toHaveLength(1)
  })

  it('does not broaden to global metadata listing for explicit invalid notebookIds filter', () => {
    const localNotebook = createLocalNotebook('Local')
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
    })
    expect(listLocalNoteMetadata({ notebookIds: ['   ', 123 as any] as any })).toHaveLength(0)
    expect(listLocalNoteMetadata({ notebookIds: 'nb-1' as any } as any)).toHaveLength(0)
  })

  it('keeps global metadata listing behavior when notebookIds is explicitly undefined', () => {
    const localNotebook = createLocalNotebook('Local')
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
    })
    expect(listLocalNoteMetadata({ notebookIds: undefined } as any)).toHaveLength(1)
  })

  it('treats notebook_id as opaque value for local summary info', () => {
    const localNotebook = createLocalNotebook('Local')
    const contentHash = 'a'.repeat(32)
    updateLocalNoteSummary({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      summary: 'local summary',
      content_hash: contentHash,
    })

    expect(getLocalNoteSummaryInfo({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })).toEqual({
      ai_summary: 'local summary',
      summary_content_hash: contentHash,
    })

    expect(getLocalNoteSummaryInfo({
      notebook_id: `  ${localNotebook.id}  `,
      relative_path: 'docs/a.md',
    })).toBeNull()
  })

  it('does not clear existing summary_content_hash when update payload hash is invalid', () => {
    const localNotebook = createLocalNotebook('Local')
    const originalHash = 'b'.repeat(32)
    updateLocalNoteSummary({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      summary: 'baseline summary',
      content_hash: originalHash,
    })

    const updated = updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
      summary_content_hash: 'not-a-valid-hash',
    })

    expect(updated?.is_favorite).toBe(true)
    expect(updated?.summary_content_hash).toBe(originalHash)
    expect(getLocalNoteSummaryInfo({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })?.summary_content_hash).toBe(originalHash)
  })

  it('rejects metadata update for non-local notebook', () => {
    const internalNotebook = addNotebook({ name: 'Internal' })
    const updated = updateLocalNoteMetadata({
      notebook_id: internalNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
    })
    expect(updated).toBeNull()
  })

  it('updates local note tags in one batch transaction and preserves other metadata fields', () => {
    const localNotebook = createLocalNotebook('Local')
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
      ai_summary: 'summary-a',
      tags: ['old-a'],
      ai_tags: ['ai-a'],
    })
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/b.md',
      is_pinned: true,
      tags: ['old-b'],
    })

    const changed = updateLocalNoteTagsBatch({
      notebook_id: localNotebook.id,
      updates: [
        { relative_path: 'docs/a.md', tags: ['new-a', 'shared'] },
        { relative_path: 'docs/b.md', tags: ['new-b'] },
        { relative_path: 'docs/new.md', tags: ['created'] },
        { relative_path: 'docs/a.md', tags: ['new-a', 'shared'] },
      ],
    })
    expect(changed).toBeGreaterThanOrEqual(3)

    const a = getLocalNoteMetadata({ notebook_id: localNotebook.id, relative_path: 'docs/a.md' })
    expect(a?.is_favorite).toBe(true)
    expect(a?.ai_summary).toBe('summary-a')
    expect(a?.ai_tags).toEqual(['ai-a'])
    expect(a?.tags).toEqual(['new-a', 'shared'])

    const b = getLocalNoteMetadata({ notebook_id: localNotebook.id, relative_path: 'docs/b.md' })
    expect(b?.is_pinned).toBe(true)
    expect(b?.tags).toEqual(['new-b'])

    const created = getLocalNoteMetadata({ notebook_id: localNotebook.id, relative_path: 'docs/new.md' })
    expect(created?.tags).toEqual(['created'])
    expect(created?.is_favorite).toBe(false)
    expect(created?.is_pinned).toBe(false)
  })

  it('updateLocalNoteTagsBatch ignores non-local notebooks', () => {
    const internalNotebook = addNotebook({ name: 'Internal' })
    const changed = updateLocalNoteTagsBatch({
      notebook_id: internalNotebook.id,
      updates: [{ relative_path: 'docs/a.md', tags: ['x'] }],
    })
    expect(changed).toBe(0)
    expect(getLocalNoteMetadata({
      notebook_id: internalNotebook.id,
      relative_path: 'docs/a.md',
    })).toBeNull()
  })

  it('renames metadata path for files and folders', () => {
    const localNotebook = createLocalNotebook('Local')
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
    })
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/sub/b.md',
      is_pinned: true,
    })

    const fileRenamed = renameLocalNoteMetadataPath({
      notebook_id: localNotebook.id,
      from_relative_path: 'docs/a.md',
      to_relative_path: 'docs/a-renamed.md',
    })
    expect(fileRenamed).toBe(1)
    expect(getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a-renamed.md',
    })?.is_favorite).toBe(true)

    const folderRenamed = renameLocalNoteMetadataFolderPath({
      notebook_id: localNotebook.id,
      from_relative_folder_path: 'docs',
      to_relative_folder_path: 'archive',
    })
    expect(folderRenamed).toBeGreaterThanOrEqual(1)
    expect(getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'archive/sub/b.md',
    })?.is_pinned).toBe(true)
  })

  it('keeps metadata path operations stable after local_note_metadata table rebuild', () => {
    const localNotebook = createLocalNotebook('Local')
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
    })

    const firstRename = renameLocalNoteMetadataPath({
      notebook_id: localNotebook.id,
      from_relative_path: 'docs/a.md',
      to_relative_path: 'docs/b.md',
    })
    expect(firstRename).toBe(1)

    const db = getDb()
    rebuildLocalNoteMetadataTable(db)

    expect(() => {
      renameLocalNoteMetadataPath({
        notebook_id: localNotebook.id,
        from_relative_path: 'docs/b.md',
        to_relative_path: 'docs/c.md',
      })
    }).not.toThrow()
    expect(getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/c.md',
    })?.is_favorite).toBe(true)
  })

  it('guards against renaming a folder into its own descendant path', () => {
    const localNotebook = createLocalNotebook('Local')
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
    })
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/sub/b.md',
      is_pinned: true,
    })
    ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/sub/b.md',
    })

    const metadataChanged = renameLocalNoteMetadataFolderPath({
      notebook_id: localNotebook.id,
      from_relative_folder_path: 'docs',
      to_relative_folder_path: 'docs/sub',
    })
    const identityChanged = renameLocalNoteIdentityFolderPath({
      notebook_id: localNotebook.id,
      from_relative_folder_path: 'docs',
      to_relative_folder_path: 'docs/sub',
    })
    expect(metadataChanged).toBe(0)
    expect(identityChanged).toBe(0)

    expect(getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })?.is_favorite).toBe(true)
    expect(getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/sub/b.md',
    })?.is_pinned).toBe(true)
    expect(getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })).not.toBeNull()
    expect(getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/sub/b.md',
    })).not.toBeNull()
  })

  it('merges metadata when rename target already exists', () => {
    const localNotebook = createLocalNotebook('Local')
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/source.md',
      is_favorite: true,
      ai_summary: 'from source',
      tags: ['source', 'shared'],
    })
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/target.md',
      is_pinned: true,
      ai_summary: 'from target',
      tags: ['target', 'shared'],
    })

    const changed = renameLocalNoteMetadataPath({
      notebook_id: localNotebook.id,
      from_relative_path: 'docs/source.md',
      to_relative_path: 'docs/target.md',
    })
    expect(changed).toBe(1)

    const merged = getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/target.md',
    })
    expect(merged?.is_favorite).toBe(true)
    expect(merged?.is_pinned).toBe(true)
    // Keep target summary priority when both exist.
    expect(merged?.ai_summary).toBe('from target')
    expect(merged?.tags).toEqual(['target', 'shared', 'source'])
  })

  it('deletes metadata rows by file or folder path', () => {
    const localNotebook = createLocalNotebook('Local')
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
    })
    updateLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/sub/b.md',
      is_pinned: true,
    })

    const fileDeleted = deleteLocalNoteMetadataByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      kind: 'file',
    })
    expect(fileDeleted).toBe(1)
    expect(getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })).toBeNull()

    const folderDeleted = deleteLocalNoteMetadataByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs',
      kind: 'folder',
    })
    expect(folderDeleted).toBe(1)
    expect(getLocalNoteMetadata({
      notebook_id: localNotebook.id,
      relative_path: 'docs/sub/b.md',
    })).toBeNull()
  })

  it('ensures stable local identity and keeps uid across rename', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created).not.toBeNull()
    expect(created?.note_uid).toBeTruthy()

    const ensuredAgain = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(ensuredAgain?.note_uid).toBe(created?.note_uid)

    const renamedFile = renameLocalNoteIdentityPath({
      notebook_id: localNotebook.id,
      from_relative_path: 'docs/a.md',
      to_relative_path: 'docs/a-renamed.md',
    })
    expect(renamedFile).toBe(1)

    const byUidAfterFileRename = getLocalNoteIdentityByUid({
      note_uid: created?.note_uid || '',
      notebook_id: localNotebook.id,
    })
    expect(byUidAfterFileRename?.relative_path).toBe('docs/a-renamed.md')
    expect(getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })).toBeNull()

    const renamedFolder = renameLocalNoteIdentityFolderPath({
      notebook_id: localNotebook.id,
      from_relative_folder_path: 'docs',
      to_relative_folder_path: 'archive',
    })
    expect(renamedFolder).toBe(1)

    const byUidAfterFolderRename = getLocalNoteIdentityByUid({
      note_uid: created?.note_uid || '',
      notebook_id: localNotebook.id,
    })
    expect(byUidAfterFolderRename?.relative_path).toBe('archive/a-renamed.md')
  })

  it('keeps identity path operations stable after local_note_identity table rebuild', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()

    const firstRename = renameLocalNoteIdentityPath({
      notebook_id: localNotebook.id,
      from_relative_path: 'docs/a.md',
      to_relative_path: 'docs/b.md',
    })
    expect(firstRename).toBe(1)

    const db = getDb()
    rebuildLocalNoteIdentityTable(db)

    const moved = moveLocalNoteIdentity({
      from_notebook_id: localNotebook.id,
      from_relative_path: 'docs/b.md',
      to_notebook_id: localNotebook.id,
      to_relative_path: 'docs/c.md',
    })
    expect(moved).toBe(1)
    expect(getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/c.md',
    })?.note_uid).toBe(created?.note_uid)
  })

  it('repairs non-canonical uid aliases during path rename and remaps popup refs', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    const db = getDb()
    const uppercaseUuid = created.note_uid.toUpperCase()
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(uppercaseUuid, new Date().toISOString(), created.note_uid)

    const oldTs = '2020-01-01T00:00:00.000Z'
    db.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', '', '', '', '', ?, ?)
    `).run('popup-rename-repair', oldTs, oldTs)
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run('popup-rename-repair', uppercaseUuid, oldTs, oldTs)

    const renamed = renameLocalNoteIdentityPath({
      notebook_id: localNotebook.id,
      from_relative_path: 'docs/a.md',
      to_relative_path: 'docs/b.md',
    })
    expect(renamed).toBe(1)

    const renamedIdentity = getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/b.md',
    })
    expect(renamedIdentity?.note_uid).toBe(created.note_uid)

    const popupRef = db.prepare(`
      SELECT note_id, updated_at
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-rename-repair') as { note_id: string; updated_at: string } | undefined
    expect(popupRef?.note_id).toBe(created.note_uid)
    expect(popupRef?.updated_at).not.toBe(oldTs)
    const stalePopupRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE popup_id = ? AND note_id = ?
    `).get('popup-rename-repair', uppercaseUuid) as { count: number }
    expect(stalePopupRefCount.count).toBe(0)
  })

  it('normalizes source uid instead of regenerating when rename target holds canonical case alias', () => {
    const localNotebook = createLocalNotebook('Local')
    const source = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/source.md',
    })
    const target = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/target.md',
    })
    expect(source?.note_uid).toBeTruthy()
    expect(target?.note_uid).toBeTruthy()
    if (!source?.note_uid || !target?.note_uid) return

    const db = getDb()
    const canonicalUuid = '12345678-1234-4abc-8abc-1234567890ab'
    const uppercaseAlias = canonicalUuid.toUpperCase()
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(canonicalUuid, '2026-01-01T00:00:00.000Z', target.note_uid)
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(uppercaseAlias, '2026-01-02T00:00:00.000Z', source.note_uid)

    const oldTs = '2020-01-01T00:00:00.000Z'
    db.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', '', '', '', '', ?, ?)
    `).run('popup-rename-collision-normalize', oldTs, oldTs)
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run('popup-rename-collision-normalize', uppercaseAlias, oldTs, oldTs)

    const renamed = renameLocalNoteIdentityPath({
      notebook_id: localNotebook.id,
      from_relative_path: 'docs/source.md',
      to_relative_path: 'docs/target.md',
    })
    expect(renamed).toBe(1)

    const row = getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/target.md',
    })
    expect(row?.note_uid).toBe(canonicalUuid)
    expect(getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/source.md',
    })).toBeNull()

    const popupRef = db.prepare(`
      SELECT note_id, updated_at
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-rename-collision-normalize') as { note_id: string; updated_at: string } | undefined
    expect(popupRef?.note_id).toBe(canonicalUuid)
    expect(popupRef?.updated_at).not.toBe(oldTs)
  })

  it('normalizes dot path aliases when ensuring local identities', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: './docs/./a.md',
    })
    expect(created).not.toBeNull()
    expect(created?.relative_path).toBe('docs/a.md')

    const ensuredAgain = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(ensuredAgain?.note_uid).toBe(created?.note_uid)

    const queried = getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(queried?.note_uid).toBe(created?.note_uid)
    expect(listLocalNoteIdentity({ notebookIds: [localNotebook.id] })).toHaveLength(1)
  })

  it('treats notebook_id as opaque value for local identity APIs', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created).not.toBeNull()

    const trimAliasNotebookId = `  ${localNotebook.id}  `
    expect(ensureLocalNoteIdentity({
      notebook_id: trimAliasNotebookId,
      relative_path: 'docs/a.md',
    })).toBeNull()

    expect(getLocalNoteIdentityByPath({
      notebook_id: trimAliasNotebookId,
      relative_path: 'docs/a.md',
    })).toBeNull()

    expect(listLocalNoteIdentity({ notebookIds: [trimAliasNotebookId] })).toHaveLength(0)
    expect(listLocalNoteIdentity({ notebookIds: [trimAliasNotebookId, localNotebook.id] })).toHaveLength(1)
  })

  it('does not broaden to global identity listing for explicit invalid notebookIds filter', () => {
    const localNotebook = createLocalNotebook('Local')
    ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(listLocalNoteIdentity({ notebookIds: ['   ', 123 as any] as any })).toHaveLength(0)
    expect(listLocalNoteIdentity({ notebookIds: 'nb-1' as any } as any)).toHaveLength(0)
  })

  it('keeps global identity listing behavior when notebookIds is explicitly undefined', () => {
    const localNotebook = createLocalNotebook('Local')
    ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(listLocalNoteIdentity({ notebookIds: undefined } as any)).toHaveLength(1)
  })

  it('treats note_uid as opaque value and rejects trim aliases while accepting UUID case alias', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()

    const trimAliasUid = ` ${created?.note_uid || ''} `
    expect(getLocalNoteIdentityByUid({
      note_uid: trimAliasUid,
      notebook_id: localNotebook.id,
    })).toBeNull()

    expect(getLocalNoteIdentityByUid({
      note_uid: (created?.note_uid || '').toUpperCase(),
      notebook_id: localNotebook.id,
    })?.relative_path).toBe('docs/a.md')
  })

  it('does not ignore explicit invalid notebook_id filter when resolving uid identity', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    expect(getLocalNoteIdentityByUid({
      note_uid: created.note_uid,
      notebook_id: '   ' as any,
    })).toBeNull()
    expect(getLocalNoteIdentityByUid({
      note_uid: created.note_uid,
      notebook_id: 123 as any,
    })).toBeNull()
  })

  it('treats explicit undefined notebook_id filter as omitted when resolving uid identity', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    expect(getLocalNoteIdentityByUid({
      note_uid: created.note_uid,
      notebook_id: undefined,
    } as any)?.relative_path).toBe('docs/a.md')
  })

  it('accepts UUID case aliases persisted in DB while preserving opaque uid case-sensitivity', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    const db = getDb()
    const uppercaseUuid = created.note_uid.toUpperCase()
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(uppercaseUuid, new Date().toISOString(), created.note_uid)

    expect(getLocalNoteIdentityByUid({
      note_uid: created.note_uid,
      notebook_id: localNotebook.id,
    })?.relative_path).toBe('docs/a.md')

    const second = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/b.md',
    })
    expect(second?.note_uid).toBeTruthy()
    if (!second?.note_uid) return

    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run('UID:Foo', new Date().toISOString(), second.note_uid)

    expect(getLocalNoteIdentityByUid({
      note_uid: 'UID:Foo',
      notebook_id: localNotebook.id,
    })?.relative_path).toBe('docs/b.md')
    expect(getLocalNoteIdentityByUid({
      note_uid: 'uid:foo',
      notebook_id: localNotebook.id,
    })).toBeNull()
  })

  it('resolves UUID case aliases within notebook scope and treats cross-notebook case collisions as ambiguous', () => {
    const notebookA = createLocalNotebook('Local A')
    const notebookB = createLocalNotebook('Local B')
    const rowA = ensureLocalNoteIdentity({
      notebook_id: notebookA.id,
      relative_path: 'docs/a.md',
    })
    const rowB = ensureLocalNoteIdentity({
      notebook_id: notebookB.id,
      relative_path: 'docs/b.md',
    })
    expect(rowA?.note_uid).toBeTruthy()
    expect(rowB?.note_uid).toBeTruthy()
    if (!rowA?.note_uid || !rowB?.note_uid) return

    const db = getDb()
    const canonicalUuid = 'abcdefab-cdef-4def-8def-abcdefabcdef'
    const aliasA = canonicalUuid.toUpperCase()
    const aliasB = 'Abcdefab-cdef-4def-8def-abcdefabcdef'
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(aliasA, '2026-01-01T00:00:00.000Z', rowA.note_uid)
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(aliasB, '2026-01-02T00:00:00.000Z', rowB.note_uid)

    const byNotebookA = getLocalNoteIdentityByUid({
      note_uid: canonicalUuid,
      notebook_id: notebookA.id,
    })
    const byNotebookB = getLocalNoteIdentityByUid({
      note_uid: canonicalUuid,
      notebook_id: notebookB.id,
    })
    expect(byNotebookA?.relative_path).toBe('docs/a.md')
    expect(byNotebookB?.relative_path).toBe('docs/b.md')

    // Without notebook scope the UUID alias is ambiguous across notebooks.
    expect(getLocalNoteIdentityByUid({
      note_uid: canonicalUuid,
    })).toBeNull()
  })

  it('uses notebook-scoped resolution when exact uid exists in a different notebook', () => {
    const notebookA = createLocalNotebook('Local A')
    const notebookB = createLocalNotebook('Local B')
    const rowA = ensureLocalNoteIdentity({
      notebook_id: notebookA.id,
      relative_path: 'docs/a.md',
    })
    const rowB = ensureLocalNoteIdentity({
      notebook_id: notebookB.id,
      relative_path: 'docs/b.md',
    })
    expect(rowA?.note_uid).toBeTruthy()
    expect(rowB?.note_uid).toBeTruthy()
    if (!rowA?.note_uid || !rowB?.note_uid) return

    const db = getDb()
    const canonicalUuid = '12345678-1234-4abc-8abc-1234567890ab'
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(canonicalUuid.toUpperCase(), '2026-01-03T00:00:00.000Z', rowA.note_uid)
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(canonicalUuid, '2026-01-04T00:00:00.000Z', rowB.note_uid)

    const scopedA = getLocalNoteIdentityByUid({
      note_uid: canonicalUuid,
      notebook_id: notebookA.id,
    })
    const scopedB = getLocalNoteIdentityByUid({
      note_uid: canonicalUuid,
      notebook_id: notebookB.id,
    })
    expect(scopedA?.relative_path).toBe('docs/a.md')
    expect(scopedB?.relative_path).toBe('docs/b.md')
  })

  it('keeps persisted UUID case aliases unchanged for default read-only lookups', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    const db = getDb()
    const uppercaseUuid = created.note_uid.toUpperCase()
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(uppercaseUuid, new Date().toISOString(), created.note_uid)

    const lookedUpByUid = getLocalNoteIdentityByUid({
      note_uid: created.note_uid,
      notebook_id: localNotebook.id,
    })
    expect(lookedUpByUid?.note_uid).toBe(uppercaseUuid)

    const lookedUpByPath = getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(lookedUpByPath?.note_uid).toBe(uppercaseUuid)

    const listed = listLocalNoteIdentity({ notebookIds: [localNotebook.id] })
    expect(listed[0]?.note_uid).toBe(uppercaseUuid)
  })

  it('repairs UUID case aliases during uid lookup and remaps popup refs', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    const db = getDb()
    const uppercaseUuid = created.note_uid.toUpperCase()
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(uppercaseUuid, new Date().toISOString(), created.note_uid)

    const oldTs = '2020-01-01T00:00:00.000Z'
    db.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', '', '', '', '', ?, ?)
    `).run('popup-uid-lookup-repair', oldTs, oldTs)
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run('popup-uid-lookup-repair', uppercaseUuid, oldTs, oldTs)

    const lookedUp = getLocalNoteIdentityByUid({
      note_uid: created.note_uid,
      notebook_id: localNotebook.id,
    }, { repairIfNeeded: true })
    expect(lookedUp?.note_uid).toBe(created.note_uid)

    const persistedRow = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get(localNotebook.id, 'docs/a.md') as { note_uid: string } | undefined
    expect(persistedRow?.note_uid).toBe(created.note_uid)

    const popupRef = db.prepare(`
      SELECT note_id, updated_at
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-uid-lookup-repair') as { note_id: string; updated_at: string } | undefined
    expect(popupRef?.note_id).toBe(created.note_uid)
    expect(popupRef?.updated_at).not.toBe(oldTs)
    const stalePopupRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE popup_id = ? AND note_id = ?
    `).get('popup-uid-lookup-repair', uppercaseUuid) as { count: number }
    expect(stalePopupRefCount.count).toBe(0)
  })

  it('repairs non-canonical UUID aliases during ensureLocalNoteIdentity and remaps popup refs', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    const db = getDb()
    const uppercaseUuid = created.note_uid.toUpperCase()
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(uppercaseUuid, new Date().toISOString(), created.note_uid)

    const now = new Date().toISOString()
    db.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', '', '', '', '', ?, ?)
    `).run('popup-repair', now, now)
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run('popup-repair', uppercaseUuid, now, now)

    const repaired = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(repaired?.note_uid).toBe(created.note_uid)

    const popupRef = db.prepare(`
      SELECT note_id
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-repair') as { note_id: string } | undefined
    expect(popupRef?.note_id).toBe(created.note_uid)
    const stalePopupRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE popup_id = ? AND note_id = ?
    `).get('popup-repair', uppercaseUuid) as { count: number }
    expect(stalePopupRefCount.count).toBe(0)
  })

  it('repairs uid when ensureLocalNoteIdentity hits ON CONFLICT path race branch', () => {
    const localNotebook = createLocalNotebook('Local')
    const db = getDb()
    const raceAliasUid = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D'
    db.exec(`
      CREATE TRIGGER trg_test_local_note_identity_upsert_race_alias
      BEFORE INSERT ON local_note_identity
      FOR EACH ROW
      WHEN NEW.notebook_id = '${localNotebook.id}'
        AND NEW.relative_path = 'docs/race.md'
        AND NEW.note_uid <> '${raceAliasUid}'
      BEGIN
        INSERT OR IGNORE INTO local_note_identity (
          note_uid,
          notebook_id,
          relative_path,
          created_at,
          updated_at
        )
        VALUES (
          '${raceAliasUid}',
          NEW.notebook_id,
          NEW.relative_path,
          NEW.created_at,
          NEW.updated_at
        );
      END;
    `)

    const ensured = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/race.md',
    })
    expect(ensured?.note_uid).toBe(raceAliasUid.toLowerCase())

    const persisted = getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/race.md',
    })
    expect(persisted?.note_uid).toBe(raceAliasUid.toLowerCase())
  })

  it('repairs persisted trim-alias UUID values to canonical uid and remaps popup refs', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    const db = getDb()
    const trimAliasUuid = ` ${created.note_uid.toUpperCase()} `
    db.exec('DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_validate_update')
    db.exec('DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_conflict_validate_update')
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(trimAliasUuid, new Date().toISOString(), created.note_uid)

    const oldTs = '2020-01-01T00:00:00.000Z'
    db.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', '', '', '', '', ?, ?)
    `).run('popup-trim-alias-repair', oldTs, oldTs)
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run('popup-trim-alias-repair', trimAliasUuid, oldTs, oldTs)

    const repaired = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(repaired?.note_uid).toBe(created.note_uid)

    const persistedRow = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get(localNotebook.id, 'docs/a.md') as { note_uid: string } | undefined
    expect(persistedRow?.note_uid).toBe(created.note_uid)

    const popupRef = db.prepare(`
      SELECT note_id, updated_at
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-trim-alias-repair') as { note_id: string; updated_at: string } | undefined
    expect(popupRef?.note_id).toBe(created.note_uid)
    expect(popupRef?.updated_at).not.toBe(oldTs)
    const stalePopupRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE popup_id = ? AND note_id = ?
    `).get('popup-trim-alias-repair', trimAliasUuid) as { count: number }
    expect(stalePopupRefCount.count).toBe(0)
  })

  it('repairs non-canonical UUID aliases during ensureLocalNoteIdentitiesBatch', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    const db = getDb()
    const uppercaseUuid = created.note_uid.toUpperCase()
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(uppercaseUuid, new Date().toISOString(), created.note_uid)

    const ensured = ensureLocalNoteIdentitiesBatch({
      notebook_id: localNotebook.id,
      relative_paths: ['docs/a.md'],
    })
    expect(ensured.get('docs/a.md')?.note_uid).toBe(created.note_uid)
  })

  it('repairs non-canonical UUID aliases during path lookup and uid listing', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    const db = getDb()
    const uppercaseUuid = created.note_uid.toUpperCase()
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(uppercaseUuid, new Date().toISOString(), created.note_uid)

    const lookedUpByPath = getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    }, { repairIfNeeded: true })
    expect(lookedUpByPath?.note_uid).toBe(created.note_uid)

    const listedUids = getLocalNoteIdentityUidsByNotebook(localNotebook.id, { repairIfNeeded: true })
    expect(listedUids.has(created.note_uid)).toBe(true)
    expect(listedUids.has(uppercaseUuid)).toBe(false)
  })

  it('repairs only the requested row when legacy duplicate uid aliases exist', () => {
    const localNotebook = createLocalNotebook('Local')
    const createdA = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    const createdB = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/b.md',
    })
    expect(createdA?.note_uid).toBeTruthy()
    expect(createdB?.note_uid).toBeTruthy()
    if (!createdA?.note_uid || !createdB?.note_uid) return

    const db = getDb()
    db.exec(`
      DROP TRIGGER IF EXISTS trg_ai_popup_refs_source_type_validate_insert;
      DROP TRIGGER IF EXISTS trg_ai_popup_refs_source_type_validate_update;
      DROP TRIGGER IF EXISTS trg_ai_popup_refs_popup_reference_validate_insert;
      DROP TRIGGER IF EXISTS trg_ai_popup_refs_popup_reference_validate_update;
      DROP TRIGGER IF EXISTS trg_ai_popup_refs_note_reference_validate_insert;
      DROP TRIGGER IF EXISTS trg_ai_popup_refs_note_reference_validate_update;
      DROP TRIGGER IF EXISTS trg_ai_popup_refs_cleanup_internal_note_delete;
      DROP TRIGGER IF EXISTS trg_ai_popup_refs_cleanup_local_identity_delete;
      DROP TRIGGER IF EXISTS trg_ai_popup_refs_cleanup_popup_delete;
      DROP TABLE IF EXISTS ai_popup_refs;
    `)
    db.exec(`
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_validate_insert;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_validate_update;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_conflict_validate_insert;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_conflict_validate_update;
      DROP TRIGGER IF EXISTS trg_notes_id_conflict_with_local_identity_validate_insert;
      DROP TRIGGER IF EXISTS trg_notes_id_conflict_with_local_identity_validate_update;
      ALTER TABLE local_note_identity RENAME TO local_note_identity_legacy_dup_alias;
      CREATE TABLE local_note_identity (
        note_uid TEXT NOT NULL,
        notebook_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(notebook_id, relative_path),
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      INSERT INTO local_note_identity (
        note_uid, notebook_id, relative_path, created_at, updated_at
      )
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity_legacy_dup_alias;
      DROP TABLE local_note_identity_legacy_dup_alias;
      CREATE INDEX IF NOT EXISTS idx_local_note_identity_notebook_id ON local_note_identity(notebook_id);
      CREATE INDEX IF NOT EXISTS idx_local_note_identity_updated_at ON local_note_identity(updated_at);
    `)

    const duplicatedAliasUid = createdA.note_uid.toUpperCase()
    const updatedAt = '2026-02-01T00:00:00.000Z'
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE notebook_id = ? AND relative_path = ?
    `).run(duplicatedAliasUid, updatedAt, localNotebook.id, 'docs/a.md')
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE notebook_id = ? AND relative_path = ?
    `).run(duplicatedAliasUid, updatedAt, localNotebook.id, 'docs/b.md')

    const repairedA = getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    }, { repairIfNeeded: true })
    expect(repairedA?.note_uid).toBe(createdA.note_uid)

    const persistedA = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get(localNotebook.id, 'docs/a.md') as { note_uid: string } | undefined
    const persistedB = db.prepare(`
      SELECT note_uid
      FROM local_note_identity
      WHERE notebook_id = ? AND relative_path = ?
    `).get(localNotebook.id, 'docs/b.md') as { note_uid: string } | undefined
    expect(persistedA?.note_uid).toBe(createdA.note_uid)
    expect(persistedB?.note_uid).toBe(duplicatedAliasUid)
  })

  it('renames only source row when legacy duplicate canonical uid rows exist', () => {
    const localNotebook = createLocalNotebook('Local')
    const createdA = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    const createdB = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/b.md',
    })
    expect(createdA?.note_uid).toBeTruthy()
    expect(createdB?.note_uid).toBeTruthy()
    if (!createdA?.note_uid || !createdB?.note_uid) return

    const db = getDb()
    db.exec(`
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_validate_insert;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_validate_update;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_conflict_validate_insert;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_conflict_validate_update;
      DROP TRIGGER IF EXISTS trg_notes_id_conflict_with_local_identity_validate_insert;
      DROP TRIGGER IF EXISTS trg_notes_id_conflict_with_local_identity_validate_update;
      ALTER TABLE local_note_identity RENAME TO local_note_identity_legacy_dup_canonical;
      CREATE TABLE local_note_identity (
        note_uid TEXT NOT NULL,
        notebook_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(notebook_id, relative_path),
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      INSERT INTO local_note_identity (
        note_uid, notebook_id, relative_path, created_at, updated_at
      )
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity_legacy_dup_canonical;
      DROP TABLE local_note_identity_legacy_dup_canonical;
      CREATE INDEX IF NOT EXISTS idx_local_note_identity_notebook_id ON local_note_identity(notebook_id);
      CREATE INDEX IF NOT EXISTS idx_local_note_identity_updated_at ON local_note_identity(updated_at);
    `)

    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE notebook_id = ? AND relative_path = ?
    `).run(createdA.note_uid, '2026-02-02T00:00:00.000Z', localNotebook.id, 'docs/b.md')

    const renamed = renameLocalNoteIdentityPath({
      notebook_id: localNotebook.id,
      from_relative_path: 'docs/a.md',
      to_relative_path: 'docs/a-renamed.md',
    })
    expect(renamed).toBe(1)

    expect(getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })).toBeNull()
    expect(getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a-renamed.md',
    })?.note_uid).toBe(createdA.note_uid)
    expect(getLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/b.md',
    })?.note_uid).toBe(createdA.note_uid)
  })

  it('renames onto existing target path when dirty duplicate rows share same uid', () => {
    const localNotebook = createLocalNotebook('Local')
    const createdA = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    const createdB = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/b.md',
    })
    expect(createdA?.note_uid).toBeTruthy()
    expect(createdB?.note_uid).toBeTruthy()
    if (!createdA?.note_uid || !createdB?.note_uid) return

    const db = getDb()
    db.exec(`
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_validate_insert;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_validate_update;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_conflict_validate_insert;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_conflict_validate_update;
      DROP TRIGGER IF EXISTS trg_notes_id_conflict_with_local_identity_validate_insert;
      DROP TRIGGER IF EXISTS trg_notes_id_conflict_with_local_identity_validate_update;
      ALTER TABLE local_note_identity RENAME TO local_note_identity_legacy_dup_rename_conflict;
      CREATE TABLE local_note_identity (
        note_uid TEXT NOT NULL,
        notebook_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(notebook_id, relative_path),
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      INSERT INTO local_note_identity (
        note_uid, notebook_id, relative_path, created_at, updated_at
      )
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity_legacy_dup_rename_conflict;
      DROP TABLE local_note_identity_legacy_dup_rename_conflict;
      CREATE INDEX IF NOT EXISTS idx_local_note_identity_notebook_id ON local_note_identity(notebook_id);
      CREATE INDEX IF NOT EXISTS idx_local_note_identity_updated_at ON local_note_identity(updated_at);
    `)
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE notebook_id = ? AND relative_path = ?
    `).run(createdA.note_uid, '2026-02-03T00:00:00.000Z', localNotebook.id, 'docs/b.md')

    const renamed = renameLocalNoteIdentityPath({
      notebook_id: localNotebook.id,
      from_relative_path: 'docs/a.md',
      to_relative_path: 'docs/b.md',
    })
    expect(renamed).toBe(1)

    const remainingRows = db.prepare(`
      SELECT note_uid, relative_path
      FROM local_note_identity
      WHERE notebook_id = ?
      ORDER BY relative_path ASC
    `).all(localNotebook.id) as Array<{ note_uid: string; relative_path: string }>
    expect(remainingRows).toEqual([
      { note_uid: createdA.note_uid, relative_path: 'docs/b.md' },
    ])
  })

  it('moves across notebooks when dirty duplicate rows share same uid at target path', () => {
    const fromNotebook = createLocalNotebook('From')
    const toNotebook = createLocalNotebook('To')
    const source = ensureLocalNoteIdentity({
      notebook_id: fromNotebook.id,
      relative_path: 'docs/a.md',
    })
    const target = ensureLocalNoteIdentity({
      notebook_id: toNotebook.id,
      relative_path: 'archive/a.md',
    })
    expect(source?.note_uid).toBeTruthy()
    expect(target?.note_uid).toBeTruthy()
    if (!source?.note_uid || !target?.note_uid) return

    const db = getDb()
    db.exec(`
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_validate_insert;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_validate_update;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_conflict_validate_insert;
      DROP TRIGGER IF EXISTS trg_local_note_identity_note_uid_conflict_validate_update;
      DROP TRIGGER IF EXISTS trg_notes_id_conflict_with_local_identity_validate_insert;
      DROP TRIGGER IF EXISTS trg_notes_id_conflict_with_local_identity_validate_update;
      ALTER TABLE local_note_identity RENAME TO local_note_identity_legacy_dup_move_conflict;
      CREATE TABLE local_note_identity (
        note_uid TEXT NOT NULL,
        notebook_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(notebook_id, relative_path),
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
      );
      INSERT INTO local_note_identity (
        note_uid, notebook_id, relative_path, created_at, updated_at
      )
      SELECT note_uid, notebook_id, relative_path, created_at, updated_at
      FROM local_note_identity_legacy_dup_move_conflict;
      DROP TABLE local_note_identity_legacy_dup_move_conflict;
      CREATE INDEX IF NOT EXISTS idx_local_note_identity_notebook_id ON local_note_identity(notebook_id);
      CREATE INDEX IF NOT EXISTS idx_local_note_identity_updated_at ON local_note_identity(updated_at);
    `)
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE notebook_id = ? AND relative_path = ?
    `).run(source.note_uid, '2026-02-04T00:00:00.000Z', toNotebook.id, 'archive/a.md')

    const moved = moveLocalNoteIdentity({
      from_notebook_id: fromNotebook.id,
      from_relative_path: 'docs/a.md',
      to_notebook_id: toNotebook.id,
      to_relative_path: 'archive/a.md',
    })
    expect(moved).toBe(1)

    expect(getLocalNoteIdentityByPath({
      notebook_id: fromNotebook.id,
      relative_path: 'docs/a.md',
    })).toBeNull()
    expect(getLocalNoteIdentityByPath({
      notebook_id: toNotebook.id,
      relative_path: 'archive/a.md',
    })?.note_uid).toBe(source.note_uid)

    const duplicateUidCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM local_note_identity
      WHERE note_uid = ?
    `).get(source.note_uid) as { count: number }
    expect(duplicateUidCount.count).toBe(1)
  })

  it('repairs non-canonical UUID aliases when listing identities', () => {
    const localNotebook = createLocalNotebook('Local')
    const created = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    const db = getDb()
    const uppercaseUuid = created.note_uid.toUpperCase()
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(uppercaseUuid, new Date().toISOString(), created.note_uid)

    const listed = listLocalNoteIdentity({ notebookIds: [localNotebook.id] }, { repairIfNeeded: true })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.note_uid).toBe(created.note_uid)
  })

  it('ensures local identities in batch with stable uids', () => {
    const localNotebook = createLocalNotebook('Local')
    const seeded = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(seeded).not.toBeNull()

    const ensured = ensureLocalNoteIdentitiesBatch({
      notebook_id: localNotebook.id,
      relative_paths: ['docs/a.md', 'docs/b.md', 'docs/a.md', 'docs/sub/c.md'],
    })

    expect(ensured.size).toBe(3)
    expect(ensured.get('docs/a.md')?.note_uid).toBe(seeded?.note_uid)
    expect(ensured.get('docs/b.md')?.note_uid).toBeTruthy()
    expect(ensured.get('docs/sub/c.md')?.note_uid).toBeTruthy()

    const allRows = listLocalNoteIdentity({ notebookIds: [localNotebook.id] })
    expect(allRows.length).toBe(3)
  })

  it('fails fast when ensureLocalNoteIdentity cannot generate a valid uid', () => {
    const localNotebook = createLocalNotebook('Local')
    const db = getDb()
    db.exec(`
      CREATE TRIGGER trg_test_force_local_note_uid_failure
      BEFORE INSERT ON local_note_identity
      BEGIN
        SELECT RAISE(ABORT, 'invalid local_note_identity.note_uid');
      END;
    `)

    expect(() => ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })).toThrow('Failed to generate unique local note uid')
  })

  it('fails fast when ensureLocalNoteIdentitiesBatch cannot generate a valid uid', () => {
    const localNotebook = createLocalNotebook('Local')
    const db = getDb()
    db.exec(`
      CREATE TRIGGER trg_test_force_local_note_uid_batch_failure
      BEFORE INSERT ON local_note_identity
      BEGIN
        SELECT RAISE(ABORT, 'invalid local_note_identity.note_uid');
      END;
    `)

    expect(() => ensureLocalNoteIdentitiesBatch({
      notebook_id: localNotebook.id,
      relative_paths: ['docs/a.md', 'docs/b.md'],
    })).toThrow('Failed to generate unique local note uid')
    expect(listLocalNoteIdentity({ notebookIds: [localNotebook.id] })).toHaveLength(0)
  })

  it('deletes identity rows by file or folder path', () => {
    const localNotebook = createLocalNotebook('Local')
    const a = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
    })
    const b = ensureLocalNoteIdentity({
      notebook_id: localNotebook.id,
      relative_path: 'docs/sub/b.md',
    })
    expect(listLocalNoteIdentity({ notebookIds: [localNotebook.id] }).length).toBe(2)

    const fileDeleted = deleteLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs/a.md',
      kind: 'file',
    })
    expect(fileDeleted).toBe(1)
    expect(getLocalNoteIdentityByUid({ note_uid: a?.note_uid || '' })).toBeNull()

    const folderDeleted = deleteLocalNoteIdentityByPath({
      notebook_id: localNotebook.id,
      relative_path: 'docs',
      kind: 'folder',
    })
    expect(folderDeleted).toBe(1)
    expect(getLocalNoteIdentityByUid({ note_uid: b?.note_uid || '' })).toBeNull()
  })

  it('does not create identity for internal notebooks', () => {
    const internalNotebook = addNotebook({ name: 'Internal' })
    const identity = ensureLocalNoteIdentity({
      notebook_id: internalNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(identity).toBeNull()

    const ensuredBatch = ensureLocalNoteIdentitiesBatch({
      notebook_id: internalNotebook.id,
      relative_paths: ['docs/a.md', 'docs/b.md'],
    })
    expect(ensuredBatch.size).toBe(0)
  })

  it('preserves uid when moving identity across local notebooks', () => {
    const fromNotebook = createLocalNotebook('Local A')
    const toNotebook = createLocalNotebook('Local B')

    const created = ensureLocalNoteIdentity({
      notebook_id: fromNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created).not.toBeNull()

    const moved = moveLocalNoteIdentity({
      from_notebook_id: fromNotebook.id,
      from_relative_path: 'docs/a.md',
      to_notebook_id: toNotebook.id,
      to_relative_path: 'archive/a.md',
    })
    expect(moved).toBe(1)

    expect(getLocalNoteIdentityByPath({
      notebook_id: fromNotebook.id,
      relative_path: 'docs/a.md',
    })).toBeNull()

    const target = getLocalNoteIdentityByPath({
      notebook_id: toNotebook.id,
      relative_path: 'archive/a.md',
    })
    expect(target?.note_uid).toBe(created?.note_uid)
  })

  it('repairs non-canonical uid aliases during cross-notebook move and remaps popup refs', () => {
    const fromNotebook = createLocalNotebook('Local A')
    const toNotebook = createLocalNotebook('Local B')
    const created = ensureLocalNoteIdentity({
      notebook_id: fromNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(created?.note_uid).toBeTruthy()
    if (!created?.note_uid) return

    const db = getDb()
    const uppercaseUuid = created.note_uid.toUpperCase()
    db.prepare(`
      UPDATE local_note_identity
      SET note_uid = ?, updated_at = ?
      WHERE note_uid = ?
    `).run(uppercaseUuid, new Date().toISOString(), created.note_uid)

    const oldTs = '2020-01-01T00:00:00.000Z'
    db.prepare(`
      INSERT INTO ai_popups (id, content, prompt, action_name, target_text, document_title, created_at, updated_at)
      VALUES (?, '', '', '', '', '', ?, ?)
    `).run('popup-move-repair', oldTs, oldTs)
    db.prepare(`
      INSERT INTO ai_popup_refs (popup_id, note_id, source_type, created_at, updated_at)
      VALUES (?, ?, 'local-folder', ?, ?)
    `).run('popup-move-repair', uppercaseUuid, oldTs, oldTs)

    const moved = moveLocalNoteIdentity({
      from_notebook_id: fromNotebook.id,
      from_relative_path: 'docs/a.md',
      to_notebook_id: toNotebook.id,
      to_relative_path: 'archive/a.md',
    })
    expect(moved).toBe(1)

    expect(getLocalNoteIdentityByPath({
      notebook_id: fromNotebook.id,
      relative_path: 'docs/a.md',
    })).toBeNull()

    const target = getLocalNoteIdentityByPath({
      notebook_id: toNotebook.id,
      relative_path: 'archive/a.md',
    })
    expect(target?.note_uid).toBe(created.note_uid)

    const popupRef = db.prepare(`
      SELECT note_id, updated_at
      FROM ai_popup_refs
      WHERE popup_id = ?
    `).get('popup-move-repair') as { note_id: string; updated_at: string } | undefined
    expect(popupRef?.note_id).toBe(created.note_uid)
    expect(popupRef?.updated_at).not.toBe(oldTs)
    const stalePopupRefCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM ai_popup_refs
      WHERE popup_id = ? AND note_id = ?
    `).get('popup-move-repair', uppercaseUuid) as { count: number }
    expect(stalePopupRefCount.count).toBe(0)
  })
})
