import { createRequire } from 'module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  __setVectorDatabaseForTests,
  getEmbeddingConfig,
  setEmbeddingConfig,
} from '../database-core'
import { EMBEDDING_MAX_DIMENSIONS, type EmbeddingConfig } from '../types'

const require = createRequire(import.meta.url)

let BetterSqliteCtor: (new (filename: string) => Database.Database) | null = null
let sqliteAvailable = false

try {
  const betterSqlite = require('better-sqlite3') as new (filename: string) => Database.Database
  const probe = new betterSqlite(':memory:')
  probe.close()
  BetterSqliteCtor = betterSqlite
  sqliteAvailable = true
} catch (error) {
  sqliteAvailable = false
  console.warn('[Embedding Core Tests] better-sqlite3 unavailable, skipping:', error)
}

const describeSqlite = sqliteAvailable ? describe : describe.skip

const BASE_CONFIG: EmbeddingConfig = {
  enabled: true,
  source: 'custom',
  apiType: 'openai',
  apiUrl: 'https://api.openai.com/v1/embeddings',
  apiKey: '',
  modelName: 'text-embedding-3-small',
  dimensions: 1536,
}

function createCoreTestDb(): Database.Database {
  if (!BetterSqliteCtor) {
    throw new Error('better-sqlite3 is unavailable')
  }
  const db = new BetterSqliteCtor(':memory:')
  db.exec(`
    CREATE TABLE note_chunks (
      chunk_id TEXT PRIMARY KEY
    );
    CREATE TABLE note_index_status (
      note_id TEXT PRIMARY KEY
    );
    CREATE TABLE embedding_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE note_embeddings (
      chunk_id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      notebook_id TEXT NOT NULL,
      embedding TEXT
    );
  `)
  return db
}

function seedConfiguredEmbeddingState(db: Database.Database, config: EmbeddingConfig): void {
  db.prepare('INSERT OR REPLACE INTO embedding_config (key, value) VALUES (?, ?)').run(
    'config',
    JSON.stringify(config)
  )
  db.prepare('INSERT OR REPLACE INTO embedding_config (key, value) VALUES (?, ?)').run(
    'dimensions',
    String(config.dimensions)
  )
  db.prepare('INSERT INTO note_chunks (chunk_id) VALUES (?)').run('chunk-1')
  db.prepare('INSERT INTO note_index_status (note_id) VALUES (?)').run('note-1')
  db.prepare(
    'INSERT INTO note_embeddings (chunk_id, note_id, notebook_id, embedding) VALUES (?, ?, ?, ?)'
  ).run('chunk-1', 'note-1', 'nb-1', '[0.1,0.2]')
}

describeSqlite('embedding database-core setEmbeddingConfig', () => {
  let db: Database.Database | null = null

  beforeEach(() => {
    db = createCoreTestDb()
    __setVectorDatabaseForTests(db, {
      ftsEnabled: false,
      ftsNeedsRebuild: false,
      ftsRebuildRunning: false,
    })
  })

  afterEach(() => {
    __setVectorDatabaseForTests(null)
    db?.close()
    db = null
  })

  it('rolls back config and index mutations when vector table recreation fails', () => {
    if (!db) throw new Error('db is unavailable')
    seedConfiguredEmbeddingState(db, BASE_CONFIG)

    expect(() => {
      setEmbeddingConfig({
        ...BASE_CONFIG,
        modelName: 'text-embedding-3-large',
        dimensions: 3072,
      })
    }).toThrow()

    const persistedConfigRow = db
      .prepare("SELECT value FROM embedding_config WHERE key = 'config'")
      .get() as { value: string } | undefined
    expect(persistedConfigRow).toBeDefined()
    if (!persistedConfigRow) return
    const persistedConfig = JSON.parse(persistedConfigRow.value) as EmbeddingConfig
    expect(persistedConfig.modelName).toBe(BASE_CONFIG.modelName)
    expect(persistedConfig.dimensions).toBe(BASE_CONFIG.dimensions)

    const chunkCount = (db.prepare('SELECT COUNT(*) as count FROM note_chunks').get() as { count: number }).count
    const statusCount = (db.prepare('SELECT COUNT(*) as count FROM note_index_status').get() as { count: number }).count
    const embeddingCount = (db.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as { count: number }).count
    expect(chunkCount).toBe(1)
    expect(statusCount).toBe(1)
    expect(embeddingCount).toBe(1)
  })

  it('rejects out-of-range dimensions before mutating persisted config', () => {
    if (!db) throw new Error('db is unavailable')
    seedConfiguredEmbeddingState(db, BASE_CONFIG)

    expect(() => {
      setEmbeddingConfig({
        ...BASE_CONFIG,
        dimensions: EMBEDDING_MAX_DIMENSIONS + 1,
      })
    }).toThrow(`Invalid embedding dimensions: expected integer between 0 and ${EMBEDDING_MAX_DIMENSIONS}`)

    const persistedConfigRow = db
      .prepare("SELECT value FROM embedding_config WHERE key = 'config'")
      .get() as { value: string } | undefined
    expect(persistedConfigRow).toBeDefined()
    if (!persistedConfigRow) return
    const persistedConfig = JSON.parse(persistedConfigRow.value) as EmbeddingConfig
    expect(persistedConfig.dimensions).toBe(BASE_CONFIG.dimensions)
  })

  it('normalizes malformed persisted config values when loading runtime config', () => {
    if (!db) throw new Error('db is unavailable')
    db.prepare('INSERT OR REPLACE INTO embedding_config (key, value) VALUES (?, ?)').run(
      'config',
      JSON.stringify({
        enabled: 'yes',
        source: 'legacy-source',
        apiType: 'legacy-api',
        apiUrl: 42,
        apiKey: 7,
        modelName: null,
        dimensions: 'NaN',
      })
    )

    expect(getEmbeddingConfig()).toEqual({
      enabled: false,
      source: 'custom',
      apiType: 'custom',
      apiUrl: '',
      apiKey: '',
      modelName: '',
      dimensions: 0,
    })
  })
})
