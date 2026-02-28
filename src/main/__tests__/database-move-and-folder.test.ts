import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import {
  addNote,
  addNotebook,
  closeDatabase,
  deleteNotebook,
  deleteNote,
  getNoteById,
  initDatabase,
  moveNote,
  renameNotebookFolderEntry,
  updateNote,
  updateNoteSafe,
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
  console.warn('[Database Move/Folder Tests] better-sqlite3 unavailable, skipping tests:', error)
}

if (process.env.CI && !sqliteAvailable) {
  throw new Error(
    '[Database Move/Folder Tests] better-sqlite3 unavailable in CI. Run `electron-rebuild` or `npm rebuild better-sqlite3` before tests.'
  )
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

describeSqlite('database move note and folder rename', () => {
  const testDbDir = mkdtempSync(join(tmpdir(), 'sanqian-notes-db-move-folder-'))

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

  it('rejects moving internal note into local-folder notebook', () => {
    const internal = addNotebook({ name: 'Internal Source' })
    const localFolder = addNotebook({ name: 'Local Target', source_type: 'local-folder' })
    const note = addNote({
      title: 'Draft',
      content: '{"type":"doc","content":[]}',
      notebook_id: internal.id,
      folder_path: 'project/a',
    })

    expect(moveNote(note.id, localFolder.id)).toEqual({
      ok: false,
      error: 'target_not_allowed',
    })

    const unchanged = getNoteById(note.id)
    expect(unchanged?.notebook_id).toBe(internal.id)
    expect(unchanged?.folder_path).toBe('project/a')
  })

  it('updateNote rejects assigning notebook_id to local-folder notebook', () => {
    const internal = addNotebook({ name: 'Internal Source' })
    const localFolder = addNotebook({ name: 'Local Target', source_type: 'local-folder' })
    const note = addNote({
      title: 'Draft',
      content: '{"type":"doc","content":[]}',
      notebook_id: internal.id,
      folder_path: 'project/a',
    })

    const updated = updateNote(note.id, { notebook_id: localFolder.id })
    expect(updated).toBeNull()

    const unchanged = getNoteById(note.id)
    expect(unchanged?.notebook_id).toBe(internal.id)
    expect(unchanged?.folder_path).toBe('project/a')
  })

  it('updateNoteSafe rejects assigning notebook_id to local-folder notebook', () => {
    const internal = addNotebook({ name: 'Internal Source' })
    const localFolder = addNotebook({ name: 'Local Target', source_type: 'local-folder' })
    const note = addNote({
      title: 'Draft',
      content: '{"type":"doc","content":[]}',
      notebook_id: internal.id,
      folder_path: 'project/a',
    })

    const result = updateNoteSafe(note.id, { notebook_id: localFolder.id }, note.revision)
    expect(result).toEqual({ status: 'failed', error: 'target_not_allowed' })

    const unchanged = getNoteById(note.id)
    expect(unchanged?.notebook_id).toBe(internal.id)
    expect(unchanged?.folder_path).toBe('project/a')
  })

  it('clears folder_path when moving note across notebooks or out of notebook', () => {
    const sourceNotebook = addNotebook({ name: 'Source' })
    const targetNotebook = addNotebook({ name: 'Target' })

    const first = addNote({
      title: 'Cross Notebook',
      content: '{"type":"doc","content":[]}',
      notebook_id: sourceNotebook.id,
      folder_path: 'alpha/beta',
    })

    expect(moveNote(first.id, targetNotebook.id)).toEqual({ ok: true })
    const moved = getNoteById(first.id)
    expect(moved?.notebook_id).toBe(targetNotebook.id)
    expect(moved?.folder_path).toBeNull()

    const second = addNote({
      title: 'To Inbox',
      content: '{"type":"doc","content":[]}',
      notebook_id: sourceNotebook.id,
      folder_path: 'daily',
    })
    expect(moveNote(second.id, null)).toEqual({ ok: true })
    const detached = getNoteById(second.id)
    expect(detached?.notebook_id).toBeNull()
    expect(detached?.folder_path).toBeNull()
  })

  it('bumps revision when moveNote succeeds', () => {
    const sourceNotebook = addNotebook({ name: 'Source' })
    const targetNotebook = addNotebook({ name: 'Target' })
    const note = addNote({
      title: 'Revision Move',
      content: '{"type":"doc","content":[]}',
      notebook_id: sourceNotebook.id,
      folder_path: 'alpha',
    })

    expect(moveNote(note.id, targetNotebook.id)).toEqual({ ok: true })
    const moved = getNoteById(note.id)
    expect(moved).not.toBeNull()
    expect(moved?.revision).toBe(note.revision + 1)
  })

  it('clears stale folder_path even when moving detached note to null again', () => {
    const dirty = addNote({
      title: 'Legacy Dirty',
      content: '{"type":"doc","content":[]}',
      notebook_id: null,
      folder_path: 'legacy/dirty',
    })

    expect(moveNote(dirty.id, null)).toEqual({ ok: true })
    const healed = getNoteById(dirty.id)
    expect(healed?.notebook_id).toBeNull()
    expect(healed?.folder_path).toBeNull()
  })

  it('clears folder_path when deleting notebook detaches notes', () => {
    const notebook = addNotebook({ name: 'Will Delete' })
    const note = addNote({
      title: 'Detach On Delete',
      content: '{"type":"doc","content":[]}',
      notebook_id: notebook.id,
      folder_path: 'project/legacy',
    })

    expect(deleteNotebook(notebook.id)).toBe(true)
    const detached = getNoteById(note.id)
    expect(detached?.notebook_id).toBeNull()
    expect(detached?.folder_path).toBeNull()
  })

  it('ignores trashed-note conflicts when renaming notebook folder', () => {
    const notebook = addNotebook({ name: 'Workspace' })
    const active = addNote({
      title: 'Active Note',
      content: '{"type":"doc","content":[]}',
      notebook_id: notebook.id,
      folder_path: 'old-folder',
    })
    const trashedConflict = addNote({
      title: 'Trashed Destination',
      content: '{"type":"doc","content":[]}',
      notebook_id: notebook.id,
      folder_path: 'new-folder',
    })
    expect(deleteNote(trashedConflict.id)).toBe(true)

    const renamed = renameNotebookFolderEntry({
      notebook_id: notebook.id,
      folder_path: 'old-folder',
      next_folder_path: 'new-folder',
    })

    expect(renamed).toEqual({ ok: true })
    expect(getNoteById(active.id)?.folder_path).toBe('new-folder')
  })
})
