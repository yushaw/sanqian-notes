import type {
  AttachmentResult,
  AttachmentSelectOptions,
  AttachmentAPI,
  ChatAPI,
  ChatMessage,
  ChatStreamEvent,
  ConversationInfo,
  ConversationDetail
} from '../shared/types'

export {
  AttachmentResult,
  AttachmentSelectOptions,
  AttachmentAPI,
  ChatAPI,
  ChatMessage,
  ChatStreamEvent,
  ConversationInfo,
  ConversationDetail
}

declare global {
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
        getAll: () => Promise<unknown[]>
        getById: (id: string) => Promise<unknown | null>
        getByIds: (ids: string[]) => Promise<unknown[]>
        add: (note: unknown) => Promise<unknown>
        update: (id: string, updates: unknown) => Promise<unknown | null>
        delete: (id: string) => Promise<boolean>
        search: (query: string) => Promise<unknown[]>
        createDemo: () => Promise<void>
        onDataChanged: (callback: () => void) => () => void
      }
      trash: {
        getAll: () => Promise<unknown[]>
        restore: (id: string) => Promise<boolean>
        permanentDelete: (id: string) => Promise<boolean>
        empty: () => Promise<number>
        cleanup: () => Promise<number>
      }
      notebook: {
        getAll: () => Promise<unknown[]>
        add: (notebook: unknown) => Promise<unknown>
        update: (id: string, updates: unknown) => Promise<unknown | null>
        delete: (id: string) => Promise<boolean>
      }
      tag: {
        getAll: () => Promise<unknown[]>
        getByNote: (noteId: string) => Promise<unknown[]>
      }
      theme: {
        get: () => Promise<'light' | 'dark'>
        onChange?: (callback: (theme: 'light' | 'dark') => void) => void
      }
      window: {
        setTitleBarOverlay: (options: { color: string; symbolColor: string }) => Promise<void>
        setFullScreen: (isFullScreen: boolean) => Promise<boolean>
        isFullScreen: () => Promise<boolean>
      }
      platform: {
        get: () => Promise<NodeJS.Platform>
      }
      attachment: AttachmentAPI
      chat: ChatAPI
      popup: {
        open: (popupId: string, options?: {
          x?: number
          y?: number
          width?: number
          height?: number
          prompt?: string
          context?: { targetText: string; documentTitle?: string }
        }) => Promise<void>
        close: (popupId: string) => Promise<void>
        focus: (popupId: string) => Promise<void>
        updateContent: (popupId: string, content: string) => Promise<void>
        exists: (popupId: string) => Promise<boolean>
        onClosed: (callback: (popupId: string) => void) => () => void
        onContentRequest: (callback: (popupId: string) => void) => () => void
        onContentUpdate: (callback: (content: string) => void) => () => void
      }
      aiAction: {
        getAll: () => Promise<unknown[]>
        getAllIncludingDisabled: () => Promise<unknown[]>
        getById: (id: string) => Promise<unknown | null>
        create: (input: unknown) => Promise<unknown>
        update: (id: string, updates: unknown) => Promise<unknown | null>
        delete: (id: string) => Promise<boolean>
        reorder: (orderedIds: string[]) => Promise<boolean>
        reset: () => Promise<void>
      }
      knowledgeBase: {
        getConfig: () => Promise<{
          enabled: boolean
          apiType: 'openai' | 'zhipu' | 'local' | 'custom'
          apiUrl: string
          apiKey: string
          modelName: string
          dimensions: number
        }>
        setConfig: (config: unknown) => Promise<{ success: boolean; indexCleared: boolean }>
        testAPI: (config?: unknown) => Promise<{
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
        rebuildIndex: () => Promise<{ success: boolean; total: number }>
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
    api: unknown
  }
}
