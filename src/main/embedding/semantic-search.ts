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

// Chunk 搜索结果（内部使用）
interface ChunkResult {
  noteId: string
  notebookId: string
  chunkId: string
  chunkText: string
  score: number
}

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

  const searchLimit = limit * 3

  // 并行执行向量搜索和关键词搜索
  const [vectorPromise, keywordPromise] = await Promise.allSettled([
    // 向量搜索（如果知识库启用）
    config.enabled
      ? (async (): Promise<ChunkResult[]> => {
          const queryEmbedding = await getEmbedding(query)
          const vecResults = notebookId
            ? searchEmbeddingsInNotebook(queryEmbedding, notebookId, searchLimit, threshold)
            : searchEmbeddings(queryEmbedding, searchLimit, threshold)
          return vecResults.map((r) => ({
            noteId: r.noteId,
            notebookId: r.notebookId,
            chunkId: r.chunkId,
            chunkText: r.chunkText,
            score: r.score
          }))
        })()
      : Promise.resolve([]),
    // 关键词搜索（同步函数包装为 Promise）
    Promise.resolve().then(() => {
      const ftsResults = searchKeyword(query, searchLimit, notebookId)
      return ftsResults.map((r) => ({
        noteId: r.noteId,
        notebookId: r.notebookId,
        chunkId: r.chunkId,
        chunkText: r.chunkText,
        matchCount: r.matchCount
      }))
    })
  ])

  // 处理结果，失败时返回空数组
  const vectorResults: ChunkResult[] =
    vectorPromise.status === 'fulfilled' ? vectorPromise.value : []
  if (vectorPromise.status === 'rejected') {
    console.error('[HybridSearch] Vector search error:', vectorPromise.reason)
  }

  const keywordResults =
    keywordPromise.status === 'fulfilled' ? keywordPromise.value : []
  if (keywordPromise.status === 'rejected') {
    console.error('[HybridSearch] Keyword search error:', keywordPromise.reason)
  }

  // 如果两者都没有结果，返回空
  if (vectorResults.length === 0 && keywordResults.length === 0) {
    return []
  }

  // 如果只有一种结果，直接使用
  if (vectorResults.length === 0) {
    const mapped = keywordResults.map((r, index) => ({
      noteId: r.noteId,
      notebookId: r.notebookId,
      chunkId: r.chunkId,
      chunkText: r.chunkText,
      score: 1 / (RRF_K + index + 1)
    }))
    return aggregateByNote(mapped, limit)
  }
  if (keywordResults.length === 0) {
    return aggregateByNote(vectorResults, limit)
  }

  // RRF 融合
  const chunkScores = new Map<string, number>()
  const chunkData = new Map<string, Omit<ChunkResult, 'score'>>()

  // 向量搜索贡献（已按 score 降序排列）
  vectorResults.forEach((result, index) => {
    const rank = index + 1
    const rrfScore = 1 / (RRF_K + rank)
    chunkScores.set(result.chunkId, (chunkScores.get(result.chunkId) || 0) + rrfScore)
    if (!chunkData.has(result.chunkId)) {
      chunkData.set(result.chunkId, result)
    }
  })

  // 关键词搜索贡献（按 matchCount 降序排列）
  const sortedKeywordResults = [...keywordResults].sort((a, b) => b.matchCount - a.matchCount)
  sortedKeywordResults.forEach((result, index) => {
    const rank = index + 1
    const rrfScore = 1 / (RRF_K + rank)
    chunkScores.set(result.chunkId, (chunkScores.get(result.chunkId) || 0) + rrfScore)
    if (!chunkData.has(result.chunkId)) {
      chunkData.set(result.chunkId, result)
    }
  })

  // 按 RRF 分数排序并转换为结果格式
  const sortedChunks: ChunkResult[] = Array.from(chunkScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([chunkId, score]) => {
      const data = chunkData.get(chunkId)!
      return { ...data, score }
    })

  console.log(
    `[HybridSearch] RRF fusion: vector=${vectorResults.length}, keyword=${keywordResults.length}, merged=${sortedChunks.length}`
  )

  return aggregateByNote(sortedChunks, limit)
}

/**
 * 按笔记聚合 chunk 结果
 *
 * 使用累加策略：匹配多个 chunk 的笔记获得更高分数
 * 这样一个笔记有 3 个 chunk 都匹配会比只有 1 个 chunk 匹配的笔记排名更高
 */
function aggregateByNote(chunks: ChunkResult[], limit: number): SemanticSearchResult[] {
  const noteMap = new Map<string, SemanticSearchResult>()

  for (const chunk of chunks) {
    const existing = noteMap.get(chunk.noteId)

    if (existing) {
      existing.matchedChunks.push({
        chunkId: chunk.chunkId,
        chunkText: chunk.chunkText,
        score: chunk.score
      })
      // 累加分数：匹配更多 chunk 的笔记排名更高
      existing.score += chunk.score
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
