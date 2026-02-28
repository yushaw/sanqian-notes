import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import {
  addNotebook,
  closeDatabase,
  deleteLocalNoteIdentityByPath,
  deleteLocalNoteMetadataByPath,
  ensureLocalNoteIdentity,
  getLocalNoteIdentityByPath,
  getLocalNoteIdentityByUid,
  getLocalNoteMetadata,
  initDatabase,
  listLocalNoteIdentity,
  moveLocalNoteIdentity,
  renameLocalNoteIdentityFolderPath,
  renameLocalNoteIdentityPath,
  listLocalNoteMetadata,
  renameLocalNoteMetadataFolderPath,
  renameLocalNoteMetadataPath,
  updateLocalNoteMetadata,
} from '../database'

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

describeSqlite('database local_note_metadata', () => {
  const testDbDir = mkdtempSync(join(tmpdir(), 'sanqian-notes-db-local-metadata-'))

  beforeAll(() => {
    vi.spyOn(app, 'getPath').mockReturnValue(testDbDir)
  })

  beforeEach(() => {
    closeDatabase()
    removeDbFiles(testDbDir)
    initDatabase()
  })

  afterAll(() => {
    closeDatabase()
    rmSync(testDbDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('creates and compacts local metadata rows', () => {
    const localNotebook = addNotebook({ name: 'Local', source_type: 'local-folder' })
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

  it('rejects metadata update for non-local notebook', () => {
    const internalNotebook = addNotebook({ name: 'Internal', source_type: 'internal' })
    const updated = updateLocalNoteMetadata({
      notebook_id: internalNotebook.id,
      relative_path: 'docs/a.md',
      is_favorite: true,
    })
    expect(updated).toBeNull()
  })

  it('renames metadata path for files and folders', () => {
    const localNotebook = addNotebook({ name: 'Local', source_type: 'local-folder' })
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

  it('merges metadata when rename target already exists', () => {
    const localNotebook = addNotebook({ name: 'Local', source_type: 'local-folder' })
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
    const localNotebook = addNotebook({ name: 'Local', source_type: 'local-folder' })
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
    const localNotebook = addNotebook({ name: 'Local', source_type: 'local-folder' })
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

  it('deletes identity rows by file or folder path', () => {
    const localNotebook = addNotebook({ name: 'Local', source_type: 'local-folder' })
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
    const internalNotebook = addNotebook({ name: 'Internal', source_type: 'internal' })
    const identity = ensureLocalNoteIdentity({
      notebook_id: internalNotebook.id,
      relative_path: 'docs/a.md',
    })
    expect(identity).toBeNull()
  })

  it('preserves uid when moving identity across local notebooks', () => {
    const fromNotebook = addNotebook({ name: 'Local A', source_type: 'local-folder' })
    const toNotebook = addNotebook({ name: 'Local B', source_type: 'local-folder' })

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
})
