/**
 * Sanqian SDK Integration - barrel re-export.
 *
 * Connects to Sanqian via SanqianAppClient (Facade) and registers Notes tools.
 * Also creates private agents for the Notes chat panel.
 */

export {
  setCurrentTaskIdGetter,
  setOnSdkDataChange,
} from './state'

export {
  initializeSanqianSDK,
  stopSanqianSDK,
  updateSdkContexts,
  isSanqianConnected,
  acquireReconnect,
  releaseReconnect,
  getAssistantAgentId,
  getWritingAgentId,
  getGeneratorAgentId,
  getFormatterAgentId,
  getClient,
  ensureAgentReady,
  fetchEmbeddingConfigFromSanqian,
  fetchRerankConfigFromSanqian,
} from './client'
