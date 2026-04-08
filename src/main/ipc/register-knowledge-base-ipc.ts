import type { IpcMain } from 'electron'
import type { NoteSearchFilter } from '../../shared/types'
import { EMBEDDING_MAX_DIMENSIONS, type EmbeddingConfig } from '../embedding/types'
import { parseNoteSearchFilterInput } from './note-search-filter-input'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>
const KNOWLEDGE_BASE_SEARCH_MAX_LIMIT = 100
const KNOWLEDGE_BASE_QUERY_MAX_LENGTH = 10000
const KNOWLEDGE_BASE_NOTEBOOK_ID_MAX_LENGTH = 1024
const KNOWLEDGE_BASE_API_URL_MAX_LENGTH = 4096
const KNOWLEDGE_BASE_API_KEY_MAX_LENGTH = 8192
const KNOWLEDGE_BASE_MODEL_NAME_MAX_LENGTH = 256

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseRequiredStringInput(
  input: unknown,
  options?: { maxLength?: number }
): string | null {
  if (typeof input !== 'string') return null
  if (!input.trim()) return null
  if (input.includes('\0')) return null
  if (typeof options?.maxLength === 'number' && input.length > options.maxLength) return null
  return input
}

function parseOptionalBoundedStringInput(
  input: unknown,
  options: { maxLength: number }
): string | undefined | null {
  if (input === undefined) return undefined
  if (typeof input !== 'string') return null
  if (input.includes('\0')) return null
  if (input.length > options.maxLength) return null
  return input
}

function parseOptionalNotebookIdInput(input: unknown): string | undefined | null {
  const notebookId = parseOptionalBoundedStringInput(input, { maxLength: KNOWLEDGE_BASE_NOTEBOOK_ID_MAX_LENGTH })
  if (notebookId === undefined) return undefined
  if (notebookId === null || !notebookId.trim()) return null
  return notebookId
}

function parsePositiveIntegerInput(
  input: unknown,
  options?: { max?: number }
): number | undefined | null {
  if (input === undefined) return undefined
  if (typeof input !== 'number' || !Number.isInteger(input) || input <= 0) return null
  if (typeof options?.max === 'number' && input > options.max) return options.max
  return input
}

function parseSemanticSearchOptionsInput(input: unknown): { limit?: number; notebookId?: string } | undefined | null {
  if (input === undefined) return undefined
  if (!isRecord(input) || Array.isArray(input)) return null
  const limit = parsePositiveIntegerInput(input.limit, { max: KNOWLEDGE_BASE_SEARCH_MAX_LIMIT })
  if (input.limit !== undefined && limit === null) return null
  const notebookId = parseOptionalNotebookIdInput(input.notebookId)
  if (input.notebookId !== undefined && notebookId === null) return null
  return {
    limit: limit ?? undefined,
    notebookId: notebookId ?? undefined,
  }
}

function parseHybridSearchOptionsInput(input: unknown): { limit?: number; filter?: NoteSearchFilter } | undefined | null {
  if (input === undefined) return undefined
  if (!isRecord(input) || Array.isArray(input)) return null
  const limit = parsePositiveIntegerInput(input.limit, { max: KNOWLEDGE_BASE_SEARCH_MAX_LIMIT })
  if (input.limit !== undefined && limit === null) return null
  const filter = parseNoteSearchFilterInput(input.filter)
  if (input.filter !== undefined && filter === null) return null
  return {
    limit: limit ?? undefined,
    filter: filter ?? undefined,
  }
}

