/**
 * 知识库 - 向量数据库模块（barrel re-exports）
 *
 * 所有实现已拆分到:
 * - database-core.ts: 初始化、schema、FTS、配置管理
 * - database-ops.ts:  CRUD 操作、搜索、统计
 */

// Re-export everything for backward compatibility
export {
  initVectorDatabase,
  closeVectorDatabase,
  scheduleFtsRebuild,
  __setVectorDatabaseForTests,
  getEmbeddingConfig,
  setEmbeddingConfig,
  checkModelConsistency,
  clearAllIndexData,
} from './database-core'

export {
  insertNoteChunks,
  deleteNoteChunks,
  deleteNoteIndexes,
  updateNoteNotebookId,
  getNoteChunks,
  deleteChunksByIds,
  deleteEmbeddingsByChunkIds,
  updateChunksMetadata,
  updateNoteIndexStatus,
  updateNoteIndexFileMtimeIfIndexed,
  getNoteIndexStatus,
  getNoteIndexStatusBatch,
  deleteNoteIndexStatus,
  getAllIndexStatus,
  getAllIndexedNoteIds,
  getIndexedNoteIdsByPrefix,
  getIndexedExistingNoteIds,
  insertEmbeddings,
  deleteNoteEmbeddings,
  searchEmbeddings,
  searchEmbeddingsInNotebook,
  searchKeyword,
  type KeywordSearchResult,
  getEmbeddingCount,
  getIndexStats,
  getLastIndexedTime,
} from './database-ops'
