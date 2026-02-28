/**
 * 语义搜索模块
 *
 * 支持：
 * - 纯语义搜索（向量相似度）
 * - 混合搜索（向量 + 关键词，使用 RRF 融合）
 * - Query Expansion（查询扩展）
 */

import { getEmbedding } from './api'
import {
  getEmbeddingConfig,
  getNoteIndexStatus,
  searchEmbeddings,
  searchEmbeddingsInNotebook,
  searchKeyword
} from './database'
import { tokenizeForSearch } from './tokenizer'
import { getLocalNoteIdentityByUid, getLocalNoteMetadata, getNotesByIds } from '../database'
import { parseLocalResourceId } from '../../shared/local-resource-id'
import { resolveLocalNoteRef } from '../note-gateway'
import { RECENT_DAYS, type NoteSearchFilter, type Note } from '../../shared/types'

// RRF 常数，通常使用 60
const RRF_K = 60

// ============================================
// Query Expansion (查询扩展)
// 参考 WeKnora: https://github.com/Tencent/WeKnora
// ============================================

// 中文疑问词列表（按长度降序排列，优先匹配长短语）
const QUESTION_WORDS_CN = [
  '是不是',
  '有没有',
  '什么是',
  '什么叫',
  '想知道',
  '请问',
  '请教',
  '想问',
  '为什么',
  '为何',
  '怎么样',
  '怎么',
  '如何',
  '什么',
  '哪个',
  '哪些',
  '哪里',
  '何时',
  '多少',
  '是否',
  '能否',
  '可以吗',
  '可否'
]

// 英文疑问词列表（按长度降序排列）
const QUESTION_WORDS_EN = [
  'what is',
  'what are',
  'how to',
  'how do',
  'how does',
  'why is',
  'why are',
  'can you',
  'could you',
  'would you',
  'tell me',
  "what's",
  "how's",
  "where's",
  "who's",
  'explain',
  'describe',
  'please',
  'what',
  'how',
  'why',
  'where',
  'when',
  'which',
  'who',
  'whom',
  'whose',
  'is'
]

// 无意义词（可在必要时移除）
const STOPWORDS_CN = ['的', '了', '吗', '呢', '啊', '吧', '呀', '么', '嘛', '是', '有', '在', '和', '与']

export interface ExpandedQuery {
  original: string
  cleaned: string // 移除疑问词后的查询
  keywords: string[] // 提取的关键词
  quotedPhrases: string[] // 引号内的精确匹配短语
}

/**
 * 扩展查询 - 提取关键信息，移除疑问词
 *
 * 策略：
 * 1. 提取引号内的精确匹配短语
 * 2. 移除中英文疑问词
 * 3. 移除常见无意义词
 * 4. 保留核心关键词
 */
export function expandQuery(query: string): ExpandedQuery {
  const original = query.trim()

  // 1. 提取引号内的短语（支持中英文引号）
  // 使用 Set 去重，避免不同引号模式匹配到相同内容
  const quotedPhrasesSet = new Set<string>()
  // 合并所有引号模式到一个正则，避免重复匹配
  // 支持: "...", '...', "...", '...'
  const quotePattern = /"([^"]+)"|'([^']+)'|"([^""]+)"|'([^'']+)'/g

  let textWithoutQuotes = original
  let match
  while ((match = quotePattern.exec(original)) !== null) {
    // 取第一个非空的捕获组
    const phrase = (match[1] || match[2] || match[3] || match[4] || '').trim()
    if (phrase) {
      quotedPhrasesSet.add(phrase)
    }
  }
  textWithoutQuotes = textWithoutQuotes.replace(quotePattern, ' ')
  const quotedPhrases = Array.from(quotedPhrasesSet)

  // 2. 移除疑问词
  let cleaned = textWithoutQuotes
  for (const word of QUESTION_WORDS_CN) {
    cleaned = cleaned.replace(new RegExp(word, 'gi'), ' ')
  }
  for (const word of QUESTION_WORDS_EN) {
    cleaned = cleaned.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ')
  }

  // 3. 移除句尾标点和无意义词
  cleaned = cleaned.replace(/[？?。.！!，,：:；;]/g, ' ')
  for (const word of STOPWORDS_CN) {
    // 只移除单独出现的无意义词，保留词组中的
    cleaned = cleaned.replace(new RegExp(`^${word}|${word}$|\\s${word}\\s`, 'g'), ' ')
  }

  // 4. 清理多余空格
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  // 5. 提取关键词（简单分词：按空格和常见分隔符）
  const keywords = cleaned
    .split(/[\s,，、;；:：]+/)
    .filter((k) => k.length >= 2) // 至少 2 个字符
    .filter((k) => !STOPWORDS_CN.includes(k))

  // 如果清理后为空，使用原始查询
  if (!cleaned) {
    cleaned = original
  }

  return {
    original,
    cleaned,
    keywords,
    quotedPhrases
  }
}