function parseEmbeddingConfigPatchInput(input: unknown): Partial<EmbeddingConfig> | null {
  if (!isRecord(input) || Array.isArray(input)) return null
  const patch: Partial<EmbeddingConfig> = {}
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') return null
    patch.enabled = input.enabled
  }
  if (input.source !== undefined) {
    if (input.source !== 'sanqian' && input.source !== 'custom') return null
    patch.source = input.source
  }
  if (input.apiType !== undefined) {
    if (input.apiType !== 'openai' && input.apiType !== 'zhipu' && input.apiType !== 'local' && input.apiType !== 'custom') {
      return null
    }
    patch.apiType = input.apiType
  }
  if (input.apiUrl !== undefined) {
    const apiUrl = parseOptionalBoundedStringInput(input.apiUrl, { maxLength: KNOWLEDGE_BASE_API_URL_MAX_LENGTH })
    if (apiUrl === null || apiUrl === undefined) return null
    patch.apiUrl = apiUrl
  }
  if (input.apiKey !== undefined) {
    const apiKey = parseOptionalBoundedStringInput(input.apiKey, { maxLength: KNOWLEDGE_BASE_API_KEY_MAX_LENGTH })
    if (apiKey === null || apiKey === undefined) return null
    patch.apiKey = apiKey
  }
  if (input.modelName !== undefined) {
    const modelName = parseOptionalBoundedStringInput(input.modelName, { maxLength: KNOWLEDGE_BASE_MODEL_NAME_MAX_LENGTH })
    if (modelName === null || modelName === undefined) return null
    patch.modelName = modelName
  }
  if (input.dimensions !== undefined) {
    if (
      typeof input.dimensions !== 'number'
      || !Number.isFinite(input.dimensions)
      || !Number.isInteger(input.dimensions)
      || input.dimensions < 0
      || input.dimensions > EMBEDDING_MAX_DIMENSIONS
    ) {
      return null
    }
    patch.dimensions = input.dimensions
  }
  return patch
}

function mergeEmbeddingConfig(base: EmbeddingConfig, patch: Partial<EmbeddingConfig>): EmbeddingConfig {
  return {
    ...base,
    ...patch,
  }
}

export interface KnowledgeBaseIpcDeps {
  getEmbeddingConfig: () => EmbeddingConfig
  setEmbeddingConfig: (config: EmbeddingConfig) => { indexCleared: boolean; modelChanged: boolean }
  fetchEmbeddingConfigFromSanqian: () => Promise<{
    available: boolean
    apiUrl?: string
    apiKey?: string
    modelName?: string
    dimensions?: number
  } | null>
  fetchRerankConfigFromSanqian: () => Promise<{
    available: boolean
    apiUrl?: string
    apiKey?: string
    modelName?: string
  } | null>
  getDimensionsForModel: (modelName: string) => number
  testEmbeddingAPI: (config?: EmbeddingConfig) => Promise<unknown>
  getIndexStats: () => Record<string, unknown>
  getLastIndexedTime: () => string | null
  cancelPendingLocalNotebookIndexSync: (options: { invalidateRunning: boolean }) => void
  clearAllIndexData: () => void
  getQueueStatus: () => unknown
  triggerFullKnowledgeBaseRebuild: (source: string) => { scheduled: boolean; total: number }
  semanticSearch: (query: string, options?: { limit?: number; notebookId?: string }) => Promise<unknown>
  hybridSearch: (query: string, options?: { limit?: number; filter?: NoteSearchFilter }) => Promise<unknown>
}

