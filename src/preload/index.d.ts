import type {
  AttachmentResult,
  AttachmentSelectOptions,
  AttachmentAPI,
  ChatAPI,
  ChatMessage,
  ChatStreamEvent,
  ConversationInfo,
  ConversationDetail,
  NoteSearchFilter,
  NoteUpdateSafeResult
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
        getStatus: () => Promise<{ status: string; version: string | null; progress: number; error: string | null; releaseNotes: string | null }>
        onStatus: (callback: (status: { status: string; version: string | null; progress: number; error: string | null; releaseNotes: string | null }) => void) => () => void
      }
      note: {
        getAll: () => Promise<unknown[]>
        getById: (id: string) => Promise<unknown | null>
        getByIds: (ids: string[]) => Promise<unknown[]>
        add: (note: unknown) => Promise<unknown>
        update: (id: string, updates: unknown) => Promise<unknown | null>
        updateSafe: (id: string, updates: unknown, expectedRevision: number) => Promise<NoteUpdateSafeResult>
        delete: (id: string) => Promise<boolean>
        search: (query: string, filter?: NoteSearchFilter) => Promise<unknown[]>
        createDemo: () => Promise<void>
        checkIndex: (noteId: string, notebookId: string, content: string) => Promise<boolean>
        onDataChanged: (callback: () => void) => () => void
        onSummaryUpdated: (callback: (noteId: string) => void) => () => void
        onNavigate: (callback: (data: { noteId: string; target?: { type: 'heading' | 'block'; value: string } }) => void) => () => void
      }
      daily: {
        getByDate: (date: string) => Promise<unknown | null>
        create: (date: string, title?: string) => Promise<unknown>
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
        close: () => Promise<boolean>
      }
      shell: {
        openExternal: (url: string) => Promise<boolean>
      }
      platform: {
        get: () => Promise<NodeJS.Platform>
      }
      appSettings: {
        get: (key: string) => Promise<string | null>
        set: (key: string, value: string) => Promise<void>
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
          filter?: NoteSearchFilter
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
          sourcePath: string | string[]
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
          sourcePath: string | string[]
          folderStrategy: 'first-level' | 'flatten-path' | 'single-notebook'
          targetNotebookId?: string
          defaultNotebookId?: string | null
          tagStrategy: 'keep-nested' | 'flatten-all' | 'first-level'
          conflictStrategy: 'skip' | 'rename' | 'overwrite'
          importAttachments: boolean
          parseFrontMatter: boolean
          buildEmbedding?: boolean
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
        selectSource: (importerId?: string) => Promise<string[] | null>
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
        // 单篇笔记导出
        noteAsMarkdown: (noteId: string, options?: {
          includeAttachments?: boolean
          includeFrontMatter?: boolean
        }) => Promise<{
          success: boolean
          path?: string
          error?: string
        }>
        noteAsPDF: (noteId: string, options?: {
          pageSize?: 'A4' | 'Letter'
          includeBackground?: boolean
        }) => Promise<{
          success: boolean
          path?: string
          error?: string
        }>
      }
      pdfImport: {
        getServices: () => Promise<Array<{
          id: string
          name: string
          description: string
          configUrl: string
          configFields: Array<{
            key: string
            label: string
            type: 'text' | 'password'
            placeholder?: string
            required: boolean
          }>
        }>>
        getConfig: () => Promise<{
          activeService: string
          services: Record<string, Record<string, string>>
          rememberConfig: boolean
        }>
        setConfig: (config: {
          activeService: string
          services: Record<string, Record<string, string>>
          rememberConfig: boolean
        }) => Promise<void>
        getServiceConfig: (serviceId: string) => Promise<Record<string, string> | null>
        setServiceConfig: (serviceId: string, config: Record<string, string>) => Promise<void>
        selectFiles: () => Promise<string[]>
        import: (options: {
          pdfPaths: string[]
          serviceId: string
          serviceConfig: Record<string, string>
          targetNotebookId?: string
          importImages: boolean
          buildEmbedding?: boolean
        }) => Promise<{
          results: Array<{
            path: string
            success: boolean
            noteId?: string
            noteTitle?: string
            imageCount?: number
            error?: string
          }>
          successCount: number
          failCount: number
        }>
        cancel: () => Promise<boolean>
        onProgress: (callback: (progress: {
          stage: string
          message: string
          currentFile?: number
          totalFiles?: number
          fileName?: string
          percent?: number
        }) => void) => () => void
      }
      arxiv: {
        parseInput: (input: string) => Promise<{ id: string; version?: number } | null>
        import: (options: {
          inputs: string[]
          notebookId?: string
          includeAbstract?: boolean
          includeReferences?: boolean
          downloadFigures?: boolean
          preferHtml?: boolean
          buildEmbedding?: boolean
        }) => Promise<{
          success: boolean
          imported: number
          failed: number
          results: Array<{
            input: string
            noteId?: string
            title?: string
            error?: string
            source: 'html' | 'pdf'
          }>
        }>
        cancel: () => Promise<boolean>
        onProgress: (callback: (progress: {
          current: number
          total: number
          currentPaper: {
            paperId: string
            stage: string
            message: string
            percent: number
          }
        }) => void) => () => void
      }
      appData: {
        getPath: () => Promise<string>
        openPath: () => Promise<string>
      }
      importInline: {
        selectMarkdown: () => Promise<{ content: string; path: string } | null>
        selectAndParsePdf: () => Promise<{ content: string; path: string } | null>
        arxiv: (arxivId: string) => Promise<{ content: string; title: string }>
      }
      agentTask: {
        get: (id: string) => Promise<unknown | null>
        getByBlockId: (blockId: string) => Promise<unknown | null>
        create: (input: unknown) => Promise<unknown>
        update: (id: string, updates: unknown) => Promise<unknown | null>
        delete: (id: string) => Promise<boolean>
        deleteByBlockId: (blockId: string) => Promise<boolean>
      }
      templates: {
        getAll: () => Promise<Array<{
          id: string
          name: string
          description: string
          content: string
          icon: string
          isDailyDefault: boolean
          orderIndex: number
          createdAt: string
          updatedAt: string
        }>>
        get: (id: string) => Promise<{
          id: string
          name: string
          description: string
          content: string
          icon: string
          isDailyDefault: boolean
          orderIndex: number
          createdAt: string
          updatedAt: string
        } | null>
        getDailyDefault: () => Promise<{
          id: string
          name: string
          description: string
          content: string
          icon: string
          isDailyDefault: boolean
          orderIndex: number
          createdAt: string
          updatedAt: string
        } | null>
        create: (input: {
          name: string
          description?: string
          content: string
          icon?: string
          isDailyDefault?: boolean
        }) => Promise<{
          id: string
          name: string
          description: string
          content: string
          icon: string
          isDailyDefault: boolean
          orderIndex: number
          createdAt: string
          updatedAt: string
        }>
        update: (id: string, updates: {
          name?: string
          description?: string
          content?: string
          icon?: string
          isDailyDefault?: boolean
        }) => Promise<{
          id: string
          name: string
          description: string
          content: string
          icon: string
          isDailyDefault: boolean
          orderIndex: number
          createdAt: string
          updatedAt: string
        } | null>
        delete: (id: string) => Promise<boolean>
        reorder: (orderedIds: string[]) => Promise<void>
        setDailyDefault: (id: string | null) => Promise<void>
        reset: () => Promise<void>
      }
      markdown: {
        toTiptap: (markdown: string) => Promise<string>
      }
      agent: {
        list: () => Promise<Array<{ id: string; name: string; description?: string }>>
        run: (
          taskId: string,
          agentId: string,
          agentName: string,
          content: string,
          additionalPrompt?: string,
          outputContext?: {
            targetBlockId: string
            blockIds?: string[]
            pageId: string
            notebookId: string | null
            processMode: 'append' | 'replace'
            outputFormat?: 'auto' | 'paragraph' | 'list' | 'table' | 'code' | 'quote'
            executionContext?: {
              sourceApp?: string
              noteId?: string | null
              noteTitle?: string | null
              notebookId?: string | null
              notebookName?: string | null
              heading?: string | null
            }
          }
        ) => Promise<void>
        cancel: (taskId: string) => Promise<boolean>
        onEvent: (callback: (taskId: string, event: {
          type: 'start' | 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'phase'
          content?: string
          toolName?: string
          toolArgs?: Record<string, unknown>
          result?: unknown
          error?: string
          phase?: 'content' | 'editor'
        }) => void) => () => void
        onInsertOutput: (callback: (data: {
          taskId: string
          context: {
            targetBlockId: string
            blockIds?: string[]
            pageId: string
            notebookId: string | null
            processMode: 'append' | 'replace'
            outputBlockId: string | null
          }
          operations: Array<{
            type: 'paragraph' | 'list' | 'table' | 'html' | 'heading' | 'codeBlock' | 'blockquote' | 'noteRef'
            content: unknown
          }>
        }) => void) => () => void
      }
      chatWindow: {
        show: () => Promise<void>
        showWithContext: (context: string) => Promise<void>
        hide: () => Promise<void>
        toggle: () => Promise<void>
        isVisible: () => Promise<boolean>
      }
      context: {
        sync: (context: {
          currentNotebookId: string | null
          currentNotebookName: string | null
          currentNoteId: string | null
          currentNoteTitle: string | null
        }) => Promise<void>
        get: () => Promise<{ context: string }>
      }
    }
    api: unknown
  }
}