// 单源搜索时的最低分数要求（防止返回不相关结果）
// 当只有一个搜索源返回结果时，要求该源的最高分数 >= 此阈值
// 0.35: 平衡召回和精度，避免误杀边界情况（如 bidirectional links 0.369）
const SINGLE_SOURCE_MIN_SCORE = 0.35

// ============================================
// Query Rewrite (查询重写)
// 参考 WeKnora: https://github.com/Tencent/WeKnora
// ============================================

// 对话消息类型
export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

// Query Rewrite 配置
export interface QueryRewriteConfig {
  enabled: boolean
  // 重写函数，由外部（SDK）提供
  // 输入：原始查询 + 对话历史
  // 输出：重写后的查询
  rewriteFn?: (query: string, history: ConversationMessage[]) => Promise<string>
}

// 默认配置
let queryRewriteConfig: QueryRewriteConfig = {
  enabled: false
}

/**
 * 配置 Query Rewrite
 * 由 SDK 调用，注入重写函数
 */
export function configureQueryRewrite(config: QueryRewriteConfig): void {
  queryRewriteConfig = config
  console.log(`[QueryRewrite] configured: enabled=${config.enabled}`)
}

/**
 * 重写查询
 * 使用对话历史来理解用户意图，生成更好的搜索查询
 *
 * @param query - 原始查询
 * @param history - 对话历史（可选）
 * @returns 重写后的查询（如果失败则返回原始查询）
 */
export async function rewriteQuery(
  query: string,
  history: ConversationMessage[] = []
): Promise<string> {
  // 如果未启用或没有重写函数，返回原始查询
  if (!queryRewriteConfig.enabled || !queryRewriteConfig.rewriteFn) {
    return query
  }

  // 如果没有历史，不需要重写
  if (history.length === 0) {
    return query
  }

  try {
    const rewritten = await queryRewriteConfig.rewriteFn(query, history)
    if (rewritten && rewritten !== query) {
      console.log(`[QueryRewrite] "${query}" -> "${rewritten}"`)
      return rewritten
    }
    return query
  } catch (error) {
    console.error('[QueryRewrite] Error:', error)
    return query
  }
}

// ============================================
// Rerank + MMR (重排序 + 多样性)
// 参考 WeKnora: https://github.com/Tencent/WeKnora
// ============================================

// Rerank 配置
export interface RerankConfig {
  enabled: boolean
  // 重排序函数，由外部（SDK）提供
  // 输入：查询 + 文档列表
  // 输出：重排序后的文档（带新分数）
  rerankFn?: (
    query: string,
    documents: Array<{ id: string; text: string; score: number }>
  ) => Promise<Array<{ id: string; score: number }>>
}

// 默认配置
let rerankConfig: RerankConfig = {
  enabled: false
}

/**
 * 配置 Rerank
 * 由 SDK 调用，注入重排序函数
 */
export function configureRerank(config: RerankConfig): void {
  rerankConfig = config
  console.log(`[Rerank] configured: enabled=${config.enabled}`)
}

