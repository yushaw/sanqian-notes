/**
 * 知识库 - 向量数据库核心模块
 *
 * 初始化、schema、FTS、配置管理、清空索引
 */

import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { app } from 'electron'
import { join } from 'path'
import { getStartupPhaseState } from '../startup-phase'

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
import type { EmbeddingConfig } from './types'
import { DEFAULT_CONFIG, EMBEDDING_MAX_DIMENSIONS } from './types'
import { encrypt, decrypt } from './encryption'
import { buildSearchTokens, warmupTokenizer } from './tokenizer'

let db: Database.Database | null = null

/**
 * FTS state shared between core and ops modules.
 * Mutable object so that both modules reference the same state.
 */
export const fts = {
  enabled: false,
  needsRebuild: false,
  rebuildRunning: false,
  rebuildDirty: false,
}

const FTS_REBUILD_BATCH_SIZE = Number.isFinite(Number(process.env.KB_FTS_REBUILD_BATCH_SIZE))
  ? Math.max(16, Math.floor(Number(process.env.KB_FTS_REBUILD_BATCH_SIZE)))
  : (process.env.NODE_ENV === 'test' ? 2000 : 512)
const FTS_REBUILD_STARTUP_ADAPTIVE_ENABLED = process.env.NODE_ENV === 'test'
  ? process.env.KB_FTS_REBUILD_STARTUP_ADAPTIVE_ENABLED === '1'
  : process.env.KB_FTS_REBUILD_STARTUP_ADAPTIVE_ENABLED !== '0'
const FTS_REBUILD_STARTUP_BATCH_SIZE = Number.isFinite(Number(process.env.KB_FTS_REBUILD_STARTUP_BATCH_SIZE))
  ? Math.max(16, Math.floor(Number(process.env.KB_FTS_REBUILD_STARTUP_BATCH_SIZE)))
  : (process.env.NODE_ENV === 'test' ? FTS_REBUILD_BATCH_SIZE : Math.min(192, FTS_REBUILD_BATCH_SIZE))
const FTS_REBUILD_DELAY_MS = Number.isFinite(Number(process.env.KB_FTS_REBUILD_DELAY_MS))
  ? Math.max(0, Math.floor(Number(process.env.KB_FTS_REBUILD_DELAY_MS)))
  : 0
const FTS_REBUILD_STARTUP_DELAY_MS = Number.isFinite(Number(process.env.KB_FTS_REBUILD_STARTUP_DELAY_MS))
  ? Math.max(0, Math.floor(Number(process.env.KB_FTS_REBUILD_STARTUP_DELAY_MS)))
  : (process.env.NODE_ENV === 'test' ? 0 : 1500)
const FTS_REBUILD_INTER_BATCH_DELAY_MS = Number.isFinite(Number(process.env.KB_FTS_REBUILD_INTER_BATCH_DELAY_MS))
  ? Math.max(0, Math.floor(Number(process.env.KB_FTS_REBUILD_INTER_BATCH_DELAY_MS)))
  : 0
const FTS_REBUILD_STARTUP_INTER_BATCH_DELAY_MS = Number.isFinite(
  Number(process.env.KB_FTS_REBUILD_STARTUP_INTER_BATCH_DELAY_MS)
)
  ? Math.max(0, Math.floor(Number(process.env.KB_FTS_REBUILD_STARTUP_INTER_BATCH_DELAY_MS)))
  : (process.env.NODE_ENV === 'test' ? 0 : 8)

function resolveFtsRebuildRunParams(): {
  batchSize: number
  delayMs: number
  interBatchDelayMs: number
} {
  let batchSize = FTS_REBUILD_BATCH_SIZE
  let delayMs = FTS_REBUILD_DELAY_MS
  let interBatchDelayMs = FTS_REBUILD_INTER_BATCH_DELAY_MS

  if (FTS_REBUILD_STARTUP_ADAPTIVE_ENABLED && getStartupPhaseState().inStartupPhase) {
    batchSize = Math.min(batchSize, FTS_REBUILD_STARTUP_BATCH_SIZE)
    delayMs = Math.max(delayMs, FTS_REBUILD_STARTUP_DELAY_MS)
    interBatchDelayMs = Math.max(interBatchDelayMs, FTS_REBUILD_STARTUP_INTER_BATCH_DELAY_MS)
  }

  return { batchSize, delayMs, interBatchDelayMs }
}

