import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'module'
import {
  __setVectorDatabaseForTests,
  deleteNoteIndexes,
  getAllIndexedNoteIds,
  getIndexedExistingNoteIds,
  getIndexedNoteIdsByPrefix,
  getNoteIndexStatusBatch,
  updateNoteIndexFileMtimeIfIndexed,
} from '../database'

const require = createRequire(import.meta.url)

let BetterSqlite: any = null
let sqliteAvailable = false

try {
  BetterSqlite = require('better-sqlite3')
  const probe = new BetterSqlite(':memory:')
  probe.close()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

function createTestDb(): any {
  const db = new BetterSqlite(':memory:')
  db.exec(`
    CREATE TABLE note_chunks (
      chunk_id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL
    );

    CREATE TABLE note_index_status (
      note_id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      chunk_count INTEGER NOT NULL,
      model_name TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      status TEXT DEFAULT 'indexed',
      error_message TEXT,
      fts_status TEXT,
      embedding_status TEXT,
      file_mtime TEXT
    );
  `)
  return db
}

function insertChunkRows(db: any, noteIds: string[]): void {
  const stmt = db.prepare(`
    INSERT INTO note_chunks (chunk_id, note_id)
    VALUES (?, ?)
  `)
  const tx = db.transaction((ids: string[]) => {
    for (const noteId of ids) {
      stmt.run(`chunk:${noteId}`, noteId)
    }
  })
  tx(noteIds)
}

function insertStatusRows(db: any, rows: Array<{ noteId: string; fileMtime?: string | null }>): void {
  const stmt = db.prepare(`
    INSERT INTO note_index_status
    (note_id, content_hash, chunk_count, model_name, indexed_at, status, error_message, fts_status, embedding_status, file_mtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const tx = db.transaction((items: Array<{ noteId: string; fileMtime?: string | null }>) => {
    for (const row of items) {
      stmt.run(
        row.noteId,
        `hash:${row.noteId}`,
        1,
        'test-model',
        '2026-04-07T00:00:00.000Z',
        'indexed',
        null,
        'indexed',
        'none',
        row.fileMtime ?? null
      )
    }
  })
  tx(rows)
}

describeSqlite('getNoteIndexStatusBatch', () => {
  let db: any = null

  beforeEach(() => {
    db = createTestDb()
    __setVectorDatabaseForTests(db, {
      ftsEnabled: false,
      ftsNeedsRebuild: false,
      ftsRebuildRunning: false,
    })
  })

  afterEach(() => {
    __setVectorDatabaseForTests(null)
    if (db) db.close()
  })

  it('treats note ids as opaque values in batch lookup', () => {
    insertStatusRows(db, [
      { noteId: 'note-1', fileMtime: '2026-01-01T00:00:00.000Z' },
      { noteId: 'note-2', fileMtime: '2026-01-02T00:00:00.000Z' },
    ])

    const result = getNoteIndexStatusBatch(['note-1', ' note-1 ', 'note-2', ''])

    expect(result.size).toBe(2)
    expect(result.get('note-1')?.noteId).toBe('note-1')
    expect(result.get(' note-1 ')).toBeUndefined()
    expect(result.get('note-1')?.fileMtime).toBe('2026-01-01T00:00:00.000Z')
    expect(result.get('note-2')?.noteId).toBe('note-2')
  })

  it('returns empty map for empty input', () => {
    const result = getNoteIndexStatusBatch([])
    expect(result.size).toBe(0)
  })

  it('queries in chunks when note id count exceeds sqlite placeholder safety size', () => {
    const rows = Array.from({ length: 620 }, (_, idx) => ({ noteId: `note-${idx}` }))
    insertStatusRows(db, rows)

    const result = getNoteIndexStatusBatch(rows.map((row) => row.noteId))

    expect(result.size).toBe(620)
    expect(result.get('note-619')?.noteId).toBe('note-619')
  })

  it('lists indexed note ids without loading full status payloads', () => {
    insertStatusRows(db, [
      { noteId: 'note-a' },
      { noteId: 'note-b' },
    ])

    const result = getAllIndexedNoteIds().sort()
    expect(result).toEqual(['note-a', 'note-b'])
  })

  it('queries indexed note ids by prefix range', () => {
    insertStatusRows(db, [
      { noteId: 'local:nb-1:foo.md' },
      { noteId: 'local:nb-1:bar.md' },
      { noteId: 'local:nb-2:other.md' },
      { noteId: 'nb-1:legacy.md' },
    ])

    const canonical = getIndexedNoteIdsByPrefix('local:nb-1:').sort()
    const legacy = getIndexedNoteIdsByPrefix('nb-1:').sort()

    expect(canonical).toEqual(['local:nb-1:bar.md', 'local:nb-1:foo.md'])
    expect(legacy).toEqual(['nb-1:legacy.md'])
  })

  it('preserves prefix bytes for legacy ids with surrounding spaces in notebook id', () => {
    insertStatusRows(db, [
      { noteId: '  nb-1  :legacy.md' },
      { noteId: 'nb-1:legacy.md' },
    ])

    const exactSpaced = getIndexedNoteIdsByPrefix('  nb-1  :').sort()
    const trimmed = getIndexedNoteIdsByPrefix('nb-1:').sort()

    expect(exactSpaced).toEqual(['  nb-1  :legacy.md'])
    expect(trimmed).toEqual(['nb-1:legacy.md'])
  })

  it('supports encoded canonical prefix for notebook ids containing colon', () => {
    insertStatusRows(db, [
      { noteId: 'local:nbenc:team%3Aproject:foo.md' },
      { noteId: 'local:nbenc:team%3Aproject:bar.md' },
      { noteId: 'local:nbenc:team%3Aother:baz.md' },
    ])

    const encoded = getIndexedNoteIdsByPrefix('local:nbenc:team%3Aproject:').sort()
    expect(encoded).toEqual([
      'local:nbenc:team%3Aproject:bar.md',
      'local:nbenc:team%3Aproject:foo.md',
    ])
  })

  it('returns existing ids only for exact-id probes without trim aliasing', () => {
    insertStatusRows(db, [
      { noteId: 'uuid-a' },
      { noteId: 'uuid-b' },
    ])

    const result = getIndexedExistingNoteIds(['uuid-a', 'uuid-a', 'uuid-missing', ' uuid-b ']).sort()
    expect(result).toEqual(['uuid-a'])
  })

  it('batch deletes note chunks and index status in chunks with dedupe', () => {
    const rows = Array.from({ length: 620 }, (_, idx) => ({ noteId: `note-${idx}` }))
    insertStatusRows(db, rows)
    insertChunkRows(db, rows.map((row) => row.noteId))

    const deleted = deleteNoteIndexes([
      ...rows.map((row) => row.noteId),
      'note-1',
      ' note-2 ',
      '',
    ])

    // note ids are treated as opaque keys (no trim aliasing), so " note-2 " is a distinct id.
    expect(deleted).toBe(621)
    const remainingStatus = db.prepare('SELECT COUNT(*) as count FROM note_index_status').get() as { count: number }
    const remainingChunks = db.prepare('SELECT COUNT(*) as count FROM note_chunks').get() as { count: number }
    expect(remainingStatus.count).toBe(0)
    expect(remainingChunks.count).toBe(0)
  })

  it('backfills file_mtime when status is indexed and fts indexed', () => {
    insertStatusRows(db, [{ noteId: 'note-a', fileMtime: null }])

    const updated = updateNoteIndexFileMtimeIfIndexed('note-a', '2026-04-08T00:00:00.000Z')
    const row = db.prepare('SELECT file_mtime FROM note_index_status WHERE note_id = ?').get('note-a') as {
      file_mtime: string | null
    }

    expect(updated).toBe(true)
    expect(row.file_mtime).toBe('2026-04-08T00:00:00.000Z')
  })

  it('skips file_mtime backfill when status is not indexed', () => {
    insertStatusRows(db, [{ noteId: 'note-a', fileMtime: null }])
    db.prepare('UPDATE note_index_status SET status = ? WHERE note_id = ?').run('error', 'note-a')

    const updated = updateNoteIndexFileMtimeIfIndexed('note-a', '2026-04-08T00:00:00.000Z')
    const row = db.prepare('SELECT file_mtime FROM note_index_status WHERE note_id = ?').get('note-a') as {
      file_mtime: string | null
    }

    expect(updated).toBe(false)
    expect(row.file_mtime).toBeNull()
  })

  it('skips file_mtime backfill when fts is not indexed', () => {
    insertStatusRows(db, [{ noteId: 'note-a', fileMtime: null }])
    db.prepare('UPDATE note_index_status SET fts_status = ? WHERE note_id = ?').run('none', 'note-a')

    const updated = updateNoteIndexFileMtimeIfIndexed('note-a', '2026-04-08T00:00:00.000Z')
    const row = db.prepare('SELECT file_mtime FROM note_index_status WHERE note_id = ?').get('note-a') as {
      file_mtime: string | null
    }

    expect(updated).toBe(false)
    expect(row.file_mtime).toBeNull()
  })
})