/**
 * MMR (Maximal Marginal Relevance) 重排序
 * 在保持相关性的同时增加结果多样性
 *
 * @param results - 搜索结果
 * @param lambda - 相关性权重 (0-1)，越大越重视相关性，越小越重视多样性
 * @param topK - 返回数量
 */
export function applyMMR(
  results: SemanticSearchResult[],
  lambda: number = 0.7,
  topK: number = 10
): SemanticSearchResult[] {
  if (results.length <= 1) return results

  const selected: SemanticSearchResult[] = []
  const remaining = [...results]

  // 选择第一个（最高相关性）
  remaining.sort((a, b) => b.score - a.score)
  selected.push(remaining.shift()!)

  // 迭代选择
  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0
    let bestMMR = -Infinity

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]

      // 计算与已选择结果的最大相似度（使用 Jaccard）
      const maxSim = Math.max(
        ...selected.map((s) => jaccardSimilarity(getChunksText(candidate), getChunksText(s)))
      )

      // MMR = λ * relevance - (1-λ) * redundancy
      const mmr = lambda * candidate.score - (1 - lambda) * maxSim

      if (mmr > bestMMR) {
        bestMMR = mmr
        bestIdx = i
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0])
  }

  console.log(`[MMR] selected ${selected.length} diverse results from ${results.length} candidates`)

  return selected
}

/**
 * 计算两个文本的 Jaccard 相似度
 */
function jaccardSimilarity(text1: string, text2: string): number {
  const tokens1 = new Set(tokenize(text1))
  const tokens2 = new Set(tokenize(text2))

  const intersection = new Set([...tokens1].filter((t) => tokens2.has(t)))
  const union = new Set([...tokens1, ...tokens2])

  return union.size > 0 ? intersection.size / union.size : 0
}

/**
 * 简单分词（支持中英文）
 */
function tokenize(text: string): string[] {
  // Reuse search tokenizer for consistent CJK/ASCII behavior.
  return tokenizeForSearch(text)
}

/**
 * 获取结果的所有 chunk 文本
 */
function getChunksText(result: SemanticSearchResult): string {
  return result.matchedChunks.map((c) => c.chunkText).join(' ')
}

/**
 * 应用 Rerank（如果配置）
 * 使用外部重排序模型对结果进行重排序
 */
export async function applyRerank(
  query: string,
  results: SemanticSearchResult[]
): Promise<SemanticSearchResult[]> {
  // 如果未启用或没有重排序函数，返回原始结果
  if (!rerankConfig.enabled || !rerankConfig.rerankFn || results.length === 0) {
    return results
  }

  try {
    // 准备文档列表（每个 note 的第一个 chunk 作为代表）
    const documents = results.map((r) => ({
      id: r.noteId,
      text: r.matchedChunks[0]?.chunkText || '',
      score: r.score
    }))

    // 调用外部重排序函数
    const reranked = await rerankConfig.rerankFn(query, documents)

    // 创建 noteId -> new score 的映射
    const scoreMap = new Map(reranked.map((r) => [r.id, r.score]))

    // 更新结果分数并重新排序
    const updatedResults = results
      .map((r) => ({
        ...r,
        score: scoreMap.get(r.noteId) ?? r.score
      }))
      .sort((a, b) => b.score - a.score)

    console.log(`[Rerank] reranked ${results.length} results`)

    return updatedResults
  } catch (error) {
    console.error('[Rerank] Error:', error)
    return results
  }
}

// ============================================
// Chunk Merge (合并重叠 chunks)
// 参考 WeKnora: https://github.com/Tencent/WeKnora
// ============================================

// 合并时允许的最大间隙（字符数）
const MERGE_GAP_THRESHOLD = 100

interface MergeableChunk {
  chunkId: string
  noteId: string
  notebookId: string
  chunkText: string
  score: number
  charStart: number
  charEnd: number
  chunkIndex: number
}

