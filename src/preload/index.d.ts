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
        checkIndex: (noteId: string, notebookId: string, content: string) => Promise<boolean>
        onDataChanged: (callback: () => void) => () => void
        onSummaryUpdated: (callback: (noteId: string) => void) => () => void
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
        sync?: (settings: { colorMode: 'light' | 'dark'; accentColor: string; locale: 'en' | 'zh'; fontSize?: 'small' | 'normal' | 'large' | 'extra-large' }) => Promise<{ success: boolean }>
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
      importExport: {
        getImporters: () => Promise<Array<{
          id: string
          name: string
          description: string
          extensions: string[]
          supportsFolder: boolean
          fileFilters: Array<{ name: string; extensions: string[] }>
        }>>
        detect: (sourcePath: string) => Promise<{
          id: string
          name: string
          description: string
          extensions: string[]
          supportsFolder: boolean
          fileFilters: Array<{ name: string; extensions: string[] }>
        } | null>
        preview: (options: {
          sourcePath: string
          folderStrategy: 'first-level' | 'flatten-path' | 'single-notebook'
          targetNotebookId?: string
          defaultNotebookId?: string | null
          tagStrategy: 'keep-nested' | 'flatten-all' | 'first-level'
          conflictStrategy: 'skip' | 'rename' | 'overwrite'
          importAttachments: boolean
          parseFrontMatter: boolean
        }) => Promise<{
          importerId: string
          importerName: string
          noteCount: number
          notebookNames: string[]
          attachmentCount: number
          files: Array<{ path: string; title: string; notebookName?: string }>
        }>
        execute: (options: {
          sourcePath: string
          folderStrategy: 'first-level' | 'flatten-path' | 'single-notebook'
          targetNotebookId?: string
          defaultNotebookId?: string | null
          tagStrategy: 'keep-nested' | 'flatten-all' | 'first-level'
          conflictStrategy: 'skip' | 'rename' | 'overwrite'
          importAttachments: boolean
          parseFrontMatter: boolean
        }) => Promise<{
          success: boolean
          importedNotes: Array<{ id: string; title: string; sourcePath: string }>
          skippedFiles: Array<{ path: string; reason: string }>
          errors: Array<{ path: string; error: string }>
          createdNotebooks: Array<{ id: string; name: string }>
          stats: {
            totalFiles: number
            importedNotes: number
            importedAttachments: number
            skippedFiles: number
            errorCount: number
            duration: number
          }
        }>
        selectSource: (importerId?: string) => Promise<string | null>
        export: (options: {
          noteIds: string[]
          notebookIds: string[]
          format: 'markdown' | 'json'
          outputPath: string
          groupByNotebook: boolean
          includeAttachments: boolean
          includeFrontMatter: boolean
          asZip: boolean
        }) => Promise<{
          success: boolean
          outputPath: string
          stats: {
            exportedNotes: number
            exportedAttachments: number
            totalSize: number
          }
          errors: Array<{ noteId: string; title: string; error: string }>
        }>
        selectTarget: () => Promise<string | null>
      }
      appData: {
        getPath: () => Promise<string>
        openPath: () => Promise<string>
      }
    }
    api: unknown
  }
}
