/**
 * 语义搜索模块
 *
 * 支持：
 * - 纯语义搜索（向量相似度）
 * - 混合搜索（向量 + 关键词，使用 RRF 融合）
 */

import { getEmbedding } from './api'
import {
  getEmbeddingConfig,
  searchEmbeddings,
  searchEmbeddingsInNotebook,
  searchKeyword
} from './database'

// RRF 常数，通常使用 60
const RRF_K = 60

// 语义搜索结果
export interface SemanticSearchResult {
  noteId: string
  notebookId: string
  score: number // 相似度分数 (0-1)
  matchedChunks: Array<{
    chunkId: string
    chunkText: string
    score: number
  }>
}

/**
 * 语义搜索
 *
 * @param query - 搜索查询文本
 * @param options - 搜索选项
 * @returns 按相似度排序的笔记列表
 */
export async function semanticSearch(
  query: string,
  options: {
    limit?: number
    notebookId?: string
    threshold?: number
  } = {}
): Promise<SemanticSearchResult[]> {
  const { limit = 10, notebookId, threshold = 2.0 } = options

  const config = getEmbeddingConfig()
  if (!config.enabled) {
    return []
  }

  if (!query.trim()) {
    return []
  }

  try {
    // 1. 获取查询文本的 embedding
    const queryEmbedding = await getEmbedding(query)

    // 2. 向量搜索
    const searchResults = notebookId
      ? searchEmbeddingsInNotebook(queryEmbedding, notebookId, limit * 3, threshold)
      : searchEmbeddings(queryEmbedding, limit * 3, threshold)

    if (searchResults.length === 0) {
      return []
    }

    // 3. 按笔记聚合结果
    const noteMap = new Map<string, SemanticSearchResult>()

    for (const result of searchResults) {
      const existing = noteMap.get(result.noteId)

      if (existing) {
        // 添加匹配的 chunk
        existing.matchedChunks.push({
          chunkId: result.chunkId,
          chunkText: result.chunkText,
          score: result.score
        })
        // 更新分数为最高分
        if (result.score > existing.score) {
          existing.score = result.score
        }
      } else {
        noteMap.set(result.noteId, {
          noteId: result.noteId,
          notebookId: result.notebookId,
          score: result.score,
          matchedChunks: [
            {
              chunkId: result.chunkId,
              chunkText: result.chunkText,
              score: result.score
            }
          ]
        })
      }
    }

    // 4. 按分数排序并限制数量
    const results = Array.from(noteMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return results
  } catch (error) {
    console.error('[SemanticSearch] Error:', error)
    return []
  }
}

/**
 * 混合搜索 - 使用 RRF (Reciprocal Rank Fusion) 融合向量搜索和关键词搜索
 *
 * RRF 公式: score(d) = Σ 1/(k + rank_i(d))
 * 其中 k 通常为 60，rank_i(d) 是文档在第 i 个排序列表中的排名
 *
 * @param query - 搜索查询文本
 * @param options - 搜索选项
 * @returns 按 RRF 分数排序的笔记列表
 */
export async function hybridSearch(
  query: string,
  options: {
    limit?: number
    notebookId?: string
    threshold?: number
  } = {}
): Promise<SemanticSearchResult[]> {
  const { limit = 10, notebookId, threshold = 2.0 } = options

  const config = getEmbeddingConfig()
  if (!query.trim()) {
    return []
  }

  // 并行执行向量搜索和关键词搜索
  const searchLimit = limit * 3

  // 1. 向量搜索（如果知识库启用）
  let vectorResults: Array<{ noteId: string; notebookId: string; chunkId: string; chunkText: string; score: number }> = []
  if (config.enabled) {
    try {
      const queryEmbedding = await getEmbedding(query)
      const vecResults = notebookId
        ? searchEmbeddingsInNotebook(queryEmbedding, notebookId, searchLimit, threshold)
        : searchEmbeddings(queryEmbedding, searchLimit, threshold)

      vectorResults = vecResults.map((r) => ({
        noteId: r.noteId,
        notebookId: r.notebookId,
        chunkId: r.chunkId,
        chunkText: r.chunkText,
        score: r.score
      }))
    } catch (error) {
      console.error('[HybridSearch] Vector search error:', error)
    }
  }

  // 2. 关键词搜索（FTS）
  let keywordResults: Array<{ noteId: string; notebookId: string; chunkId: string; chunkText: string; matchCount: number }> = []
  try {
    const ftsResults = searchKeyword(query, searchLimit, notebookId)
    keywordResults = ftsResults.map((r) => ({
      noteId: r.noteId,
      notebookId: r.notebookId,
      chunkId: r.chunkId,
      chunkText: r.chunkText,
      matchCount: r.matchCount
    }))
  } catch (error) {
    console.error('[HybridSearch] Keyword search error:', error)
  }

  // 如果两者都没有结果，返回空
  if (vectorResults.length === 0 && keywordResults.length === 0) {
    return []
  }

  // 如果只有一种结果，直接使用
  if (vectorResults.length === 0) {
    return aggregateByNote(keywordResults.map((r) => ({ ...r, score: 1 / (RRF_K + 1) })), limit)
  }
  if (keywordResults.length === 0) {
    return aggregateByNote(vectorResults, limit)
  }

  // 3. RRF 融合
  const chunkScores = new Map<string, number>()
  const chunkData = new Map<string, { noteId: string; notebookId: string; chunkId: string; chunkText: string }>()

  // 向量搜索贡献（按 score 降序排列）
  vectorResults.forEach((result, index) => {
    const rank = index + 1
    const rrfScore = 1 / (RRF_K + rank)
    chunkScores.set(result.chunkId, (chunkScores.get(result.chunkId) || 0) + rrfScore)
    if (!chunkData.has(result.chunkId)) {
      chunkData.set(result.chunkId, result)
    }
  })

  // 关键词搜索贡献（按 matchCount 降序排列）
  keywordResults
    .sort((a, b) => b.matchCount - a.matchCount)
    .forEach((result, index) => {
      const rank = index + 1
      const rrfScore = 1 / (RRF_K + rank)
      chunkScores.set(result.chunkId, (chunkScores.get(result.chunkId) || 0) + rrfScore)
      if (!chunkData.has(result.chunkId)) {
        chunkData.set(result.chunkId, result)
      }
    })

  // 4. 按 RRF 分数排序并转换为结果格式
  const sortedChunks = Array.from(chunkScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([chunkId, score]) => {
      const data = chunkData.get(chunkId)!
      return {
        noteId: data.noteId,
        notebookId: data.notebookId,
        chunkId: data.chunkId,
        chunkText: data.chunkText,
        score
      }
    })

  console.log(
    `[HybridSearch] RRF fusion: vector=${vectorResults.length}, keyword=${keywordResults.length}, merged=${sortedChunks.length}`
  )

  return aggregateByNote(sortedChunks, limit)
}

/**
 * 按笔记聚合 chunk 结果
 */
function aggregateByNote(
  chunks: Array<{ noteId: string; notebookId: string; chunkId: string; chunkText: string; score: number }>,
  limit: number
): SemanticSearchResult[] {
  const noteMap = new Map<string, SemanticSearchResult>()

  for (const chunk of chunks) {
    const existing = noteMap.get(chunk.noteId)

    if (existing) {
      existing.matchedChunks.push({
        chunkId: chunk.chunkId,
        chunkText: chunk.chunkText,
        score: chunk.score
      })
      // 使用最高分
      if (chunk.score > existing.score) {
        existing.score = chunk.score
      }
    } else {
      noteMap.set(chunk.noteId, {
        noteId: chunk.noteId,
        notebookId: chunk.notebookId,
        score: chunk.score,
        matchedChunks: [
          {
            chunkId: chunk.chunkId,
            chunkText: chunk.chunkText,
            score: chunk.score
          }
        ]
      })
    }
  }

  return Array.from(noteMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
