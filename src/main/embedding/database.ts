/**
 * 知识库 - 向量数据库模块
 *
 * 使用 sqlite-vec 扩展实现高效向量搜索
 * 采用 vec0 虚拟表存储和检索向量
 */

import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { app } from 'electron'
import { join } from 'path'

/**
 * 获取 sqlite-vec 扩展的实际路径
 * 在 Electron 打包后，需要将 asar 路径替换为 asar.unpacked 路径
 * 同时处理 npm 包嵌套的情况（sqlite-vec-darwin-arm64 可能在 sqlite-vec/node_modules/ 下）
 */
function getVecExtensionPath(): string {
  const platform = process.platform
  const arch = process.arch

  // 构建平台特定包名
  const os = platform === 'win32' ? 'windows' : platform
  const packageName = `sqlite-vec-${os}-${arch}`
  const ext = platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so'

  // 获取 sqlite-vec 模块的目录
  const sqliteVecDir = require.resolve('sqlite-vec').replace(/[/\\]index\.(cjs|mjs|js)$/, '')

  // 尝试多个可能的路径
  const possiblePaths = [
    // 嵌套在 sqlite-vec/node_modules/ 下
    join(sqliteVecDir, 'node_modules', packageName, `vec0.${ext}`),
    // 与 sqlite-vec 同级（npm 扁平安装）
    join(sqliteVecDir, '..', packageName, `vec0.${ext}`),
  ]

  for (const p of possiblePaths) {
    // 在打包环境中，将 app.asar 替换为 app.asar.unpacked
    const unpackedPath = p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
    try {
      require('fs').statSync(unpackedPath)
      return unpackedPath
    } catch {
      // 继续尝试下一个路径
    }
  }

  // 如果都找不到，fallback 到原来的方法（可能在开发环境下工作）
  try {
    return sqliteVec.getLoadablePath()
  } catch {
    throw new Error(`sqlite-vec extension not found. Tried paths: ${possiblePaths.join(', ')}`)
  }
}
import type { EmbeddingConfig, NoteChunk, NoteIndexStatus, VectorSearchResult } from './types'
import { DEFAULT_CONFIG } from './types'
import { normalizeCjkAscii } from './utils'
import { encrypt, decrypt } from './encryption'
import { buildSearchTokens, tokenizeForSearch, warmupTokenizer } from './tokenizer'

let db: Database.Database | null = null
let ftsEnabled = false
let ftsNeedsRebuild = false
let ftsRebuildRunning = false
let ftsRebuildDirty = false

const DEFAULT_L2_THRESHOLD = 2.0
const DEFAULT_EMBEDDING_DIM = 1536

function getScaledThreshold(threshold: number): number {
  if (!Number.isFinite(threshold)) return DEFAULT_L2_THRESHOLD
  if (threshold !== DEFAULT_L2_THRESHOLD) return threshold

  const config = getEmbeddingConfig()
  const dim = config.dimensions
  if (!Number.isFinite(dim) || dim <= 0) return threshold

  return threshold * Math.sqrt(dim / DEFAULT_EMBEDDING_DIM)
}

/**
 * 获取数据库路径
 */
function getDbPath(): string {
  return join(app.getPath('userData'), 'notes_vectors.db')
}

/**
 * 初始化向量数据库
 */
export function initVectorDatabase(): void {
  if (db) return

  const dbPath = getDbPath()
  db = new Database(dbPath)

  // 加载 sqlite-vec 扩展（使用修正后的路径以支持 asar 打包）
  const vecPath = getVecExtensionPath()
  db.loadExtension(vecPath)

  // 启用 WAL 模式
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')

  // 验证 sqlite-vec 加载成功
  const { vec_version } = db.prepare('SELECT vec_version() as vec_version').get() as {
    vec_version: string
  }
  console.log('[Embedding] sqlite-vec version:', vec_version)

  // 创建元数据表
  db.exec(`
    -- 笔记块元数据表
    -- 注意：不再使用 UNIQUE(note_id, chunk_index)，因为：
    -- 1. chunk_id 已是 PRIMARY KEY，保证唯一性
    -- 2. 更新 chunk_index 时可能因顺序问题违反约束
    CREATE TABLE IF NOT EXISTS note_chunks (
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

    -- 笔记索引状态表
    CREATE TABLE IF NOT EXISTS note_index_status (
      note_id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      chunk_count INTEGER NOT NULL,
      model_name TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      status TEXT DEFAULT 'indexed',
      error_message TEXT
    );

    -- Embedding 配置表
    CREATE TABLE IF NOT EXISTS embedding_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- 索引
    CREATE INDEX IF NOT EXISTS idx_chunks_note_id ON note_chunks(note_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_notebook_id ON note_chunks(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_status_updated ON note_index_status(indexed_at);
  `)

  // 数据库迁移：为已有表添加 chunk_hash 列
  migrateDatabase(db)
  initFtsIndex(db)

  // 获取当前配置的维度来创建向量表
  const config = getEmbeddingConfigInternal(db)
  createVectorTable(db, config.dimensions)

  console.log('[Embedding] Vector database initialized:', dbPath)
}

/**
 * 初始化 FTS 索引（关键词检索）
 */