/**
 * 合并重叠或相邻的 chunks
 *
 * 策略：
 * 1. 按 noteId 分组
 * 2. 在每个 note 内按 charStart 排序
 * 3. 合并重叠或间隙小于阈值的 chunks
 * 4. 合并后的 score 取最高分
 */
export function mergeOverlappingChunks(chunks: MergeableChunk[]): MergeableChunk[] {
  if (chunks.length <= 1) return chunks

  // 按 noteId 分组
  const byNote = new Map<string, MergeableChunk[]>()
  for (const chunk of chunks) {
    const list = byNote.get(chunk.noteId) || []
    list.push(chunk)
    byNote.set(chunk.noteId, list)
  }

  const merged: MergeableChunk[] = []

  for (const noteChunks of byNote.values()) {
    if (noteChunks.length === 1) {
      merged.push(noteChunks[0])
      continue
    }

    // 按 charStart 排序
    noteChunks.sort((a, b) => a.charStart - b.charStart)

    let current = { ...noteChunks[0] }

    for (let i = 1; i < noteChunks.length; i++) {
      const next = noteChunks[i]
      const gap = next.charStart - current.charEnd

      if (gap <= MERGE_GAP_THRESHOLD) {
        // 合并 - 不插入人工分隔符，保持 chunkText 可用于原文定位
        // 注意：合并后的 chunkText 可能不是连续的原文子串，但 charStart/charEnd 是准确的
        if (gap < 0) {
          // 有重叠，去掉重复部分
          const overlapLen = -gap
          if (overlapLen < next.chunkText.length) {
            current.chunkText += next.chunkText.substring(overlapLen)
          }
        } else {
          // gap >= 0，直接连接（UI 层可根据 charStart/charEnd 判断是否有间隙）
          current.chunkText += next.chunkText
        }
        current.charEnd = Math.max(current.charEnd, next.charEnd)
        current.score = Math.max(current.score, next.score)
        // 更新 chunkId 为合并后的标识
        current.chunkId = `${current.chunkId}+${next.chunkIndex}`
      } else {
        // 不合并，保存当前，开始新的
        merged.push(current)
        current = { ...next }
      }
    }
    merged.push(current)
  }

  // 按 score 降序排序
  return merged.sort((a, b) => b.score - a.score)
}

/**
 * 合并搜索结果中每个 note 的重叠 chunks
 */
