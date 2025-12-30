/**
 * 知识库 - Embedding API 调用模块
 *
 * 支持 OpenAI 兼容 API（OpenAI、智谱、Ollama 等）
 */

import { getEmbeddingConfig } from './database'
import type { EmbeddingConfig } from './types'
import { normalizeCjkAscii } from './utils'

// 批处理配置
const DEFAULT_BATCH_SIZE = 50
const DEFAULT_TIMEOUT = 30000 // 30 seconds

/**
 * Embedding API 响应格式（OpenAI 兼容）
 */
interface EmbeddingResponse {
  data: Array<{
    embedding: number[]
    index: number
  }>
  model: string
  usage?: {
    prompt_tokens: number
    total_tokens: number
  }
}

/**
 * 调用 Embedding API 获取向量
 *
 * @param texts - 要获取 embedding 的文本列表
 * @param config - 可选配置，不传则使用数据库中的配置
 * @returns embedding 向量列表
 */
export async function getEmbeddings(
  texts: string[],
  config?: EmbeddingConfig
): Promise<number[][]> {
  const embeddingConfig = config || getEmbeddingConfig()

  if (!embeddingConfig.apiUrl) {
    throw new Error('Embedding API URL not configured')
  }

  // local 模式不需要 apiKey，其他模式需要
  if (embeddingConfig.apiType !== 'local' && !embeddingConfig.apiKey) {
    throw new Error('Embedding API Key not configured')
  }

  if (texts.length === 0) {
    return []
  }

  // 预处理：在中英文之间插入空格，提升分词效果
  const normalizedTexts = texts.map(normalizeCjkAscii)

  // 批处理
  if (normalizedTexts.length <= DEFAULT_BATCH_SIZE) {
    return callEmbeddingAPI(normalizedTexts, embeddingConfig)
  }

  console.log(`[Embedding] Batching ${normalizedTexts.length} texts into chunks of ${DEFAULT_BATCH_SIZE}`)
  const allEmbeddings: number[][] = []

  for (let i = 0; i < normalizedTexts.length; i += DEFAULT_BATCH_SIZE) {
    const batch = normalizedTexts.slice(i, i + DEFAULT_BATCH_SIZE)
    const batchEmbeddings = await callEmbeddingAPI(batch, embeddingConfig)
    allEmbeddings.push(...batchEmbeddings)

    const batchNum = Math.floor(i / DEFAULT_BATCH_SIZE) + 1
    const totalBatches = Math.ceil(normalizedTexts.length / DEFAULT_BATCH_SIZE)
    console.log(`[Embedding] Processed batch ${batchNum}/${totalBatches}`)
  }

  console.log(`[Embedding] Generated ${allEmbeddings.length} embeddings`)
  return allEmbeddings
}

/**
 * 获取单个文本的 embedding
 */
export async function getEmbedding(text: string, config?: EmbeddingConfig): Promise<number[]> {
  const embeddings = await getEmbeddings([text], config)
  if (!embeddings[0]) {
    throw new Error('Failed to generate embedding')
  }
  return embeddings[0]
}

/**
 * Ollama Embedding API 响应格式
 */
interface OllamaEmbeddingResponse {
  embedding: number[]
}

/**
 * 调用 Embedding API（单次请求）
 */
async function callEmbeddingAPI(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const { apiUrl, apiKey, modelName, apiType } = config

  // Ollama 不支持批量请求，需要逐个调用
  if (apiType === 'local') {
    const embeddings: number[][] = []
    for (const text of texts) {
      const embedding = await callOllamaAPI(apiUrl, modelName, text, apiKey)
      embeddings.push(embedding)
    }
    console.log(`[Embedding] Generated ${embeddings.length} embeddings (dim=${embeddings[0]?.length})`)
    return embeddings
  }

  // OpenAI 兼容 API（OpenAI、智谱等）
  const payload = buildPayload(texts, modelName)
  const headers = buildHeaders(apiKey, apiType)

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Embedding] API error ${response.status}: ${errorText.slice(0, 200)}`)
      throw new Error(`Embedding API error: ${response.status} - ${errorText.slice(0, 100)}`)
    }

    const data = (await response.json()) as EmbeddingResponse

    // 按 index 排序确保顺序正确
    const sortedData = data.data.sort((a, b) => a.index - b.index)
    const embeddings = sortedData.map((item) => item.embedding)

    // 防御性检查：确保返回数量与请求数量一致
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Embedding count mismatch: expected ${texts.length}, got ${embeddings.length}`
      )
    }

    console.log(`[Embedding] Generated ${embeddings.length} embeddings (dim=${embeddings[0]?.length})`)
    return embeddings
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Embedding API timeout')
    }
    throw error
  }
}

/**
 * 调用 Ollama Embedding API（单条）
 */
async function callOllamaAPI(
  apiUrl: string,
  modelName: string,
  text: string,
  apiKey?: string
): Promise<number[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelName,
        prompt: text
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Ollama API error: ${response.status} - ${errorText.slice(0, 100)}`)
    }

    const data = (await response.json()) as OllamaEmbeddingResponse
    return data.embedding
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Ollama API timeout after ${DEFAULT_TIMEOUT}ms`)
    }
    throw error
  }
}

/**
 * 构建请求 payload（OpenAI 兼容格式）
 */
function buildPayload(texts: string[], modelName: string): Record<string, unknown> {
  // OpenAI 兼容格式（OpenAI、智谱等都支持）
  return {
    input: texts,
    model: modelName
  }
}

/**
 * 构建请求头
 */
function buildHeaders(
  apiKey: string,
  apiType: EmbeddingConfig['apiType']
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  // 添加认证头
  if (apiType === 'zhipu') {
    // 智谱使用 Authorization: Bearer
    headers['Authorization'] = `Bearer ${apiKey}`
  } else if (apiType === 'local') {
    // Ollama 本地模型通常不需要认证
    // 但如果配置了 key 也加上
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
  } else {
    // OpenAI 和自定义 API
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  return headers
}

/**
 * 测试 Embedding API 连接
 *
 * @returns 测试结果，包含成功与否和向量维度
 */
export async function testEmbeddingAPI(config?: EmbeddingConfig): Promise<{
  success: boolean
  dimensions?: number
  error?: string
}> {
  try {
    const embeddingConfig = config || getEmbeddingConfig()

    if (!embeddingConfig.apiUrl) {
      return { success: false, error: 'API URL not configured' }
    }

    // local 模式不需要 apiKey，其他模式需要
    if (embeddingConfig.apiType !== 'local' && !embeddingConfig.apiKey) {
      return { success: false, error: 'API Key not configured' }
    }

    // 使用简单文本测试
    const testText = 'Hello, this is a test.'
    const embedding = await getEmbedding(testText, embeddingConfig)

    return {
      success: true,
      dimensions: embedding.length
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
