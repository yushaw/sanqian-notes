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
  deleteNote,
  getLiveNoteTitleEntries,
  getLiveNotesForDataviewProjection,
  getNotesByIds,
  getNotesByNotebookIds,
  initDatabase,
  searchNotes,
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
  console.warn('[Database Tests] better-sqlite3 unavailable, skipping database-notes-projection tests:', error)
}

if (process.env.CI && !sqliteAvailable) {
  throw new Error(
    '[Database Tests] better-sqlite3 unavailable in CI. Run `electron-rebuild` or `npm rebuild better-sqlite3` before tests.'
  )
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

describeSqlite('database note projection queries', () => {
  const testDbDir = mkdtempSync(join(tmpdir(), 'sanqian-notes-db-projection-'))

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

  it('getNotesByNotebookIds returns only live notes in target notebooks', () => {
    const notebookA = addNotebook({ name: 'A', icon: 'logo:notes' })
    const notebookB = addNotebook({ name: 'B', icon: 'logo:notes' })

    const noteA = addNote({
      title: 'A1',
      content: '{"type":"doc","content":[]}',
      notebook_id: notebookA.id,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })
    addNote({
      title: 'B1',
      content: '{"type":"doc","content":[]}',
      notebook_id: notebookB.id,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })
    addNote({
      title: 'Unfiled',
      content: '{"type":"doc","content":[]}',
      notebook_id: null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })

    const filtered = getNotesByNotebookIds([` ${notebookA.id} `, notebookA.id, ''])
    expect(filtered.map((note) => note.id)).toEqual([noteA.id])
  })

  it('getNotesByNotebookIds treats notebook ids as opaque values (no trim aliases)', () => {
    const notebookA = addNotebook({ name: 'A', icon: 'logo:notes' })
    const noteA = addNote({
      title: 'A1',
      content: '{"type":"doc","content":[]}',
      notebook_id: notebookA.id,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })

    const aliasOnly = getNotesByNotebookIds([` ${notebookA.id} `])
    expect(aliasOnly).toEqual([])

    const exact = getNotesByNotebookIds([notebookA.id])
    expect(exact.map((note) => note.id)).toEqual([noteA.id])
  })

  it('getNotesByIds excludes deleted notes by default and allows explicit includeDeleted', () => {
    const alive = addNote({
      title: 'Alive',
      content: '{"type":"doc","content":[]}',
      notebook_id: null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })
    const deleted = addNote({
      title: 'Deleted',
      content: '{"type":"doc","content":[]}',
      notebook_id: null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })
    deleteNote(deleted.id)

    const liveOnly = getNotesByIds([alive.id, deleted.id])
    expect(liveOnly.map((note) => note.id)).toEqual([alive.id])

    const includingDeleted = getNotesByIds([alive.id, deleted.id], { includeDeleted: true })
    expect(includingDeleted.map((note) => note.id)).toEqual([alive.id, deleted.id])
  })

  it('getLiveNoteTitleEntries excludes deleted notes', () => {
    const alive = addNote({
      title: 'Alive',
      content: '{"type":"doc","content":[]}',
      notebook_id: null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })
    const deleted = addNote({
      title: 'Deleted',
      content: '{"type":"doc","content":[]}',
      notebook_id: null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })
    deleteNote(deleted.id)

    const entries = getLiveNoteTitleEntries()
    expect(entries.some((entry) => entry.id === alive.id && entry.title === 'Alive')).toBe(true)
    expect(entries.some((entry) => entry.id === deleted.id)).toBe(false)
  })

  it('getLiveNotesForDataviewProjection returns lightweight fields only', () => {
    const note = addNote({
      title: 'Projection',
      content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"large content"}]}]}',
      notebook_id: null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: true,
    })

    const projections = getLiveNotesForDataviewProjection()
    const matched = projections.find((item) => item.id === note.id)
    expect(matched).toBeDefined()
    expect(matched).toMatchObject({
      id: note.id,
      title: 'Projection',
      notebook_id: null,
      is_pinned: true,
      tags: [],
    })
    expect(typeof matched?.updated_at).toBe('string')
    expect(matched && 'content' in matched).toBe(false)
  })

  it('searchNotes does not broaden to global query when notebook filter is explicit but blank', () => {
    const notebookA = addNotebook({ name: 'A', icon: 'logo:notes' })

    addNote({
      title: 'Needle A',
      content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"needle"}]}]}',
      notebook_id: notebookA.id,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })
    addNote({
      title: 'Needle Global',
      content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"needle"}]}]}',
      notebook_id: null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })

    expect(searchNotes('needle', { notebookId: '' })).toEqual([])
    expect(searchNotes('needle', { notebookId: '   ' })).toEqual([])
  })

  it('searchNotes treats explicit undefined notebook filter as omitted', () => {
    const notebookA = addNotebook({ name: 'A', icon: 'logo:notes' })

    addNote({
      title: 'Needle A',
      content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"needle"}]}]}',
      notebook_id: notebookA.id,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })
    addNote({
      title: 'Needle Global',
      content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"needle"}]}]}',
      notebook_id: null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })

    const scopedAsUndefined = searchNotes('needle', { notebookId: undefined } as any)
    expect(scopedAsUndefined).toHaveLength(2)
  })
})
