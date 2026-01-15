/**
 * Rerank API 模块
 *
 * 调用外部 Rerank API 对搜索结果进行重排序
 * 支持 Zhipu BigModel, Cohere 等兼容 API
 */

export interface RerankApiConfig {
  apiUrl: string
  apiKey: string
  modelName: string
}

// 当前配置
let currentConfig: RerankApiConfig | null = null

/**
 * 设置 Rerank API 配置
 */
export function setRerankConfig(config: RerankApiConfig | null): void {
  currentConfig = config
  if (config) {
    console.log(`[Rerank API] configured: model=${config.modelName}, url=${config.apiUrl}`)
  } else {
    console.log('[Rerank API] disabled')
  }
}

/**
 * 获取当前 Rerank 配置
 */
export function getRerankConfig(): RerankApiConfig | null {
  return currentConfig
}

/**
 * 检查 Rerank 是否可用
 */
export function isRerankAvailable(): boolean {
  return !!(currentConfig?.apiUrl && currentConfig?.apiKey && currentConfig?.modelName)
}

/**
 * Rerank API 响应格式
 */
interface RerankApiResponse {
  results: Array<{
    index: number
    relevance_score: number
  }>
}

/**
 * 调用 Rerank API
 *
 * @param query - 查询文本
 * @param documents - 待重排序的文档列表
 * @returns 重排序后的结果（包含 id 和新分数）
 */
export async function callRerankAPI(
  query: string,
  documents: Array<{ id: string; text: string; score: number }>
): Promise<Array<{ id: string; score: number }>> {
  if (!currentConfig) {
    console.log('[Rerank API] not configured, returning original order')
    return documents.map((d) => ({ id: d.id, score: d.score }))
  }

  if (documents.length === 0) {
    return []
  }

  const { apiUrl, apiKey, modelName } = currentConfig

  try {
    const payload = {
      model: modelName,
      query: query,
      documents: documents.map((d) => d.text),
      top_n: documents.length,
      return_documents: false
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Rerank API] error ${response.status}: ${errorText.slice(0, 200)}`)
      return documents.map((d) => ({ id: d.id, score: d.score }))
    }

    const data = (await response.json()) as RerankApiResponse

    if (!data.results || data.results.length === 0) {
      console.warn('[Rerank API] empty results, returning original order')
      return documents.map((d) => ({ id: d.id, score: d.score }))
    }

    // 过滤无效 index，按 relevance_score 降序排列，映射回原始文档
    const validResults = data.results.filter((r) => r.index >= 0 && r.index < documents.length)
    if (validResults.length < data.results.length) {
      console.warn(
        `[Rerank API] filtered ${data.results.length - validResults.length} invalid indices`
      )
    }

    const reranked = validResults
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map((r) => ({
        id: documents[r.index].id,
        score: r.relevance_score
      }))

    console.log(
      `[Rerank API] reranked ${documents.length} documents, top score: ${reranked[0]?.score.toFixed(3)}`
    )

    return reranked
  } catch (error) {
    console.error('[Rerank API] request failed:', error instanceof Error ? error.message : error)
    return documents.map((d) => ({ id: d.id, score: d.score }))
  }
}

/**
 * 测试 Rerank API 连接
 */
export async function testRerankAPI(
  config?: RerankApiConfig
): Promise<{ success: boolean; message: string }> {
  const testConfig = config || currentConfig

  if (!testConfig) {
    return { success: false, message: 'Rerank API not configured' }
  }

  try {
    const testQuery = 'test query'
    const testDocs = ['document one', 'document two']

    const response = await fetch(testConfig.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${testConfig.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: testConfig.modelName,
        query: testQuery,
        documents: testDocs,
        top_n: 2,
        return_documents: false
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, message: `API error ${response.status}: ${errorText.slice(0, 100)}` }
    }

    const data = (await response.json()) as RerankApiResponse

    if (!data.results || data.results.length === 0) {
      return { success: false, message: 'API returned empty results' }
    }

    return {
      success: true,
      message: `Rerank API working (model: ${testConfig.modelName})`
    }
  } catch (error) {
    return {
      success: false,
      message: `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}