function mergeChunksInResults(results: SemanticSearchResult[]): SemanticSearchResult[] {
  return results.map((result) => {
    if (result.matchedChunks.length <= 1) {
      return result
    }

    // 转换为 MergeableChunk 格式
    const chunks: MergeableChunk[] = result.matchedChunks.map((c) => ({
      chunkId: c.chunkId,
      noteId: result.noteId,
      notebookId: result.notebookId,
      chunkText: c.chunkText,
      score: c.score,
      charStart: c.charStart,
      charEnd: c.charEnd,
      chunkIndex: c.chunkIndex
    }))

    // 合并重叠 chunks
    const merged = mergeOverlappingChunks(chunks)

    return {
      ...result,
      matchedChunks: merged.map((c) => ({
        chunkId: c.chunkId,
        chunkText: c.chunkText,
        score: c.score,
        charStart: c.charStart,
        charEnd: c.charEnd,
        chunkIndex: c.chunkIndex
      }))
    }
  })
}

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
  charStart: number
  charEnd: number
  chunkIndex: number
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
    charStart: number
    charEnd: number
    chunkIndex: number
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
      score: r.score,
      charStart: r.charStart,
      charEnd: r.charEnd,
      chunkIndex: r.chunkIndex
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
    filter?: NoteSearchFilter
    threshold?: number
    conversationHistory?: ConversationMessage[] // 对话历史，用于 Query Rewrite
  } = {}
): Promise<SemanticSearchResult[]> {
  const { limit = 10, filter, threshold = 2.0, conversationHistory = [] } = options
  const notebookId = filter?.notebookId

  const config = getEmbeddingConfig()
  if (!query.trim()) {
    return []
  }

  // Query Rewrite: 根据对话历史重写查询
  const rewrittenQuery = await rewriteQuery(query, conversationHistory)

  // Query Expansion: 提取关键信息
  const expanded = expandQuery(rewrittenQuery)
  console.log(
    `[QueryExpansion] original="${expanded.original}" -> cleaned="${expanded.cleaned}", ` +
      `keywords=[${expanded.keywords.join(', ')}], quotes=[${expanded.quotedPhrases.join(', ')}]`
  )

  const searchLimit = limit * 3

  // 辅助函数：应用 filter 过滤并返回最终结果
  const applyFilterAndFinalize = (results: SemanticSearchResult[]): SemanticSearchResult[] => {
    const needsFiltering = filter?.viewType || filter?.notebookId
    const expandedLimit = needsFiltering ? limit * 5 : limit
    const limitedResults = results.length > expandedLimit ? results.slice(0, expandedLimit) : results
    const filtered = filter?.viewType
      ? filterByViewType(limitedResults, filter.viewType)
      : filter?.notebookId
        ? filterByViewType(limitedResults, 'all')
        : limitedResults
    return applyAutoCut(filtered).slice(0, limit)
  }

  // 使用清理后的查询进行向量搜索（移除疑问词更聚焦语义）
  const vectorQuery = expanded.cleaned
  // 关键词搜索：结合引号短语和清理后的查询（避免只用引号短语丢失上下文）
  const keywordQuery =
    expanded.quotedPhrases.length > 0
      ? [...expanded.quotedPhrases, expanded.cleaned].filter(Boolean).join(' ')
      : query

  // 并行执行向量搜索和关键词搜索
  const [vectorPromise, keywordPromise] = await Promise.allSettled([
    // 向量搜索（如果知识库启用）
    config.enabled
      ? (async (): Promise<ChunkResult[]> => {
          const queryEmbedding = await getEmbedding(vectorQuery)
          const vecResults = notebookId
            ? searchEmbeddingsInNotebook(queryEmbedding, notebookId, searchLimit, threshold)
            : searchEmbeddings(queryEmbedding, searchLimit, threshold)
          return vecResults.map((r) => ({
            noteId: r.noteId,
            notebookId: r.notebookId,
            chunkId: r.chunkId,
            chunkText: r.chunkText,
            score: r.score,
            charStart: r.charStart,
            charEnd: r.charEnd,
            chunkIndex: r.chunkIndex
          }))
        })()
      : Promise.resolve([]),
    // 关键词搜索（同步函数包装为 Promise）
    Promise.resolve().then(() => {
      const ftsResults = searchKeyword(keywordQuery, searchLimit, notebookId)
      return ftsResults.map((r) => ({
        noteId: r.noteId,
        notebookId: r.notebookId,
        chunkId: r.chunkId,
        chunkText: r.chunkText,
        matchCount: r.matchCount,
        charStart: r.charStart,
        charEnd: r.charEnd,
        chunkIndex: r.chunkIndex
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
    const mapped: ChunkResult[] = keywordResults.map((r, index) => ({
      noteId: r.noteId,
      notebookId: r.notebookId,
      chunkId: r.chunkId,
      chunkText: r.chunkText,
      score: 1 / (RRF_K + index + 1),
      charStart: r.charStart,
      charEnd: r.charEnd,
      chunkIndex: r.chunkIndex
    }))
    const aggregated = aggregateByNote(mapped, limit * 5)
    return applyFilterAndFinalize(aggregated)
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
    const aggregated = aggregateByNote(vectorResults, limit * 5)
    return applyFilterAndFinalize(aggregated)
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

  // 关键词搜索贡献（FTS: BM25 排序；LIKE: matchCount 排序）
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

  // 获取更多结果以便过滤后仍有足够数量（5 倍以应对极端情况如收藏很少）
  const aggregated = aggregateByNote(sortedChunks, limit * 5)

  // 应用 filter 过滤
  const filteredResults = applyFilterAndFinalize(aggregated)

  // 应用 Rerank（如果配置）
  const rerankedResults = await applyRerank(rewrittenQuery, filteredResults)

  // 应用 MMR 增加多样性
  const diverseResults = applyMMR(rerankedResults, 0.7, limit)

  // 合并每个结果内的重叠 chunks
  const results = mergeChunksInResults(diverseResults)

  console.log(
    `[HybridSearch] RRF fusion: vector=${vectorResults.length}, keyword=${keywordResults.length}, ` +
      `chunks=${sortedChunks.length}, notes=${results.length}`
  )

  return results
}

/**
 * 根据 viewType 过滤搜索结果
 * 通过查询 notes 表获取笔记属性，然后过滤
 */
function filterByViewType(
  results: SemanticSearchResult[],
  viewType: NoteSearchFilter['viewType']
): SemanticSearchResult[] {
  if (!viewType || viewType === 'trash' || results.length === 0) {
    return results
  }

  // 获取所有 noteIds 对应的笔记
  const noteIds = results.map((r) => r.noteId)
  const notes = getNotesByIds(noteIds)
  const noteMap = new Map<string, Note>(notes.map((n) => [n.id, n]))
  const localIdentityCache = new Map<string, ReturnType<typeof getLocalNoteIdentityByUid>>()
  const localFavoriteCache = new Map<string, boolean>()
  const localRecentCache = new Map<string, boolean>()

  const getLocalIdentity = (noteId: string) => {
    if (localIdentityCache.has(noteId)) {
      return localIdentityCache.get(noteId) || null
    }
    const identity = getLocalNoteIdentityByUid({ note_uid: noteId })
    localIdentityCache.set(noteId, identity)
    return identity
  }

  const resolveLocalPathRef = resolveLocalNoteRef

  const isLocalResult = (noteId: string): boolean => {
    if (parseLocalResourceId(noteId) !== null) {
      return true
    }
    return Boolean(getLocalIdentity(noteId))
  }

  // 根据 viewType 过滤
  const recentThreshold = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000

  return results.filter((result) => {
    const note = noteMap.get(result.noteId)
    // Local-folder note IDs are not stored in notes table.
    if (!note) {
      if (!isLocalResult(result.noteId)) {
        return false
      }

      switch (viewType) {
        case 'daily':
          return false
        case 'favorites': {
          if (localFavoriteCache.has(result.noteId)) {
            return localFavoriteCache.get(result.noteId) || false
          }
          const pathRef = resolveLocalPathRef(result.noteId)
          if (!pathRef) {
            localFavoriteCache.set(result.noteId, false)
            return false
          }
          const metadata = getLocalNoteMetadata({
            notebook_id: pathRef.notebookId,
            relative_path: pathRef.relativePath,
          })
          const isFavorite = Boolean(metadata?.is_favorite)
          localFavoriteCache.set(result.noteId, isFavorite)
          return isFavorite
        }
        case 'recent': {
          if (localRecentCache.has(result.noteId)) {
            return localRecentCache.get(result.noteId) || false
          }
          const status = getNoteIndexStatus(result.noteId)
          const recentTimestamp = status?.fileMtime || status?.indexedAt
          const isRecent = recentTimestamp
            ? new Date(recentTimestamp).getTime() > recentThreshold
            : true
          localRecentCache.set(result.noteId, isRecent)
          return isRecent
        }
        case 'all':
        default:
          return true
      }
    }
    // 排除已删除的笔记
    if (note.deleted_at) return false

    switch (viewType) {
      case 'daily':
        return note.is_daily
      case 'favorites':
        return note.is_favorite
      case 'recent':
        return !note.is_daily && new Date(note.updated_at).getTime() > recentThreshold
      case 'all':
      default:
        return !note.is_daily
    }
  })
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
        score: chunk.score,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        chunkIndex: chunk.chunkIndex
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
            score: chunk.score,
            charStart: chunk.charStart,
            charEnd: chunk.charEnd,
            chunkIndex: chunk.chunkIndex
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