const DEFAULT_L2_THRESHOLD = 2.0
const DEFAULT_EMBEDDING_DIM = 1536
const EMBEDDING_API_TYPES = new Set<EmbeddingConfig['apiType']>([
  'openai',
  'zhipu',
  'local',
  'custom',
])
const EMBEDDING_SOURCES = new Set<EmbeddingConfig['source']>(['sanqian', 'custom'])

function isValidEmbeddingDimensionsValue(dimensions: unknown): dimensions is number {
  return (
    typeof dimensions === 'number'
    && Number.isFinite(dimensions)
    && Number.isInteger(dimensions)
    && dimensions >= 0
    && dimensions <= EMBEDDING_MAX_DIMENSIONS
  )
}

function assertValidConfiguredEmbeddingDimensions(dimensions: unknown): void {
  if (!isValidEmbeddingDimensionsValue(dimensions)) {
    throw new Error(
      `Invalid embedding dimensions: expected integer between 0 and ${EMBEDDING_MAX_DIMENSIONS}`
    )
  }
}

function normalizeStoredEmbeddingConfig(raw: unknown): EmbeddingConfig {
  const data = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {}

  const source = EMBEDDING_SOURCES.has(data.source as EmbeddingConfig['source'])
    ? (data.source as EmbeddingConfig['source'])
    : 'custom'
  const apiType = EMBEDDING_API_TYPES.has(data.apiType as EmbeddingConfig['apiType'])
    ? (data.apiType as EmbeddingConfig['apiType'])
    : 'custom'

  return {
    enabled: data.enabled === true,
    source,
    apiType,
    apiUrl: typeof data.apiUrl === 'string' ? data.apiUrl : '',
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
    modelName: typeof data.modelName === 'string' ? data.modelName : '',
    dimensions: isValidEmbeddingDimensionsValue(data.dimensions) ? data.dimensions : 0,
  }
}

export function getScaledThreshold(threshold: number): number {
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

    fts.enabled = true
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
      fts.needsRebuild = true
      console.log('[Embedding] FTS index pending rebuild (background)')
    }
  } catch (error) {
    fts.enabled = false
    console.warn('[Embedding] FTS5 unavailable, fallback to LIKE:', error)
  }
}

/**
 * 重建 FTS 索引（用于升级或损坏修复）
 */
function rebuildFtsIndex(
  database: Database.Database,
  batchSize: number,
  interBatchDelayMs: number
): void {
  if (!fts.enabled) return

  const targetTable = 'note_chunks_fts'
  const newTable = 'note_chunks_fts_new'
  const backupTable = 'note_chunks_fts_old'

  fts.rebuildDirty = false

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
      fts.rebuildRunning = false
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

        let needsRetry = fts.rebuildDirty
        if (ftsCount.count < chunkCount.count) {
          fts.needsRebuild = true
          needsRetry = true
          console.warn(
            `[Embedding] FTS rebuild incomplete: fts=${ftsCount.count}, chunks=${chunkCount.count}`
          )
        } else {
          fts.needsRebuild = false
        }

        if (needsRetry) {
          fts.needsRebuild = true
          console.log('[Embedding] FTS rebuild dirty, scheduling another pass')
        }

        fts.rebuildDirty = false
        fts.rebuildRunning = false
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
        fts.rebuildRunning = false
        fts.needsRebuild = true
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
      setTimeout(insertBatch, interBatchDelayMs)
    } catch (error) {
      fts.rebuildRunning = false
      fts.needsRebuild = true
      console.warn('[Embedding] FTS rebuild failed:', error)
    }
  }

  insertBatch()
}

/**
 * 后台触发 FTS rebuild（避免启动阻塞）
 */
export function scheduleFtsRebuild(): void {
  if (!fts.enabled || !fts.needsRebuild || fts.rebuildRunning || !db) return

  fts.rebuildRunning = true
  const database = db
  const runParams = resolveFtsRebuildRunParams()

  setTimeout(() => {
    try {
      rebuildFtsIndex(database, runParams.batchSize, runParams.interBatchDelayMs)
    } catch (error) {
      fts.rebuildRunning = false
      fts.needsRebuild = true
      console.warn('[Embedding] FTS rebuild failed:', error)
    }
  }, runParams.delayMs)
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

  // 迁移：为 note_index_status 添加 file_mtime 列（local-folder "最近" 过滤用文件实际修改时间）
  const hasFileMtime = statusColumns.some(col => col.name === 'file_mtime')
  if (!hasFileMtime) {
    console.log('[Embedding] Migrating: adding file_mtime column')
    database.exec('ALTER TABLE note_index_status ADD COLUMN file_mtime TEXT')
  }
}

