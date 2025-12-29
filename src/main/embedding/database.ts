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
import type { EmbeddingConfig, NoteChunk, NoteIndexStatus, VectorSearchResult } from './types'
import { DEFAULT_CONFIG } from './types'
import { normalizeCjkAscii } from './utils'

let db: Database.Database | null = null

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

  // 加载 sqlite-vec 扩展
  sqliteVec.load(db)

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
    CREATE TABLE IF NOT EXISTS note_chunks (
      chunk_id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      notebook_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      char_start INTEGER,
      char_end INTEGER,
      heading TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(note_id, chunk_index)
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

  // 获取当前配置的维度来创建向量表
  const config = getEmbeddingConfigInternal(db)
  createVectorTable(db, config.dimensions)

  console.log('[Embedding] Vector database initialized:', dbPath)
}

/**
 * 创建向量虚拟表（如果维度变更需要重建）
 */
function createVectorTable(database: Database.Database, dimensions: number): void {
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
 * 获取数据库实例
 */
function getDb(): Database.Database {
  if (!db) {
    initVectorDatabase()
  }
  return db!
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
      return JSON.parse(row.value)
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
 */
export function setEmbeddingConfig(config: EmbeddingConfig): { indexCleared: boolean } {
  const database = getDb()
  const oldConfig = getEmbeddingConfig()

  database
    .prepare('INSERT OR REPLACE INTO embedding_config (key, value) VALUES (?, ?)')
    .run('config', JSON.stringify(config))

  // 如果维度变更，需要重建向量表
  if (oldConfig.dimensions !== config.dimensions) {
    console.log('[Embedding] Dimensions changed, recreating vector table')
    // 清空旧索引数据
    clearAllIndexData()
    // 重建向量表
    createVectorTable(database, config.dimensions)
    return { indexCleared: true }
  }

  return { indexCleared: false }
}

// ============ 笔记块管理 ============

/**
 * 插入笔记块
 */
export function insertNoteChunks(chunks: NoteChunk[]): void {
  const database = getDb()
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO note_chunks
    (chunk_id, note_id, notebook_id, chunk_index, chunk_text, char_start, char_end, heading, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertMany = database.transaction((items: NoteChunk[]) => {
    for (const chunk of items) {
      stmt.run(
        chunk.chunkId,
        chunk.noteId,
        chunk.notebookId,
        chunk.chunkIndex,
        chunk.chunkText,
        chunk.charStart,
        chunk.charEnd,
        chunk.heading,
        chunk.createdAt
      )
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
    charStart: row.char_start,
    charEnd: row.char_end,
    heading: row.heading,
    createdAt: row.created_at
  }))
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
    (note_id, content_hash, chunk_count, model_name, indexed_at, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      status.noteId,
      status.contentHash,
      status.chunkCount,
      status.modelName,
      status.indexedAt,
      status.status,
      status.errorMessage || null
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
    errorMessage: row.error_message || undefined
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
  }>

  return rows.map((row) => ({
    noteId: row.note_id,
    contentHash: row.content_hash,
    chunkCount: row.chunk_count,
    modelName: row.model_name,
    indexedAt: row.indexed_at,
    status: row.status as 'indexed' | 'pending' | 'error',
    errorMessage: row.error_message || undefined
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
  const database = getDb()
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
  threshold: number = 2.0 // L2 距离阈值，越小越相似
): VectorSearchResult[] {
  const database = getDb()

  // 使用 Float32Array 传递查询向量
  const queryVector = new Float32Array(queryEmbedding)

  // 使用 vec0 的 MATCH 语法进行 KNN 搜索
  // 注意：sqlite-vec 不使用 k 参数，用 LIMIT 控制返回数量
  const rows = database
    .prepare(
      `
      SELECT
        e.chunk_id,
        e.note_id,
        e.notebook_id,
        e.distance,
        c.chunk_text
      FROM note_embeddings e
      JOIN note_chunks c ON e.chunk_id = c.chunk_id
      WHERE e.embedding MATCH ?
      ORDER BY e.distance
      LIMIT ?
    `
    )
    .all(queryVector, limit * 2) as Array<{
    chunk_id: string
    note_id: string
    notebook_id: string
    distance: number
    chunk_text: string
  }>

  // 过滤距离阈值并转换为结果格式
  const results: VectorSearchResult[] = []

  for (const row of rows) {
    if (row.distance <= threshold) {
      // 将 L2 距离转换为相似度分数 (0-1 范围)
      // 使用 1 / (1 + distance) 转换
      const score = 1 / (1 + row.distance)

      results.push({
        chunkId: row.chunk_id,
        noteId: row.note_id,
        notebookId: row.notebook_id,
        chunkText: row.chunk_text,
        distance: row.distance,
        score
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
  threshold: number = 2.0
): VectorSearchResult[] {
  const database = getDb()
  const queryVector = new Float32Array(queryEmbedding)

  // 先做向量搜索，再过滤笔记本
  // 注意：sqlite-vec 的 WHERE 子句限制，需要在外层过滤
  const rows = database
    .prepare(
      `
      SELECT
        e.chunk_id,
        e.note_id,
        e.notebook_id,
        e.distance,
        c.chunk_text
      FROM note_embeddings e
      JOIN note_chunks c ON e.chunk_id = c.chunk_id
      WHERE e.embedding MATCH ?
      ORDER BY e.distance
      LIMIT ?
    `
    )
    .all(queryVector, limit * 5) as Array<{
    chunk_id: string
    note_id: string
    notebook_id: string
    distance: number
    chunk_text: string
  }>

  const results: VectorSearchResult[] = []

  for (const row of rows) {
    // 过滤笔记本和距离阈值
    if (row.notebook_id === notebookId && row.distance <= threshold) {
      const score = 1 / (1 + row.distance)
      results.push({
        chunkId: row.chunk_id,
        noteId: row.note_id,
        notebookId: row.notebook_id,
        chunkText: row.chunk_text,
        distance: row.distance,
        score
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

  // 预处理：在中英文之间插入空格
  const normalizedKeyword = normalizeCjkAscii(keyword.trim())

  // 按空格分割成多个词（过滤空字符串和过短的词）
  const words = normalizedKeyword
    .split(/\s+/)
    .filter((w) => w.length >= 1)
    .slice(0, 5) // 最多 5 个词

  if (words.length === 0) {
    return []
  }

  // 构建 OR 查询
  const conditions: string[] = []
  const params: (string | number)[] = []

  for (const word of words) {
    // 转义 LIKE 特殊字符
    const escapedWord = word.replace(/[%_\\]/g, '\\$&')
    conditions.push("chunk_text LIKE ? ESCAPE '\\\\'")
    params.push(`%${escapedWord}%`)
  }

  let sql = `
    SELECT chunk_id, note_id, notebook_id, chunk_text
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
  }>

  // 构建匹配正则（所有词 OR）
  const regexParts = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(regexParts.join('|'), 'gi')

  const results = rows.map((row) => {
    // 计算所有词的总匹配次数
    const matches = row.chunk_text.match(regex)
    const matchCount = matches ? matches.length : 0

    return {
      chunkId: row.chunk_id,
      noteId: row.note_id,
      notebookId: row.notebook_id,
      chunkText: row.chunk_text,
      matchCount
    }
  })

  // 按匹配次数降序排序
  return results.sort((a, b) => b.matchCount - a.matchCount)
}

/**
 * 获取向量数量
 */
export function getEmbeddingCount(): number {
  const database = getDb()
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
  const embeddingCount = database.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as {
    count: number
  }
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
    totalEmbeddings: embeddingCount.count,
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
  database.exec(`
    DELETE FROM note_chunks;
    DELETE FROM note_embeddings;
    DELETE FROM note_index_status;
  `)
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
