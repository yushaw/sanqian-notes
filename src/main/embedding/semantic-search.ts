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

// 单源搜索时的最低分数要求（防止返回不相关结果）
// 当只有一个搜索源返回结果时，要求该源的最高分数 >= 此阈值
// 0.35: 平衡召回和精度，避免误杀边界情况（如 bidirectional links 0.369）
const SINGLE_SOURCE_MIN_SCORE = 0.35

// AutoCut 跳跃比例阈值
const AUTOCUT_JUMP_RATIO = 2.0

/**
 * 检测分数跳跃点，返回截断位置（AutoCut 风格）
 *
 * 灵感来源于 Weaviate AutoCut 功能，通过检测分数曲线中的
 * 不连续性（跳跃点）来自动识别"相关"和"不相关"的分界线。
 *
 * 参考:
 * - https://weaviate.io/learn/knowledgecards/autocut
 * - https://github.com/weaviate/weaviate/issues/2318 (Kneed 算法)
 *
 * @param scores - 分数列表，按降序排列（最高分在前）
 * @param jumpRatio - 跳跃比例阈值，当 scores[i-1] / scores[i] > ratio 时认为是跳跃
 * @returns 截断位置索引（应保留 scores.slice(0, cutoff)）
 */
function detectScoreJump(scores: number[], jumpRatio: number = AUTOCUT_JUMP_RATIO): number {
  if (scores.length <= 1) {
    return scores.length
  }

  for (let i = 1; i < scores.length; i++) {
    const prevScore = scores[i - 1]
    const currScore = scores[i]

    // 防止除零
    if (currScore <= 0) {
      return i
    }

    const ratio = prevScore / currScore
    if (ratio > jumpRatio) {
      console.log(
        `[AutoCut] detected jump at position ${i}, ratio ${ratio.toFixed(2)} > ${jumpRatio} ` +
          `(scores: ${prevScore.toFixed(3)} -> ${currScore.toFixed(3)})`
      )
      return i
    }
  }

  return scores.length
}

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

    // 3. 转换为 ChunkResult 格式并聚合
    const chunks: ChunkResult[] = searchResults.map((r) => ({
      noteId: r.noteId,
      notebookId: r.notebookId,
      chunkId: r.chunkId,
      chunkText: r.chunkText,
      score: r.score
    }))

    return aggregateByNote(chunks, limit)
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

  // 如果只有一种结果，进行单源质量检查后返回
  if (vectorResults.length === 0) {
    // 关键词搜索没有原始分数，使用 RRF 分数
    const mapped = keywordResults.map((r, index) => ({
      noteId: r.noteId,
      notebookId: r.notebookId,
      chunkId: r.chunkId,
      chunkText: r.chunkText,
      score: 1 / (RRF_K + index + 1)
    }))
    const results = aggregateByNote(mapped, limit)
    return applyAutoCut(results)
  }
  if (keywordResults.length === 0) {
    // 单源质量检查：向量搜索最高分必须达到阈值
    // 防止只有向量搜索返回语义上"最接近"但实际不相关的结果
    const topScore = vectorResults[0]?.score ?? 0
    if (topScore < SINGLE_SOURCE_MIN_SCORE) {
      console.log(
        `[HybridSearch] Single-source (vector) top score ${topScore.toFixed(3)} < threshold ${SINGLE_SOURCE_MIN_SCORE}, returning empty`
      )
      return []
    }
    const results = aggregateByNote(vectorResults, limit)
    return applyAutoCut(results)
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

  // 关键词搜索贡献（searchKeyword 已按 matchCount 降序排列）
  keywordResults.forEach((result, index) => {
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

  const aggregated = aggregateByNote(sortedChunks, limit)

  // 应用 AutoCut：检测分数跳跃，自动截断不相关结果
  const results = applyAutoCut(aggregated)

  console.log(
    `[HybridSearch] RRF fusion: vector=${vectorResults.length}, keyword=${keywordResults.length}, chunks=${sortedChunks.length}, notes=${results.length}`
  )

  return results
}

/**
 * 应用 AutoCut 截断不相关结果
 */
function applyAutoCut(results: SemanticSearchResult[]): SemanticSearchResult[] {
  if (results.length <= 1) {
    return results
  }

  const scores = results.map((r) => r.score)
  const cutoff = detectScoreJump(scores)

  if (cutoff < results.length) {
    console.log(`[AutoCut] truncating results from ${results.length} to ${cutoff}`)
    return results.slice(0, cutoff)
  }

  return results
}

// 聚合时最多累加的 chunk 数量（防止长文档获得过大优势）
const MAX_CHUNKS_FOR_SCORING = 3

/**
 * 按笔记聚合 chunk 结果
 *
 * 使用 Capped Sum 策略：
 * - 累加多个 chunk 的分数，但最多只计入前 N 个最高分的 chunk
 * - 这样多个匹配仍有加成，但长文档不会获得过大优势
 * - 参考业界做法：GraphRAG Parent-Child Retriever 使用 max 或 average
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
    } else {
      noteMap.set(chunk.noteId, {
        noteId: chunk.noteId,
        notebookId: chunk.notebookId,
        score: 0, // 稍后计算
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

  // 计算最终分数：Capped Sum - 只累加前 N 个最高分的 chunk
  for (const result of noteMap.values()) {
    const topScores = result.matchedChunks
      .map((c) => c.score)
      .sort((a, b) => b - a)
      .slice(0, MAX_CHUNKS_FOR_SCORING)
    result.score = topScores.reduce((sum, s) => sum + s, 0)
  }

  return Array.from(noteMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
