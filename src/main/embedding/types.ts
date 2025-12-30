/**
 * 知识库 - 类型定义
 */

// Embedding 配置来源
export type EmbeddingSource = 'sanqian' | 'custom'

// Embedding 配置
export interface EmbeddingConfig {
  enabled: boolean
  source: EmbeddingSource // 配置来源：sanqian（从三千获取）或 custom（自定义）
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
  source: 'sanqian', // 默认从三千获取
  apiType: 'openai',
  apiUrl: '',
  apiKey: '',
  modelName: '',
  dimensions: 0
}

// 根据 modelName 获取 dimensions
export const MODEL_DIMENSIONS: Record<string, number> = {
  // OpenAI
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // 智谱
  'embedding-3': 2048,
  'embedding-2': 1024,
  // Ollama / 本地
  'bge-m3': 1024,
  'bge-large-zh-v1.5': 1024,
  'nomic-embed-text': 768,
}

/**
 * 根据 modelName 获取 dimensions，未知模型返回默认值 1536
 */
export function getDimensionsForModel(modelName: string): number {
  return MODEL_DIMENSIONS[modelName] || 1536
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
