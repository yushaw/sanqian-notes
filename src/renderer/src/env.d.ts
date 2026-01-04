/// <reference types="vite/client" />

// 从 shared/types 导入类型
type AttachmentResult = import('../../shared/types').AttachmentResult
type AttachmentSelectOptions = import('../../shared/types').AttachmentSelectOptions
type AttachmentAPI = import('../../shared/types').AttachmentAPI
// Simplified ChatAPI for AI actions only (FloatingWindow uses separate sanqian-chat:* handlers)
interface ChatAPI {
  acquireReconnect: () => Promise<void>
  releaseReconnect: () => Promise<void>
  stream: (params: {
    streamId: string
    messages: Array<{ role: string; content: string }>
    conversationId?: string
    agentId?: string
  }) => Promise<{ success: boolean; error?: string }>
  cancelStream: (params: { streamId: string }) => Promise<{ success: boolean }>
  onStreamEvent: (callback: (streamId: string, event: unknown) => void) => () => void
}
type AIAction = import('../../shared/types').AIAction
type AIActionInput = import('../../shared/types').AIActionInput
type AIActionAPI = import('../../shared/types').AIActionAPI

interface Window {
  electron: {
    app: {
      getVersion: () => Promise<string>
    }
    updater: {
      check: () => Promise<{ status: string; version?: string | null; error?: string }>
      download: () => Promise<{ success: boolean; error?: string }>
      install: () => Promise<{ success: boolean; error?: string }>
      getStatus: () => Promise<{ status: string; version: string | null; progress: number; error: string | null }>
      onStatus: (callback: (status: { status: string; version: string | null; progress: number; error: string | null }) => void) => () => void
    }
    note: {
      getAll: () => Promise<Note[]>
      getById: (id: string) => Promise<Note | null>
      getByIds: (ids: string[]) => Promise<Note[]>
      add: (note: NoteInput) => Promise<Note>
      update: (id: string, updates: Partial<NoteInput>) => Promise<Note | null>
      delete: (id: string) => Promise<boolean>
      search: (query: string) => Promise<Note[]>
      // 笔记失焦时触发增量索引检查（摘要由 indexing-service 根据 chunk 变化率自动触发）
      checkIndex: (noteId: string, notebookId: string, content: string) => Promise<boolean>
      onDataChanged: (callback: () => void) => () => void
      onSummaryUpdated: (callback: (noteId: string) => void) => () => void
    }
    trash: {
      getAll: () => Promise<Note[]>
      restore: (id: string) => Promise<boolean>
      permanentDelete: (id: string) => Promise<boolean>
      empty: () => Promise<number>
      cleanup: () => Promise<number>
    }
    notebook: {
      getAll: () => Promise<Notebook[]>
      add: (notebook: NotebookInput) => Promise<Notebook>
      update: (id: string, updates: Partial<NotebookInput>) => Promise<Notebook | null>
      delete: (id: string) => Promise<boolean>
    }
    context: {
      sync: (context: {
        currentNotebookId: string | null
        currentNotebookName: string | null
        currentNoteId: string | null
        currentNoteTitle: string | null
        currentBlockId?: string | null
        selectedText?: string | null
      }) => Promise<void>
      get: () => Promise<{ context: string }>
    }
    tag: {
      getAll: () => Promise<Tag[]>
      getByNote: (noteId: string) => Promise<TagWithSource[]>
    }
    aiAction: {
      getAll: () => Promise<AIAction[]>
      getAllIncludingDisabled: () => Promise<AIAction[]>
      getById: (id: string) => Promise<AIAction | null>
      create: (input: AIActionInput) => Promise<AIAction>
      update: (id: string, updates: Partial<AIActionInput> & { enabled?: boolean }) => Promise<AIAction | null>
      delete: (id: string) => Promise<boolean>
      reorder: (orderedIds: string[]) => Promise<void>
      reset: () => Promise<void>
    }
    theme: {
      get: () => Promise<'light' | 'dark'>
      onChange?: (callback: (theme: 'light' | 'dark') => void) => () => void
      sync?: (settings: { colorMode: 'light' | 'dark'; accentColor: string; locale: 'en' | 'zh'; fontSize?: 'small' | 'normal' | 'large' | 'extra-large' }) => Promise<{ success: boolean }>
    }
    window: {
      setTitleBarOverlay?: (options: { color: string; symbolColor: string }) => void
      setFullScreen: (isFullScreen: boolean) => Promise<boolean>
      isFullScreen: () => Promise<boolean>
    }
    platform: {
      get: () => Promise<NodeJS.Platform>
    }
    attachment: AttachmentAPI
    chat: ChatAPI
    chatWindow: {
      show: () => Promise<{ success: boolean }>
      showWithContext: (context: string) => Promise<{ success: boolean }>
      hide: () => Promise<{ success: boolean }>
      toggle: () => Promise<{ success: boolean }>
      isVisible: () => Promise<boolean>
    }
    popup: {
      // 继续对话 (用于 hover 预览中的继续对话按钮)
      continueInChat: (selectedText: string, explanation: string) => Promise<void>
      onContinueInChat: (callback: (selectedText: string, explanation: string) => void) => () => void
      // Popup data storage (database)
      get: (id: string) => Promise<{
        id: string
        content: string
        prompt: string
        actionName: string
        targetText: string
        documentTitle: string
        createdAt: string
        updatedAt: string
      } | null>
      create: (input: {
        id: string
        prompt: string
        actionName?: string
        targetText: string
        documentTitle?: string
      }) => Promise<{
        id: string
        content: string
        prompt: string
        actionName: string
        targetText: string
        documentTitle: string
        createdAt: string
        updatedAt: string
      }>
      updateContent: (id: string, content: string) => Promise<boolean>
      delete: (id: string) => Promise<boolean>
      cleanup: (maxAgeDays?: number) => Promise<number>
    }
    knowledgeBase: {
      getConfig: () => Promise<{
        enabled: boolean
        source: 'sanqian' | 'custom'
        apiType: 'openai' | 'zhipu' | 'local' | 'custom'
        apiUrl: string
        apiKey: string
        modelName: string
        dimensions: number
      }>
      setConfig: (config: {
        enabled?: boolean
        source?: 'sanqian' | 'custom'
        apiType?: 'openai' | 'zhipu' | 'local' | 'custom'
        apiUrl?: string
        apiKey?: string
        modelName?: string
        dimensions?: number
      }) => Promise<{ success: boolean; indexCleared: boolean; modelChanged: boolean }>
      fetchFromSanqian: () => Promise<{
        success: boolean
        config: {
          available: boolean
          apiUrl?: string
          apiKey?: string
          modelName?: string
          dimensions?: number
        }
        error?: 'timeout' | 'not_configured'
      }>
      testAPI: (config?: {
        enabled?: boolean
        source?: 'sanqian' | 'custom'
        apiType?: 'openai' | 'zhipu' | 'local' | 'custom'
        apiUrl?: string
        apiKey?: string
        modelName?: string
        dimensions?: number
      }) => Promise<{
        success: boolean
        dimensions?: number
        error?: string
      }>
      getStats: () => Promise<{
        totalChunks: number
        totalEmbeddings: number
        indexedNotes: number
        pendingNotes: number
        errorNotes: number
        lastIndexedTime: string | null
      }>
      clearIndex: () => Promise<{ success: boolean }>
      getQueueStatus: () => Promise<{
        pending: number
        queue: number
        processing: boolean
      }>
      rebuildIndex: () => Promise<{ success: boolean; total?: number }>
      onProgress: (callback: (progress: {
        type: 'start' | 'progress' | 'complete' | 'error'
        total?: number
        current?: number
        noteId?: string
        error?: string
      }) => void) => () => void
      semanticSearch: (query: string, options?: {
        limit?: number
        notebookId?: string
      }) => Promise<Array<{
        noteId: string
        notebookId: string
        score: number
        matchedChunks: Array<{
          chunkId: string
          chunkText: string
          score: number
        }>
      }>>
      hybridSearch: (query: string, options?: {
        limit?: number
        notebookId?: string
      }) => Promise<Array<{
        noteId: string
        notebookId: string
        score: number
        matchedChunks: Array<{
          chunkId: string
          chunkText: string
          score: number
        }>
      }>>
    }
  }
}

// Note types are imported from shared/types
type Note = import('../../shared/types').Note
type NoteInput = import('../../shared/types').NoteInput
type Notebook = import('../../shared/types').Notebook
type NotebookInput = import('../../shared/types').NotebookInput
type Tag = import('../../shared/types').Tag
type TagWithSource = import('../../shared/types').TagWithSource
