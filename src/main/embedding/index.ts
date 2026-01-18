/**
 * 知识库模块 - 统一导出
 */

// 类型
export type {
  EmbeddingConfig,
  EmbeddingSource,
  IndexStatus,
  NoteChunk,
  NoteIndexStatus,
  VectorSearchResult
} from './types'

export {
  EMBEDDING_PRESETS,
  DEFAULT_CONFIG,
  MODEL_DIMENSIONS,
  getDimensionsForModel
} from './types'

// 数据库
export {
  initVectorDatabase,
  closeVectorDatabase,
  getEmbeddingConfig,
  setEmbeddingConfig,
  checkModelConsistency,
  insertNoteChunks,
  deleteNoteChunks,
  getNoteChunks,
  updateNoteIndexStatus,
  getNoteIndexStatus,
  deleteNoteIndexStatus,
  getAllIndexStatus,
  insertEmbeddings,
  deleteNoteEmbeddings,
  searchEmbeddings,
  searchEmbeddingsInNotebook,
  searchKeyword,
  getEmbeddingCount,
  getIndexStats,
  clearAllIndexData,
  getLastIndexedTime,
  updateNoteNotebookId,
  type KeywordSearchResult
} from './database'

// API
export { getEmbeddings, getEmbedding, testEmbeddingAPI } from './api'

// Rerank API
export {
  setRerankConfig,
  getRerankConfig,
  isRerankAvailable,
  callRerankAPI,
  testRerankAPI,
  type RerankApiConfig
} from './rerank-api'

// 分块
export {
  ChunkingService,
  getChunkingService,
  chunkNote,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  MIN_CHUNK_SIZE
} from './chunking'

// 索引服务
export { indexingService } from './indexing-service'

// 语义搜索
export { semanticSearch, hybridSearch, type SemanticSearchResult } from './semantic-search'
