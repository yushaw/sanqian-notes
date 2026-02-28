import type { IpcMain } from 'electron'
import type { NoteSearchFilter } from '../../shared/types'
import type { EmbeddingConfig } from '../embedding/types'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

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
  ipcMainLike.handle('knowledgeBase:setConfig', createSafeHandler('knowledgeBase:setConfig', (_, config: EmbeddingConfig) => {
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
  ipcMainLike.handle('knowledgeBase:testAPI', createSafeHandler('knowledgeBase:testAPI', async (_, config?: EmbeddingConfig) => {
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
  ipcMainLike.handle('knowledgeBase:semanticSearch', createSafeHandler('knowledgeBase:semanticSearch', async (_, query: string, options?: { limit?: number; notebookId?: string }) => {
    return deps.semanticSearch(query, options)
  }))
  ipcMainLike.handle('knowledgeBase:hybridSearch', createSafeHandler('knowledgeBase:hybridSearch', async (_, query: string, options?: { limit?: number; filter?: NoteSearchFilter }) => {
    return deps.hybridSearch(query, options)
  }))
}