/**
 * 创建向量虚拟表（如果维度变更需要重建）
 */
function createVectorTable(database: Database.Database, dimensions: number): void {
  // 维度无效时跳过创建（用户尚未配置 embedding / 配置数据损坏）
  if (!isValidEmbeddingDimensionsValue(dimensions)) {
    console.warn('[Embedding] Skipping vector table creation: dimensions are invalid')
    return
  }
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
  fts.enabled = options?.ftsEnabled ?? false
  fts.needsRebuild = options?.ftsNeedsRebuild ?? false
  fts.rebuildRunning = options?.ftsRebuildRunning ?? false
  fts.rebuildDirty = false
}

/**
 * 获取数据库实例
 */
export function getDb(): Database.Database {
  if (!db) {
    initVectorDatabase()
  }
  return db!
}

/**
 * 检查 note_embeddings 向量表是否存在
 * 用户未配置 embedding（dimensions <= 0）时表不存在
 */
export function embeddingsTableExists(database: Database.Database): boolean {
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
      const config = normalizeStoredEmbeddingConfig(JSON.parse(row.value))

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
  const oldConfig = getEmbeddingConfigInternal(database)
  assertValidConfiguredEmbeddingDimensions(config.dimensions)

  // 准备存储的配置（加密 API key，所有模式统一加密）
  const configToStore = { ...config }
  if (configToStore.apiKey) {
    configToStore.apiKey = encrypt(configToStore.apiKey)
  }

  // 检测模型变化（dimensions 或 modelName 变化）
  const isFirstSetup = oldConfig.dimensions === 0 && config.dimensions > 0
  const dimensionsChanged = oldConfig.dimensions !== config.dimensions && oldConfig.dimensions > 0
  const modelChanged =
    oldConfig.modelName !== config.modelName &&
    oldConfig.modelName !== '' && // 旧配置为空时不触发（首次设置）
    config.modelName !== '' // 新配置为空时不触发（清空配置）

  const applyConfig = database.transaction(() => {
    database
      .prepare('INSERT OR REPLACE INTO embedding_config (key, value) VALUES (?, ?)')
      .run('config', JSON.stringify(configToStore))

    // 首次配置：创建向量表（无需清空索引）
    if (isFirstSetup) {
      console.log('[Embedding] First setup, creating vector table')
      createVectorTable(database, config.dimensions)
      return { indexCleared: false, modelChanged: false }
    }

    // 如果维度变更，需要重建向量表
    if (dimensionsChanged) {
      console.log('[Embedding] Dimensions changed, recreating vector table')
      clearAllIndexDataInDatabase(database, { updateFtsState: false, emitLog: false })
      createVectorTable(database, config.dimensions)
      return { indexCleared: true, modelChanged: true }
    }

    // 如果只是模型名变化（dimensions 相同），需要 rebuild 但不用重建表
    if (modelChanged) {
      console.log(`[Embedding] Model changed from ${oldConfig.modelName} to ${config.modelName}`)
      return { indexCleared: false, modelChanged: true }
    }

    return { indexCleared: false, modelChanged: false }
  })

  const result = applyConfig()
  if (result.indexCleared) {
    fts.needsRebuild = false
    console.log('[Embedding] All index data cleared')
  }
  return result
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

/**
 * 清空所有索引数据
 */
export function clearAllIndexData(): void {
  clearAllIndexDataInDatabase(getDb())
}

function clearAllIndexDataInDatabase(
  database: Database.Database,
  options?: {
    updateFtsState?: boolean
    emitLog?: boolean
  }
): void {
  database.exec('DELETE FROM note_chunks;')
  if (fts.enabled) {
    database.exec('DELETE FROM note_chunks_fts;')
  }
  if (options?.updateFtsState !== false) {
    fts.needsRebuild = false
  }
  if (embeddingsTableExists(database)) {
    database.exec('DELETE FROM note_embeddings;')
  }
  database.exec('DELETE FROM note_index_status;')

  if (options?.emitLog !== false) {
    console.log('[Embedding] All index data cleared')
  }
}
