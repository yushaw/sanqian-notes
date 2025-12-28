/**
 * 知识库 - 类型定义
 */

// Embedding 配置
export interface EmbeddingConfig {
  enabled: boolean
  apiType: 'openai' | 'zhipu' | 'local' | 'custom'
  apiUrl: string
  apiKey: string
  modelName: string
  dimensions: number
}

// 预设配置
export const EMBEDDING_PRESETS: Record<string, Partial<EmbeddingConfig>> = {
  'openai-small': {
    apiType: 'openai',
    apiUrl: 'https://api.openai.com/v1/embeddings',
    modelName: 'text-embedding-3-small',
    dimensions: 1536
  },
  'openai-large': {
    apiType: 'openai',
    apiUrl: 'https://api.openai.com/v1/embeddings',
    modelName: 'text-embedding-3-large',
    dimensions: 3072
  },
  zhipu: {
    apiType: 'zhipu',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
    modelName: 'embedding-3',
    dimensions: 2048
  },
  local: {
    apiType: 'local',
    apiUrl: 'http://localhost:11434/api/embeddings',
    modelName: 'bge-m3',
    dimensions: 1024
  }
}

// 默认配置
export const DEFAULT_CONFIG: EmbeddingConfig = {
  enabled: false,
  apiType: 'openai',
  apiUrl: 'https://api.openai.com/v1/embeddings',
  apiKey: '',
  modelName: 'text-embedding-3-small',
  dimensions: 1536
}

// 索引状态
export interface IndexStatus {
  totalNotes: number
  indexedNotes: number
  pendingNotes: number
  errorNotes: number
  lastUpdated: string | null
  isIndexing: boolean
  progress: number
}

// 笔记块
export interface NoteChunk {
  chunkId: string // 格式: "{noteId}:{chunkIndex}"
  noteId: string
  notebookId: string
  chunkIndex: number
  chunkText: string
  charStart: number
  charEnd: number
  heading: string | null
  createdAt: string
}

// 笔记索引状态
export interface NoteIndexStatus {
  noteId: string
  contentHash: string
  chunkCount: number
  modelName: string
  indexedAt: string
  status: 'indexed' | 'pending' | 'error'
  errorMessage?: string
}

// 搜索结果
export interface VectorSearchResult {
  chunkId: string
  noteId: string
  notebookId: string
  chunkText: string
  distance: number
  score: number // 1 / (1 + distance)
}
