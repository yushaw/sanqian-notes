import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRequire } from 'module'
import {
  __setVectorDatabaseForTests,
  insertNoteChunks,
  scheduleFtsRebuild,
  searchKeyword
} from '../database'

const require = createRequire(import.meta.url)
// Dynamic require for better-sqlite3 - may not be available in all test environments
let BetterSqlite: any = null
let sqliteAvailable = false

try {
  BetterSqlite = require('better-sqlite3')
  const probe = new BetterSqlite(':memory:')
  probe.close()
  sqliteAvailable = true
} catch (error) {
  sqliteAvailable = false
  console.warn('[FTS Tests] better-sqlite3 unavailable, skipping FTS tests:', error)
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

type TestChunk = {
  chunkId: string
  noteId: string
  notebookId: string
  chunkIndex: number
  chunkText: string
  chunkHash: string | null
  charStart: number
  charEnd: number
  heading: string | null
  createdAt: string
}

function createTestDb(): any {
  const db = new BetterSqlite(':memory:')
  db.exec(`
    CREATE TABLE note_chunks (
      chunk_id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      notebook_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      chunk_hash TEXT,
      char_start INTEGER,
      char_end INTEGER,
      heading TEXT,
      created_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE note_chunks_fts USING fts5(
      chunk_id UNINDEXED,
      note_id UNINDEXED,
      notebook_id UNINDEXED,
      tokens
    );
  `)
  return db
}

function insertChunkRow(db: any, chunk: TestChunk): void {
  db.prepare(
    `
    INSERT INTO note_chunks
    (chunk_id, note_id, notebook_id, chunk_index, chunk_text, chunk_hash, char_start, char_end, heading, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    chunk.chunkId,
    chunk.noteId,
    chunk.notebookId,
    chunk.chunkIndex,
    chunk.chunkText,
    chunk.chunkHash,
    chunk.charStart,
    chunk.charEnd,
    chunk.heading,
    chunk.createdAt
  )
}

function makeChunk(id: string, text: string): TestChunk {
  return {
    chunkId: id,
    noteId: 'note-1',
    notebookId: 'nb-1',
    chunkIndex: 0,
    chunkText: text,
    chunkHash: null,
    charStart: 0,
    charEnd: text.length,
    heading: null,
    createdAt: new Date().toISOString()
  }
}

describeSqlite('FTS search', () => {
  let db: any = null

  beforeEach(() => {
    db = createTestDb()
    __setVectorDatabaseForTests(db, {
      ftsEnabled: true,
      ftsNeedsRebuild: false,
      ftsRebuildRunning: false
    })
  })

  afterEach(() => {
    __setVectorDatabaseForTests(null)
    if (db) {
      db.close()
    }
  })

  it('falls back to LIKE when FTS query fails', () => {
    const chunk = makeChunk('c1', 'hello world')
    insertChunkRow(db, chunk)
    db.exec('DROP TABLE note_chunks_fts;')

    const results = searchKeyword('hello', 10)
    expect(results.length).toBe(1)
    expect(results[0].chunkId).toBe('c1')
  })

  it('returns FTS results when ready', () => {
    const chunk = makeChunk('c1', 'hello world')
    insertNoteChunks([chunk])

    const results = searchKeyword('hello', 10)
    expect(results.length).toBe(1)
    expect(results[0].chunkId).toBe('c1')
  })
})

describeSqlite('FTS rebuild', () => {
  let db: any = null

  beforeEach(() => {
    db = createTestDb()
    __setVectorDatabaseForTests(db, {
      ftsEnabled: true,
      ftsNeedsRebuild: true,
      ftsRebuildRunning: false
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    __setVectorDatabaseForTests(null)
    if (db) {
      db.close()
    }
  })

  it('rebuilds and retries when writes happen during rebuild', () => {
    const baseChunk = makeChunk('c1', 'base chunk')
    insertChunkRow(db, baseChunk)

    scheduleFtsRebuild()
    vi.runOnlyPendingTimers()

    const newChunk = makeChunk('c2', 'new chunk')
    insertNoteChunks([newChunk])

    vi.runAllTimers()

    const ftsCount = db.prepare('SELECT COUNT(*) as count FROM note_chunks_fts').get() as {
      count: number
    }
    const chunkCount = db.prepare('SELECT COUNT(*) as count FROM note_chunks').get() as {
      count: number
    }

    expect(ftsCount.count).toBe(chunkCount.count)
  })
})