export function registerKnowledgeBaseIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: KnowledgeBaseIpcDeps
): void {
  ipcMainLike.handle('knowledgeBase:getConfig', createSafeHandler('knowledgeBase:getConfig', () => deps.getEmbeddingConfig()))
  ipcMainLike.handle('knowledgeBase:setConfig', createSafeHandler('knowledgeBase:setConfig', (_, configInput: unknown) => {
    const patch = parseEmbeddingConfigPatchInput(configInput)
    if (!patch) {
      throw new Error('knowledgeBase:setConfig payload is invalid')
    }
    const config = mergeEmbeddingConfig(deps.getEmbeddingConfig(), patch)
    const result = deps.setEmbeddingConfig(config)
    return { success: true, indexCleared: result.indexCleared, modelChanged: result.modelChanged }
  }))
  ipcMainLike.handle('knowledgeBase:fetchFromSanqian', createSafeHandler('knowledgeBase:fetchFromSanqian', async () => {
    const config = await deps.fetchEmbeddingConfigFromSanqian()
    if (config?.available) {
      const dimensions = config.dimensions || deps.getDimensionsForModel(config.modelName || '')
      return {
        success: true,
        config: {
          available: true,
          apiUrl: config.apiUrl,
          apiKey: config.apiKey,
          modelName: config.modelName,
          dimensions,
        },
      }
    }
    if (config === null) {
      return { success: false, config: { available: false }, error: 'timeout' }
    }
    return { success: false, config: { available: false }, error: 'not_configured' }
  }))
  ipcMainLike.handle('knowledgeBase:fetchRerankFromSanqian', createSafeHandler('knowledgeBase:fetchRerankFromSanqian', async () => {
    const config = await deps.fetchRerankConfigFromSanqian()
    if (config?.available) {
      return {
        success: true,
        config: {
          available: true,
          apiUrl: config.apiUrl,
          apiKey: config.apiKey,
          modelName: config.modelName,
        },
      }
    }
    if (config === null) {
      return { success: false, config: { available: false }, error: 'timeout' }
    }
    return { success: false, config: { available: false }, error: 'not_configured' }
  }))
  ipcMainLike.handle('knowledgeBase:testAPI', createSafeHandler('knowledgeBase:testAPI', async (_, configInput?: unknown) => {
    let config: EmbeddingConfig | undefined
    if (configInput !== undefined) {
      const patch = parseEmbeddingConfigPatchInput(configInput)
      if (!patch) {
        return { success: false, error: 'Invalid config payload' }
      }
      config = mergeEmbeddingConfig(deps.getEmbeddingConfig(), patch)
    }
    return deps.testEmbeddingAPI(config)
  }))
  ipcMainLike.handle('knowledgeBase:getStats', createSafeHandler('knowledgeBase:getStats', () => {
    const stats = deps.getIndexStats()
    const lastIndexedTime = deps.getLastIndexedTime()
    return { ...stats, lastIndexedTime }
  }))
  ipcMainLike.handle('knowledgeBase:clearIndex', createSafeHandler('knowledgeBase:clearIndex', () => {
    deps.cancelPendingLocalNotebookIndexSync({ invalidateRunning: true })
    deps.clearAllIndexData()
    return { success: true }
  }))
  ipcMainLike.handle('knowledgeBase:getQueueStatus', createSafeHandler('knowledgeBase:getQueueStatus', () => {
    return deps.getQueueStatus()
  }))
  ipcMainLike.handle('knowledgeBase:rebuildIndex', createSafeHandler('knowledgeBase:rebuildIndex', () => {
    const rebuild = deps.triggerFullKnowledgeBaseRebuild('manual')
    return { success: true, total: rebuild.total, scheduled: rebuild.scheduled }
  }))
  ipcMainLike.handle('knowledgeBase:semanticSearch', createSafeHandler('knowledgeBase:semanticSearch', async (_, queryInput: unknown, optionsInput?: unknown) => {
    const query = parseRequiredStringInput(queryInput, { maxLength: KNOWLEDGE_BASE_QUERY_MAX_LENGTH })
    const options = parseSemanticSearchOptionsInput(optionsInput)
    if (!query || options === null) {
      return []
    }
    return deps.semanticSearch(query.trim(), options)
  }))
  ipcMainLike.handle('knowledgeBase:hybridSearch', createSafeHandler('knowledgeBase:hybridSearch', async (_, queryInput: unknown, optionsInput?: unknown) => {
    const query = parseRequiredStringInput(queryInput, { maxLength: KNOWLEDGE_BASE_QUERY_MAX_LENGTH })
    const options = parseHybridSearchOptionsInput(optionsInput)
    if (!query || options === null) {
      return []
    }
    return deps.hybridSearch(query.trim(), options)
  }))
}
