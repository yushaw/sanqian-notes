/**
 * 语义搜索模块
 *
 * 将查询文本转换为向量，搜索相似内容，返回笔记列表
 */

import { getEmbedding } from './api'
import { getEmbeddingConfig, searchEmbeddings, searchEmbeddingsInNotebook } from './database'

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