function initFtsIndex(database: Database.Database): void {
  try {
    const exists = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='note_chunks_fts'")
      .get() as { name?: string }

    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS note_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        note_id UNINDEXED,
        notebook_id UNINDEXED,
        tokens
      );
    `)

    ftsEnabled = true
    setTimeout(() => {
      try {
        warmupTokenizer()
      } catch (error) {
        console.warn('[Embedding] Tokenizer warmup failed:', error)
      }
    }, 0)

    const ftsCount = database
      .prepare('SELECT COUNT(*) as count FROM note_chunks_fts')
      .get() as { count: number }
    const chunkCount = database
      .prepare('SELECT COUNT(*) as count FROM note_chunks')
      .get() as { count: number }

    if (!exists?.name || ftsCount.count < chunkCount.count) {
      ftsNeedsRebuild = true
      console.log('[Embedding] FTS index pending rebuild (background)')
    }
  } catch (error) {
    ftsEnabled = false
    console.warn('[Embedding] FTS5 unavailable, fallback to LIKE:', error)
  }
}

/**
 * 重建 FTS 索引（用于升级或损坏修复）
 */
function rebuildFtsIndex(database: Database.Database, batchSize: number = 2000): void {
  if (!ftsEnabled) return

  const targetTable = 'note_chunks_fts'
  const newTable = 'note_chunks_fts_new'
  const backupTable = 'note_chunks_fts_old'

  ftsRebuildDirty = false

  const rows = database
    .prepare('SELECT chunk_id, note_id, notebook_id, chunk_text FROM note_chunks')
    .all() as Array<{ chunk_id: string; note_id: string; notebook_id: string; chunk_text: string }>

  database.exec(`DROP TABLE IF EXISTS ${newTable};`)
  database.exec(`
    CREATE VIRTUAL TABLE ${newTable} USING fts5(
      chunk_id UNINDEXED,
      note_id UNINDEXED,
      notebook_id UNINDEXED,
      tokens
    );
  `)

  const stmt = database.prepare(
    `INSERT INTO ${newTable} (chunk_id, note_id, notebook_id, tokens) VALUES (?, ?, ?, ?)`
  )

  let cursor = 0
  const total = rows.length

  const insertBatch = () => {
    if (!db || db !== database) {
      ftsRebuildRunning = false
      return
    }

    const batch = rows.slice(cursor, cursor + batchSize)
    if (batch.length === 0) {
      try {
        database.exec('BEGIN IMMEDIATE;')
        const oldExists = database
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
          .get(targetTable) as { name?: string }
        database.exec(`DROP TABLE IF EXISTS ${backupTable};`)
        if (oldExists?.name) {
          database.exec(`ALTER TABLE ${targetTable} RENAME TO ${backupTable};`)
        }
        database.exec(`ALTER TABLE ${newTable} RENAME TO ${targetTable};`)
        database.exec('COMMIT;')

        if (oldExists?.name) {
          database.exec(`DROP TABLE IF EXISTS ${backupTable};`)
        }

        const ftsCount = database
          .prepare(`SELECT COUNT(*) as count FROM ${targetTable}`)
          .get() as { count: number }
        const chunkCount = database
          .prepare('SELECT COUNT(*) as count FROM note_chunks')
          .get() as { count: number }

        let needsRetry = ftsRebuildDirty
        if (ftsCount.count < chunkCount.count) {
          ftsNeedsRebuild = true
          needsRetry = true
          console.warn(
            `[Embedding] FTS rebuild incomplete: fts=${ftsCount.count}, chunks=${chunkCount.count}`
          )
        } else {
          ftsNeedsRebuild = false
        }

        if (needsRetry) {
          ftsNeedsRebuild = true
          console.log('[Embedding] FTS rebuild dirty, scheduling another pass')
        }

        ftsRebuildDirty = false
        ftsRebuildRunning = false
        console.log(`[Embedding] FTS index rebuilt: ${total} chunks`)

        if (needsRetry) {
          setTimeout(() => {
            scheduleFtsRebuild()
          }, 0)
        }
      } catch (error) {
        try {
          database.exec('ROLLBACK;')
        } catch {}
        ftsRebuildRunning = false
        ftsNeedsRebuild = true
        console.warn('[Embedding] FTS swap failed:', error)
      }
      return
    }

    const insertMany = database.transaction((items: typeof rows) => {
      for (const row of items) {
        let tokens = ''
        try {
          tokens = buildSearchTokens(row.chunk_text)
        } catch (error) {
          console.warn(`[Embedding] FTS tokenize failed for ${row.chunk_id}:`, error)
        }
        stmt.run(row.chunk_id, row.note_id, row.notebook_id, tokens)
      }
    })

    try {
      insertMany(batch)
      cursor += batch.length
      setTimeout(insertBatch, 0)
    } catch (error) {
      ftsRebuildRunning = false
      ftsNeedsRebuild = true
      console.warn('[Embedding] FTS rebuild failed:', error)
    }
  }

  insertBatch()
}

/**
 * 后台触发 FTS rebuild（避免启动阻塞）
 */
export function scheduleFtsRebuild(): void {
  if (!ftsEnabled || !ftsNeedsRebuild || ftsRebuildRunning || !db) return

  ftsRebuildRunning = true
  const database = db

  setTimeout(() => {
    try {
      rebuildFtsIndex(database)
    } catch (error) {
      ftsRebuildRunning = false
      ftsNeedsRebuild = true
      console.warn('[Embedding] FTS rebuild failed:', error)
    }
  }, 0)
}

/**
 * 数据库迁移
 */
function migrateDatabase(database: Database.Database): void {
  // 检查 chunk_hash 列是否存在
  const columns = database.prepare("PRAGMA table_info(note_chunks)").all() as Array<{ name: string }>
  const hasChunkHash = columns.some(col => col.name === 'chunk_hash')

  if (!hasChunkHash) {
    console.log('[Embedding] Migrating: adding chunk_hash column')
    database.exec('ALTER TABLE note_chunks ADD COLUMN chunk_hash TEXT')
  }

  // 检查是否有 UNIQUE(note_id, chunk_index) 约束需要移除
  // SQLite 无法直接 DROP CONSTRAINT，需要重建表
  const indexInfo = database.prepare("PRAGMA index_list(note_chunks)").all() as Array<{
    name: string
    unique: number
  }>
  const hasUniqueConstraint = indexInfo.some(
    idx => idx.unique === 1 && idx.name.includes('sqlite_autoindex')
  )

  if (hasUniqueConstraint) {
    console.log('[Embedding] Migrating: removing UNIQUE(note_id, chunk_index) constraint')
    database.exec(`
      -- 清理可能残留的临时表（上次迁移失败的情况）
      DROP TABLE IF EXISTS note_chunks_new;
      -- 创建新表（无 UNIQUE 约束）
      CREATE TABLE note_chunks_new (
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
      -- 复制数据（为 created_at 提供默认值，防止旧数据为 NULL）
      INSERT INTO note_chunks_new
      SELECT chunk_id, note_id, notebook_id, chunk_index, chunk_text, chunk_hash,
             char_start, char_end, heading,
             COALESCE(created_at, datetime('now')) as created_at
      FROM note_chunks;
      -- 删除旧表
      DROP TABLE note_chunks;
      -- 重命名新表
      ALTER TABLE note_chunks_new RENAME TO note_chunks;
      -- 重建索引
      CREATE INDEX idx_chunks_note_id ON note_chunks(note_id);
      CREATE INDEX idx_chunks_notebook_id ON note_chunks(notebook_id);
    `)
  }

  // 确保 chunk_hash 索引存在（无论新表还是迁移后的表）
  database.exec('CREATE INDEX IF NOT EXISTS idx_chunks_hash ON note_chunks(chunk_hash)')

  // 迁移：为 note_index_status 添加 fts_status 和 embedding_status 列
  const statusColumns = database.prepare("PRAGMA table_info(note_index_status)").all() as Array<{ name: string }>
  const hasFtsStatus = statusColumns.some(col => col.name === 'fts_status')
  const hasEmbeddingStatus = statusColumns.some(col => col.name === 'embedding_status')

  if (!hasFtsStatus) {
    console.log('[Embedding] Migrating: adding fts_status column')
    database.exec("ALTER TABLE note_index_status ADD COLUMN fts_status TEXT DEFAULT 'none'")
    // 已有数据：如果 status='indexed' 且 chunk_count > 0，设置 fts_status='indexed'
    database.exec(`
      UPDATE note_index_status
      SET fts_status = 'indexed'
      WHERE status = 'indexed' AND chunk_count > 0
    `)
  }

  if (!hasEmbeddingStatus) {
    console.log('[Embedding] Migrating: adding embedding_status column')
    database.exec("ALTER TABLE note_index_status ADD COLUMN embedding_status TEXT DEFAULT 'none'")
    // 已有数据：如果 status='indexed' 且 chunk_count > 0，假设已有 embedding（因为之前是绑定的）
    database.exec(`
      UPDATE note_index_status
      SET embedding_status = 'indexed'
      WHERE status = 'indexed' AND chunk_count > 0
    `)
  }
}

/**
 * 创建向量虚拟表（如果维度变更需要重建）
 */
function createVectorTable(database: Database.Database, dimensions: number): void {
  // 维度无效时跳过创建（用户尚未配置 embedding）
  if (dimensions <= 0) {
    console.log('[Embedding] Skipping vector table creation: dimensions not configured')
    return
  }

  // 检查是否已存在向量表
  const tableExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='note_embeddings'")
    .get()

  if (tableExists) {
    // 检查维度是否匹配
    const storedDimensions = getStoredDimensions(database)
    if (storedDimensions === dimensions) {
      return // 维度一致，无需重建
    }
    // 维度不一致，需要重建
    console.log(
      `[Embedding] Dimensions changed from ${storedDimensions} to ${dimensions}, rebuilding vector table`
    )
    database.exec('DROP TABLE IF EXISTS note_embeddings')
  }

  // 创建 vec0 虚拟表
  database.exec(`
    CREATE VIRTUAL TABLE note_embeddings USING vec0(
      chunk_id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      notebook_id TEXT NOT NULL,
      embedding float[${dimensions}]
    );
  `)

  // 记录当前维度
  database
    .prepare('INSERT OR REPLACE INTO embedding_config (key, value) VALUES (?, ?)')
    .run('dimensions', String(dimensions))
}

/**
 * 获取存储的向量维度
 */
function getStoredDimensions(database: Database.Database): number | null {
  const row = database.prepare("SELECT value FROM embedding_config WHERE key = 'dimensions'").get() as
    | { value: string }
    | undefined
  return row ? parseInt(row.value, 10) : null
}

/**
 * 关闭数据库
 * 执行 WAL checkpoint 确保所有写入都刷新到主数据库
 */
export function closeVectorDatabase(): void {
  if (db) {
    try {
      // TRUNCATE checkpoint: 将所有 WAL 页写入主数据库并截断 WAL
      db.pragma('wal_checkpoint(TRUNCATE)')
    } catch (e) {
      console.warn('[Embedding] WAL checkpoint failed:', e)
    }
    db.close()
    db = null
  }
}

/**
 * Test helper: inject a database instance and control FTS state.
 * Not intended for production use.
 */
export function __setVectorDatabaseForTests(
  database: Database.Database | null,
  options?: {
    ftsEnabled?: boolean
    ftsNeedsRebuild?: boolean
    ftsRebuildRunning?: boolean
  }
): void {
  db = database
  ftsEnabled = options?.ftsEnabled ?? false
  ftsNeedsRebuild = options?.ftsNeedsRebuild ?? false
  ftsRebuildRunning = options?.ftsRebuildRunning ?? false
  ftsRebuildDirty = false
}

/**
 * 获取数据库实例
 */
function getDb(): Database.Database {
  if (!db) {
    initVectorDatabase()
  }
  return db!
}

/**
 * 检查 note_embeddings 向量表是否存在
 * 用户未配置 embedding（dimensions <= 0）时表不存在
 */
function embeddingsTableExists(database: Database.Database): boolean {
  const result = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='note_embeddings'")
    .get()
  return !!result
}

// ============ 配置管理 ============

/**
 * 内部获取配置（不触发初始化）
 */
function getEmbeddingConfigInternal(database: Database.Database): EmbeddingConfig {
  const row = database.prepare("SELECT value FROM embedding_config WHERE key = 'config'").get() as
    | { value: string }
    | undefined

  if (row) {
    try {
      const config = JSON.parse(row.value) as EmbeddingConfig

      // 兼容旧版本配置（没有 source 字段）
      if (!config.source) {
        config.source = 'custom'
      }

      // 解密 API key（所有模式都加密存储）
      if (config.apiKey) {
        config.apiKey = decrypt(config.apiKey)
      }

      return config
    } catch {
      // 解析失败，返回默认配置
    }
  }

  return DEFAULT_CONFIG
}

/**
 * 获取 Embedding 配置
 */
export function getEmbeddingConfig(): EmbeddingConfig {
  return getEmbeddingConfigInternal(getDb())
}

/**
 * 保存 Embedding 配置
 * @returns indexCleared: 是否清空了索引, modelChanged: 模型是否变化（需要 rebuild）
 */
export function setEmbeddingConfig(config: EmbeddingConfig): {
  indexCleared: boolean
  modelChanged: boolean
} {
  const database = getDb()
  const oldConfig = getEmbeddingConfig()

  // 准备存储的配置（加密 API key，所有模式统一加密）
  const configToStore = { ...config }
  if (configToStore.apiKey) {
    configToStore.apiKey = encrypt(configToStore.apiKey)
  }

  database
    .prepare('INSERT OR REPLACE INTO embedding_config (key, value) VALUES (?, ?)')
    .run('config', JSON.stringify(configToStore))

  // 检测模型变化（dimensions 或 modelName 变化）
  const isFirstSetup = oldConfig.dimensions === 0 && config.dimensions > 0
  const dimensionsChanged = oldConfig.dimensions !== config.dimensions && oldConfig.dimensions > 0
  const modelChanged =
    oldConfig.modelName !== config.modelName &&
    oldConfig.modelName !== '' && // 旧配置为空时不触发（首次设置）
    config.modelName !== '' // 新配置为空时不触发（清空配置）

  // 首次配置：创建向量表（无需清空索引）
  if (isFirstSetup) {
    console.log('[Embedding] First setup, creating vector table')
    createVectorTable(database, config.dimensions)
    return { indexCleared: false, modelChanged: false }
  }

  // 如果维度变更，需要重建向量表
  if (dimensionsChanged) {
    console.log('[Embedding] Dimensions changed, recreating vector table')
    // 清空旧索引数据
    clearAllIndexData()
    // 重建向量表
    createVectorTable(database, config.dimensions)
    return { indexCleared: true, modelChanged: true }
  }

  // 如果只是模型名变化（dimensions 相同），需要 rebuild 但不用重建表
  if (modelChanged) {
    console.log(`[Embedding] Model changed from ${oldConfig.modelName} to ${config.modelName}`)
    return { indexCleared: false, modelChanged: true }
  }

  return { indexCleared: false, modelChanged: false }
}

/**
 * 检测当前配置的模型与已索引数据的模型是否一致
 * 用于启动时判断是否需要 rebuild
 */
export function checkModelConsistency(): {
  needsRebuild: boolean
  currentModel: string
  indexedModel: string | null
} {
  const database = getDb()
  const config = getEmbeddingConfig()

  // 获取已索引笔记使用的模型（取最新索引的笔记的模型）
  const row = database
    .prepare(
      `
      SELECT model_name FROM note_index_status
      WHERE status = 'indexed'
      ORDER BY indexed_at DESC
      LIMIT 1
    `
    )
    .get() as { model_name: string } | undefined

  const indexedModel = row?.model_name || null

  // 如果没有已索引的笔记，不需要 rebuild
  if (!indexedModel) {
    return {
      needsRebuild: false,
      currentModel: config.modelName,
      indexedModel: null
    }
  }

  // 如果当前配置的模型与已索引的模型不一致，需要 rebuild
  const needsRebuild = config.modelName !== indexedModel && config.modelName !== ''

  if (needsRebuild) {
    console.log(
      `[Embedding] Model mismatch: config=${config.modelName}, indexed=${indexedModel}, rebuild needed`
    )
  }

  return {
    needsRebuild,
    currentModel: config.modelName,
    indexedModel
  }
}

// ============ 笔记块管理 ============

/**
 * 插入笔记块
 */
export function insertNoteChunks(chunks: NoteChunk[]): void {
  const database = getDb()
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO note_chunks
    (chunk_id, note_id, notebook_id, chunk_index, chunk_text, chunk_hash, char_start, char_end, heading, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const ftsInsertStmt = ftsEnabled
    ? database.prepare(
        'INSERT INTO note_chunks_fts (chunk_id, note_id, notebook_id, tokens) VALUES (?, ?, ?, ?)'
      )
    : null
  const ftsDeleteStmt = ftsEnabled
    ? database.prepare('DELETE FROM note_chunks_fts WHERE chunk_id = ?')
    : null

  const insertMany = database.transaction((items: NoteChunk[]) => {
    for (const chunk of items) {
      stmt.run(
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
      if (ftsInsertStmt && ftsDeleteStmt && !ftsRebuildRunning) {
        let tokens = ''
        try {
          tokens = buildSearchTokens(chunk.chunkText)
        } catch (error) {
          console.warn(`[Embedding] FTS tokenize failed for ${chunk.chunkId}:`, error)
        }
        ftsDeleteStmt.run(chunk.chunkId)
        ftsInsertStmt.run(chunk.chunkId, chunk.noteId, chunk.notebookId, tokens)
      } else if (ftsEnabled && ftsRebuildRunning) {
        ftsRebuildDirty = true
      }
    }
  })

  insertMany(chunks)
}

/**
 * 删除笔记的所有块
 */
export function deleteNoteChunks(noteId: string): void {
  const database = getDb()
  database.prepare('DELETE FROM note_chunks WHERE note_id = ?').run(noteId)
  if (ftsEnabled && !ftsRebuildRunning) {
    database.prepare('DELETE FROM note_chunks_fts WHERE note_id = ?').run(noteId)
  } else if (ftsEnabled && ftsRebuildRunning) {
    ftsRebuildDirty = true
  }
}

/**
 * 更新笔记在索引中的 notebook_id（笔记移动到其他笔记本时调用）
 */
export function updateNoteNotebookId(noteId: string, newNotebookId: string): void {
  const database = getDb()
  database.prepare('UPDATE note_chunks SET notebook_id = ? WHERE note_id = ?').run(newNotebookId, noteId)
  if (ftsEnabled && !ftsRebuildRunning) {
    database.prepare('UPDATE note_chunks_fts SET notebook_id = ? WHERE note_id = ?').run(newNotebookId, noteId)
  }
  // note_embeddings 表没有 notebook_id 字段，不需要更新
}

/**
 * 获取笔记的所有块
 */
export function getNoteChunks(noteId: string): NoteChunk[] {
  const database = getDb()
  const rows = database
    .prepare('SELECT * FROM note_chunks WHERE note_id = ? ORDER BY chunk_index')
    .all(noteId) as Array<{
      chunk_id: string
      note_id: string
      notebook_id: string
      chunk_index: number
      chunk_text: string
      chunk_hash: string | null
      char_start: number
      char_end: number
      heading: string | null
      created_at: string
    }>

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    noteId: row.note_id,
    notebookId: row.notebook_id,
    chunkIndex: row.chunk_index,
    chunkText: row.chunk_text,
    chunkHash: row.chunk_hash,
    charStart: row.char_start,
    charEnd: row.char_end,
    heading: row.heading,
    createdAt: row.created_at
  }))
}

/**
 * 根据 chunk_id 列表删除指定的块
 */
export function deleteChunksByIds(chunkIds: string[]): void {
  if (chunkIds.length === 0) return
  const database = getDb()
  const placeholders = chunkIds.map(() => '?').join(',')
  database.prepare(`DELETE FROM note_chunks WHERE chunk_id IN (${placeholders})`).run(...chunkIds)
  if (ftsEnabled && !ftsRebuildRunning) {
    database
      .prepare(`DELETE FROM note_chunks_fts WHERE chunk_id IN (${placeholders})`)
      .run(...chunkIds)
  } else if (ftsEnabled && ftsRebuildRunning) {
    ftsRebuildDirty = true
  }
}

/**
 * 根据 chunk_id 列表删除指定的向量
 */
export function deleteEmbeddingsByChunkIds(chunkIds: string[]): void {
  if (chunkIds.length === 0) return
  const database = getDb()

  if (!embeddingsTableExists(database)) return

  // vec0 虚拟表需要逐条删除
  const stmt = database.prepare('DELETE FROM note_embeddings WHERE chunk_id = ?')
  const deleteMany = database.transaction((ids: string[]) => {
    for (const id of ids) {
      stmt.run(id)
    }
  })
  deleteMany(chunkIds)
}

/**
 * 更新 chunks 的位置元数据（用于 unchanged chunks 位置变化的情况）
 */
export function updateChunksMetadata(chunks: NoteChunk[]): void {
  if (chunks.length === 0) return
  const database = getDb()

  const stmt = database.prepare(`
    UPDATE note_chunks
    SET chunk_index = ?, char_start = ?, char_end = ?, heading = ?
    WHERE chunk_id = ?
  `)

  const updateMany = database.transaction((chunkList: NoteChunk[]) => {
    for (const chunk of chunkList) {
      stmt.run(chunk.chunkIndex, chunk.charStart, chunk.charEnd, chunk.heading, chunk.chunkId)
    }
  })

  updateMany(chunks)
}

// ============ 索引状态管理 ============

/**
 * 更新笔记索引状态
 */
export function updateNoteIndexStatus(status: NoteIndexStatus): void {
  const database = getDb()
  database
    .prepare(
      `
    INSERT OR REPLACE INTO note_index_status
    (note_id, content_hash, chunk_count, model_name, indexed_at, status, error_message, fts_status, embedding_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      status.noteId,
      status.contentHash,
      status.chunkCount,
      status.modelName,
      status.indexedAt,
      status.status,
      status.errorMessage || null,
      status.ftsStatus || 'none',
      status.embeddingStatus || 'none'
    )
}

/**
 * 获取笔记索引状态
 */
export function getNoteIndexStatus(noteId: string): NoteIndexStatus | null {
  const database = getDb()
  const row = database.prepare('SELECT * FROM note_index_status WHERE note_id = ?').get(noteId) as
    | {
      note_id: string
      content_hash: string
      chunk_count: number
      model_name: string
      indexed_at: string
      status: string
      error_message: string | null
      fts_status: string | null
      embedding_status: string | null
    }
    | undefined

  if (!row) return null

  return {
    noteId: row.note_id,
    contentHash: row.content_hash,
    chunkCount: row.chunk_count,
    modelName: row.model_name,
    indexedAt: row.indexed_at,
    status: row.status as 'indexed' | 'pending' | 'error',
    errorMessage: row.error_message || undefined,
    ftsStatus: (row.fts_status as 'none' | 'indexed') || 'none',
    embeddingStatus: (row.embedding_status as 'none' | 'indexed' | 'pending' | 'error') || 'none'
  }
}

/**
 * 删除笔记索引状态
 */
export function deleteNoteIndexStatus(noteId: string): void {
  const database = getDb()
  database.prepare('DELETE FROM note_index_status WHERE note_id = ?').run(noteId)
}

/**
 * 获取所有索引状态
 */
export function getAllIndexStatus(): NoteIndexStatus[] {
  const database = getDb()
  const rows = database.prepare('SELECT * FROM note_index_status').all() as Array<{
    note_id: string
    content_hash: string
    chunk_count: number
    model_name: string
    indexed_at: string
    status: string
    error_message: string | null
    fts_status: string | null
    embedding_status: string | null
  }>

  return rows.map((row) => ({
    noteId: row.note_id,
    contentHash: row.content_hash,
    chunkCount: row.chunk_count,
    modelName: row.model_name,
    indexedAt: row.indexed_at,
    status: row.status as 'indexed' | 'pending' | 'error',
    errorMessage: row.error_message || undefined,
    ftsStatus: (row.fts_status as 'none' | 'indexed') || 'none',
    embeddingStatus: (row.embedding_status as 'none' | 'indexed' | 'pending' | 'error') || 'none'
  }))
}

// ============ 向量存储 (sqlite-vec) ============

/**
 * 插入向量 (使用 sqlite-vec)
 *
 * 注意：vec0 虚拟表不完全支持 INSERT OR REPLACE，所以采用先删除再插入的方式
 */
export function insertEmbeddings(
  data: Array<{
    chunkId: string
    noteId: string
    notebookId: string
    embedding: number[]
  }>
): void {
  if (data.length === 0) return
  const database = getDb()

  if (!embeddingsTableExists(database)) {
    console.warn('[Embedding] Cannot insert embeddings: table not created (embedding not configured)')
    return
  }

  const deleteStmt = database.prepare('DELETE FROM note_embeddings WHERE chunk_id = ?')
  const insertStmt = database.prepare(`
    INSERT INTO note_embeddings (chunk_id, note_id, notebook_id, embedding)
    VALUES (?, ?, ?, ?)
  `)

  const insertMany = database.transaction(
    (
      items: Array<{
        chunkId: string
        noteId: string
        notebookId: string
        embedding: number[]
      }>
    ) => {
      for (const item of items) {
        // 先删除已存在的记录
        deleteStmt.run(item.chunkId)
        // 使用 Float32Array 传递向量数据
        const vector = new Float32Array(item.embedding)
        insertStmt.run(item.chunkId, item.noteId, item.notebookId, vector)
      }
    }
  )

  insertMany(data)
}

/**
 * 删除笔记的所有向量
 */
export function deleteNoteEmbeddings(noteId: string): void {
  const database = getDb()

  if (!embeddingsTableExists(database)) return

  database.prepare('DELETE FROM note_embeddings WHERE note_id = ?').run(noteId)
}

/**
 * 向量搜索 (使用 sqlite-vec KNN)
 *
 * 返回最相似的结果，按距离排序
 */
export function searchEmbeddings(
  queryEmbedding: number[],
  limit: number = 20,
  threshold: number = DEFAULT_L2_THRESHOLD // L2 距离阈值，越小越相似
): VectorSearchResult[] {
  const database = getDb()

  if (!embeddingsTableExists(database)) {
    return []
  }

  // 使用 Float32Array 传递查询向量
  const queryVector = new Float32Array(queryEmbedding)

  // 使用 vec0 的 MATCH 语法进行 KNN 搜索
  // 注意：sqlite-vec 需要在 WHERE 子句中使用 k = ? 约束，不能依赖外层 LIMIT
  // 当使用 JOIN 时，必须用子查询先做 KNN 搜索
  const rows = database
    .prepare(
      `
      SELECT
        e.chunk_id,
        e.note_id,
        e.notebook_id,
        e.distance,
        c.chunk_text,
        c.char_start,
        c.char_end,
        c.chunk_index
      FROM (
        SELECT chunk_id, note_id, notebook_id, distance
        FROM note_embeddings
        WHERE embedding MATCH ? AND k = ?
      ) e
      JOIN note_chunks c ON e.chunk_id = c.chunk_id
      ORDER BY e.distance
    `
    )
    .all(queryVector, limit * 2) as Array<{
      chunk_id: string
      note_id: string
      notebook_id: string
      distance: number
      chunk_text: string
      char_start: number
      char_end: number
      chunk_index: number
    }>

  // 过滤距离阈值并转换为结果格式
  const results: VectorSearchResult[] = []

  const effectiveThreshold = getScaledThreshold(threshold)

  for (const row of rows) {
    if (row.distance <= effectiveThreshold) {
      // 将 L2 距离转换为相似度分数 (0-1 范围)
      // 使用 1 / (1 + distance) 转换
      const score = 1 / (1 + row.distance)

      results.push({
        chunkId: row.chunk_id,
        noteId: row.note_id,
        notebookId: row.notebook_id,
        chunkText: row.chunk_text,
        distance: row.distance,
        score,
        charStart: row.char_start,
        charEnd: row.char_end,
        chunkIndex: row.chunk_index
      })
    }
  }

  return results.slice(0, limit)
}

/**
 * 向量搜索（支持笔记本过滤）
 */
export function searchEmbeddingsInNotebook(
  queryEmbedding: number[],
  notebookId: string,
  limit: number = 20,
  threshold: number = DEFAULT_L2_THRESHOLD
): VectorSearchResult[] {
  const database = getDb()

  if (!embeddingsTableExists(database)) {
    return []
  }

  const queryVector = new Float32Array(queryEmbedding)

  // 先做向量搜索，再过滤笔记本
  // 注意：sqlite-vec 需要在 WHERE 子句中使用 k = ? 约束
  // 使用子查询先做 KNN 搜索，再在外层过滤 notebook_id
  const rows = database
    .prepare(
      `
      SELECT
        e.chunk_id,
        e.note_id,
        e.notebook_id,
        e.distance,
        c.chunk_text,
        c.char_start,
        c.char_end,
        c.chunk_index
      FROM (
        SELECT chunk_id, note_id, notebook_id, distance
        FROM note_embeddings
        WHERE embedding MATCH ? AND k = ?
      ) e
      JOIN note_chunks c ON e.chunk_id = c.chunk_id
      ORDER BY e.distance
    `
    )
    .all(queryVector, limit * 5) as Array<{
      chunk_id: string
      note_id: string
      notebook_id: string
      distance: number
      chunk_text: string
      char_start: number
      char_end: number
      chunk_index: number
    }>

  const results: VectorSearchResult[] = []

  const effectiveThreshold = getScaledThreshold(threshold)

  for (const row of rows) {
    // 过滤笔记本和距离阈值
    if (row.notebook_id === notebookId && row.distance <= effectiveThreshold) {
      const score = 1 / (1 + row.distance)
      results.push({
        chunkId: row.chunk_id,
        noteId: row.note_id,
        notebookId: row.notebook_id,
        chunkText: row.chunk_text,
        distance: row.distance,
        score,
        charStart: row.char_start,
        charEnd: row.char_end,
        chunkIndex: row.chunk_index
      })
    }
  }

  return results.slice(0, limit)
}

// ============ 关键词搜索（混合搜索） ============

/**
 * 关键词搜索结果
 */
export interface KeywordSearchResult {
  chunkId: string
  noteId: string
  notebookId: string
  chunkText: string
  matchCount: number // 匹配次数
  charStart: number
  charEnd: number
  chunkIndex: number
}

/**
 * 关键词搜索（用于混合搜索）
 *
 * 支持中英文分词：
 * - "math公式怎么写" → 搜索 "math" OR "公式怎么写"
 * - 使用 OR 连接多个词，提高召回率
 */
export function searchKeyword(
  keyword: string,
  limit: number = 20,
  notebookId?: string
): KeywordSearchResult[] {
  const database = getDb()

  const quotedPhrases: string[] = []
  let remaining = keyword
  const quotePatterns = [
    /"([^"]+)"/g,
    /“([^”]+)”/g
  ]
  for (const pattern of quotePatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(keyword)) !== null) {
      if (match[1]) quotedPhrases.push(match[1])
    }
    remaining = remaining.replace(pattern, ' ')
  }

  // 预处理：在中英文之间插入空格
  const normalizedKeyword = normalizeCjkAscii(remaining.trim())

  if (ftsEnabled && ftsNeedsRebuild && !ftsRebuildRunning) {
    scheduleFtsRebuild()
  }

  const ftsReady = ftsEnabled && !ftsNeedsRebuild && !ftsRebuildRunning
  const tokens = ftsReady
    ? Array.from(new Set(tokenizeForSearch(normalizedKeyword))).slice(0, 12)
    : []
  const phraseTokens = ftsReady
    ? quotedPhrases
        .map((phrase) => tokenizeForSearch(normalizeCjkAscii(phrase)).join(' '))
        .filter((phrase) => phrase.length > 0)
        .slice(0, 4)
    : []

  if (ftsReady && (tokens.length > 0 || phraseTokens.length > 0)) {
    try {
      const escapedTokens = tokens.map((t) => `"${t.replace(/"/g, '""')}"`)
      const escapedPhrases = phraseTokens.map((p) => `"${p.replace(/"/g, '""')}"`)
      const ftsQuery = [...escapedPhrases, ...escapedTokens].join(' OR ')

      const params: (string | number)[] = [ftsQuery]
      let sql = `
        SELECT c.chunk_id, c.note_id, c.notebook_id, c.chunk_text,
               c.char_start, c.char_end, c.chunk_index,
               bm25(note_chunks_fts) as bm25_score
        FROM note_chunks_fts
        JOIN note_chunks c ON c.chunk_id = note_chunks_fts.chunk_id
        WHERE note_chunks_fts MATCH ?
      `

      if (notebookId) {
        sql += ' AND c.notebook_id = ?'
        params.push(notebookId)
      }

      sql += ' ORDER BY bm25_score LIMIT ?'
      params.push(limit)

      const rows = database.prepare(sql).all(...params) as Array<{
        chunk_id: string
        note_id: string
        notebook_id: string
        chunk_text: string
        char_start: number
        char_end: number
        chunk_index: number
        bm25_score: number
      }>

      const bm25Values = rows.map((row) => {
        const value = row.bm25_score ?? 0
        return Number.isFinite(value) ? value : 0
      })
      const minBm25 = bm25Values.length > 0 ? Math.min(...bm25Values) : 0

      return rows.map((row) => {
        const bm25Score = Number.isFinite(row.bm25_score) ? row.bm25_score : 0
        const adjusted = Math.max(0, bm25Score - minBm25)
        const matchCount = Math.max(1, Math.round(1000 / (1 + adjusted)))

        return {
          chunkId: row.chunk_id,
          noteId: row.note_id,
          notebookId: row.notebook_id,
          chunkText: row.chunk_text,
          matchCount,
          charStart: row.char_start,
          charEnd: row.char_end,
          chunkIndex: row.chunk_index
        }
      })
    } catch (error) {
      console.warn('[Embedding] FTS query failed, fallback to LIKE:', error)
    }
  }

  // FTS 不可用时，回退到 LIKE
  const likeSource = [normalizedKeyword, ...quotedPhrases.map((p) => normalizeCjkAscii(p))]
    .join(' ')
    .trim()
  const words = likeSource
    .split(/\s+/)
    .filter((w) => w.length >= 1)
    .slice(0, 5)

  if (words.length === 0) {
    return []
  }

  const conditions: string[] = []
  const params: (string | number)[] = []

  for (const word of words) {
    const escapedWord = word.replace(/[%_\\]/g, '\\$&')
    conditions.push("chunk_text LIKE ? ESCAPE '\\'")
    params.push(`%${escapedWord}%`)
  }

  let sql = `
    SELECT chunk_id, note_id, notebook_id, chunk_text, char_start, char_end, chunk_index
    FROM note_chunks
    WHERE (${conditions.join(' OR ')})
  `

  if (notebookId) {
    sql += ' AND notebook_id = ?'
    params.push(notebookId)
  }

  sql += ' LIMIT ?'
  params.push(limit)

  const rows = database.prepare(sql).all(...params) as Array<{
    chunk_id: string
    note_id: string
    notebook_id: string
    chunk_text: string
    char_start: number
    char_end: number
    chunk_index: number
  }>

  const regexParts = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(regexParts.join('|'), 'gi')

  const results = rows.map((row) => {
    const matches = row.chunk_text.match(regex)
    const matchCount = matches ? matches.length : 0

    return {
      chunkId: row.chunk_id,
      noteId: row.note_id,
      notebookId: row.notebook_id,
      chunkText: row.chunk_text,
      matchCount,
      charStart: row.char_start,
      charEnd: row.char_end,
      chunkIndex: row.chunk_index
    }
  })

  return results.sort((a, b) => b.matchCount - a.matchCount)
}

