/**
 * 知识库 - 向量数据库操作模块
 *
 * CRUD 操作、搜索、统计
 */

import type { NoteChunk, NoteIndexStatus, VectorSearchResult } from './types'
import { normalizeCjkAscii } from './utils'
import { buildSearchTokens, tokenizeForSearch } from './tokenizer'
import { getDb, fts, embeddingsTableExists, getScaledThreshold, scheduleFtsRebuild } from './database-core'

const DEFAULT_L2_THRESHOLD = 2.0

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
  const ftsInsertStmt = fts.enabled
    ? database.prepare(
        'INSERT INTO note_chunks_fts (chunk_id, note_id, notebook_id, tokens) VALUES (?, ?, ?, ?)'
      )
    : null
  const ftsDeleteStmt = fts.enabled
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
      if (ftsInsertStmt && ftsDeleteStmt && !fts.rebuildRunning) {
        let tokens = ''
        try {
          tokens = buildSearchTokens(chunk.chunkText)
        } catch (error) {
          console.warn(`[Embedding] FTS tokenize failed for ${chunk.chunkId}:`, error)
        }
        ftsDeleteStmt.run(chunk.chunkId)
        ftsInsertStmt.run(chunk.chunkId, chunk.noteId, chunk.notebookId, tokens)
      } else if (fts.enabled && fts.rebuildRunning) {
        fts.rebuildDirty = true
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
  if (fts.enabled && !fts.rebuildRunning) {
    database.prepare('DELETE FROM note_chunks_fts WHERE note_id = ?').run(noteId)
  } else if (fts.enabled && fts.rebuildRunning) {
    fts.rebuildDirty = true
  }
}

/**
 * 更新笔记在索引中的 notebook_id（笔记移动到其他笔记本时调用）
 */
export function updateNoteNotebookId(noteId: string, newNotebookId: string): void {
  const database = getDb()
  database.prepare('UPDATE note_chunks SET notebook_id = ? WHERE note_id = ?').run(newNotebookId, noteId)
  if (fts.enabled && !fts.rebuildRunning) {
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
  if (fts.enabled && !fts.rebuildRunning) {
    database
      .prepare(`DELETE FROM note_chunks_fts WHERE chunk_id IN (${placeholders})`)
      .run(...chunkIds)
  } else if (fts.enabled && fts.rebuildRunning) {
    fts.rebuildDirty = true
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
    (note_id, content_hash, chunk_count, model_name, indexed_at, status, error_message, fts_status, embedding_status, file_mtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      status.embeddingStatus || 'none',
      status.fileMtime || null
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
      file_mtime: string | null
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
    embeddingStatus: (row.embedding_status as 'none' | 'indexed' | 'pending' | 'error') || 'none',
    fileMtime: row.file_mtime || undefined
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
    file_mtime: string | null
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
    embeddingStatus: (row.embedding_status as 'none' | 'indexed' | 'pending' | 'error') || 'none',
    fileMtime: row.file_mtime || undefined
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
 * - "math公式怎么写" -> 搜索 "math" OR "公式怎么写"
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
    /\u201c([^\u201d]+)\u201d/g
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

  if (fts.enabled && fts.needsRebuild && !fts.rebuildRunning) {
    scheduleFtsRebuild()
  }

  const ftsReady = fts.enabled && !fts.needsRebuild && !fts.rebuildRunning
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
 * 获取最后更新时间
 */
export function getLastIndexedTime(): string | null {
  const database = getDb()
  const row = database
    .prepare('SELECT MAX(indexed_at) as last_time FROM note_index_status')
    .get() as { last_time: string | null }
  return row.last_time
}
