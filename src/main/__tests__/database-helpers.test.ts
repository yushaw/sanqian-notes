import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import {
  addNote,
  closeDatabase,
  createLocalFolderNotebookMount,
  initDatabase,
} from '../database'
import { getDb } from '../database/connection'
import {
  hasInternalNoteId,
  isLocalFolderNotebookId,
  tableExists,
} from '../database/helpers'

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
  console.warn('[Database Helpers Tests] better-sqlite3 unavailable, skipping database helper tests:', error)
}

if (process.env.CI && !sqliteAvailable) {
  throw new Error(
    '[Database Helpers Tests] better-sqlite3 unavailable in CI. Run `electron-rebuild` or `npm rebuild better-sqlite3` before tests.'
  )
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

describeSqlite('database helper statement cache', () => {
  const testDbDir = mkdtempSync(join(tmpdir(), 'sanqian-notes-db-helpers-'))

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

  it('tableExists still works after schema changes remove unrelated helper tables', () => {
    expect(tableExists('notes')).toBe(true)
    expect(tableExists('local_note_identity')).toBe(true)

    const db = getDb()
    db.exec('DROP TABLE local_note_identity')

    expect(() => tableExists('notes')).not.toThrow()
    expect(tableExists('notes')).toBe(true)
    expect(tableExists('local_note_identity')).toBe(false)
  })

  it('other helper lookups remain usable after schema refresh', () => {
    const note = addNote({
      title: 'Helper Cache Note',
      content: JSON.stringify({ type: 'doc', content: [] }),
    })
    const localFolderNotebook = createLocalFolderNotebookMount({
      name: 'Helper Cache Local',
      root_path: '/tmp/sanqian-db-helpers-local',
      canonical_root_path: '/tmp/sanqian-db-helpers-local',
    }).notebook

    expect(hasInternalNoteId(note.id)).toBe(true)
    expect(isLocalFolderNotebookId(localFolderNotebook.id)).toBe(true)

    const db = getDb()
    db.exec('DROP TABLE local_note_identity')

    expect(() => hasInternalNoteId(note.id)).not.toThrow()
    expect(hasInternalNoteId(note.id)).toBe(true)
    expect(() => isLocalFolderNotebookId(localFolderNotebook.id)).not.toThrow()
    expect(isLocalFolderNotebookId(localFolderNotebook.id)).toBe(true)
  })
})
