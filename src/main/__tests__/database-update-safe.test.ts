import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app } from 'electron'
import { addNote, closeDatabase, initDatabase, updateNote, updateNoteSafe } from '../database'

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
  console.warn('[Database Tests] better-sqlite3 unavailable, skipping database-update-safe tests:', error)
}

if (process.env.CI && !sqliteAvailable) {
  throw new Error(
    '[Database Tests] better-sqlite3 unavailable in CI. Run `electron-rebuild` or `npm rebuild better-sqlite3` before tests.'
  )
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

describeSqlite('database updateNoteSafe', () => {
  const testDbDir = mkdtempSync(join(tmpdir(), 'sanqian-notes-db-'))

  beforeAll(() => {
    vi.spyOn(app, 'getPath').mockReturnValue(testDbDir)
  })

  beforeEach(() => {
    // Ensure a clean database for each test
    closeDatabase()
    removeDbFiles(testDbDir)
    initDatabase()
  })

  afterAll(() => {
    closeDatabase()
    rmSync(testDbDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('updates note when expected revision matches', () => {
    const created = addNote({
      title: 'Draft',
      content: '{"type":"doc","content":[]}',
      notebook_id: null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })

    const result = updateNoteSafe(created.id, { title: 'Draft v2' }, created.revision)

    expect(result.status).toBe('updated')
    if (result.status === 'updated') {
      expect(result.note.title).toBe('Draft v2')
      expect(result.note.revision).toBe(created.revision + 1)
    }
  })

  it('returns conflict when expected revision is stale', () => {
    const created = addNote({
      title: 'A',
      content: '{"type":"doc","content":[]}',
      notebook_id: null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })

    const first = updateNoteSafe(created.id, { title: 'B' }, created.revision)
    expect(first.status).toBe('updated')

    const conflict = updateNoteSafe(created.id, { title: 'C' }, created.revision)
    expect(conflict.status).toBe('conflict')
    if (conflict.status === 'conflict') {
      expect(conflict.current.title).toBe('B')
      expect(conflict.current.revision).toBe(created.revision + 1)
    }
  })

  it('returns not_found for unknown note id', () => {
    const result = updateNoteSafe('missing-note-id', { title: 'X' }, 0)
    expect(result.status).toBe('not_found')
  })

  it('keeps legacy updateNote behavior and bumps revision', () => {
    const created = addNote({
      title: 'Legacy',
      content: '{"type":"doc","content":[]}',
      notebook_id: null,
      is_daily: false,
      daily_date: null,
      is_favorite: false,
      is_pinned: false,
    })

    const updated = updateNote(created.id, { title: 'Legacy v2' })
    expect(updated).not.toBeNull()
    expect(updated?.title).toBe('Legacy v2')
    expect(updated?.revision).toBe(created.revision + 1)
  })
})