/**
 * 获取向量数量
 */
export function getEmbeddingCount(): number {
  const database = getDb()

  if (!embeddingsTableExists(database)) {
    return 0
  }

  const row = database.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as {
    count: number
  }
  return row.count
}

// ============ 统计信息 ============

/**
 * 获取索引统计
 */
export function getIndexStats(): {
  totalChunks: number
  totalEmbeddings: number
  indexedNotes: number
  pendingNotes: number
  errorNotes: number
} {
  const database = getDb()

  const chunkCount = database.prepare('SELECT COUNT(*) as count FROM note_chunks').get() as {
    count: number
  }

  const embeddingCount = embeddingsTableExists(database)
    ? (database.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as { count: number })
        .count
    : 0

  const indexedCount = database
    .prepare("SELECT COUNT(*) as count FROM note_index_status WHERE status = 'indexed'")
    .get() as { count: number }
  const pendingCount = database
    .prepare("SELECT COUNT(*) as count FROM note_index_status WHERE status = 'pending'")
    .get() as { count: number }
  const errorCount = database
    .prepare("SELECT COUNT(*) as count FROM note_index_status WHERE status = 'error'")
    .get() as { count: number }

  return {
    totalChunks: chunkCount.count,
    totalEmbeddings: embeddingCount,
    indexedNotes: indexedCount.count,
    pendingNotes: pendingCount.count,
    errorNotes: errorCount.count
  }
}

/**
 * 清空所有索引数据
 */
export function clearAllIndexData(): void {
  const database = getDb()

  database.exec('DELETE FROM note_chunks;')
  if (ftsEnabled) {
    database.exec('DELETE FROM note_chunks_fts;')
  }
  ftsNeedsRebuild = false
  if (embeddingsTableExists(database)) {
    database.exec('DELETE FROM note_embeddings;')
  }
  database.exec('DELETE FROM note_index_status;')

  console.log('[Embedding] All index data cleared')
}

/**
 * 获取最后更新时间
 */
export function getLastIndexedTime(): string | null {
  const database = getDb()
  const row = database
    .prepare('SELECT MAX(indexed_at) as last_time FROM note_index_status')
    .get() as { last_time: string | null }
  return row.last_time
}
