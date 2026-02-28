import type {
  AgentCapability,
  AgentExecutionContext,
  AgentTaskEvent,
  AgentTaskInput,
  AgentTaskRecord,
  AIAction,
  AIActionInput,
  AttachmentResult,
  AttachmentSelectOptions,
  AttachmentAPI,
  LocalFolderAnalyzeDeleteResponse,
  LocalFolderCreateFileInput,
  LocalFolderCreateFileResponse,
  LocalFolderCreateFolderInput,
  LocalFolderCreateFolderResponse,
  LocalFolderDeleteEntryInput,
  LocalFolderDeleteEntryResponse,
  LocalFolderMountInput,
  LocalFolderMountResponse,
  LocalFolderNotebookMount,
  LocalFolderReadFileInput,
  LocalFolderReadFileResponse,
  LocalFolderRelinkInput,
  LocalFolderRelinkResponse,
  LocalFolderRenameEntryInput,
  LocalFolderRenameEntryResponse,
  LocalFolderSaveFileInput,
  LocalFolderSaveFileResponse,
  LocalFolderSearchInput,
  LocalFolderSearchResponse,
  LocalFolderListNoteMetadataResponse,
  LocalFolderTreeResult,
  LocalFolderUpdateNoteMetadataInput,
  LocalFolderUpdateNoteMetadataResponse,
  LocalFolderWatchEvent,
  Note,
  Notebook,
  NotebookFolder,
  NotebookFolderCreateInput,
  NotebookFolderCreateResponse,
  NotebookFolderDeleteInput,
  NotebookFolderDeleteResponse,
  NotebookFolderRenameInput,
  NotebookFolderRenameResponse,
  NoteGetAllOptions,
  NoteInput,
  NotebookInput,
  NoteSearchFilter,
  NoteUpdateSafeResult,
  Tag,
  TagWithSource,
  Template,
  TemplateInput,
  ThemeSettings,
} from '../shared/types'

export {
  AttachmentResult,
  AttachmentSelectOptions,
  AttachmentAPI,
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
        getAll: (options?: NoteGetAllOptions) => Promise<Note[]>
        getById: (id: string) => Promise<Note | null>
        getByIds: (ids: string[]) => Promise<Note[]>
        add: (note: NoteInput) => Promise<Note>
        update: (id: string, updates: Partial<NoteInput>) => Promise<Note | null>
        updateSafe: (id: string, updates: Partial<NoteInput>, expectedRevision: number) => Promise<NoteUpdateSafeResult>
        delete: (id: string) => Promise<boolean>
        search: (query: string, filter?: NoteSearchFilter) => Promise<Note[]>
        createDemo: () => Promise<void>
        checkIndex: (noteId: string, notebookId: string, content: string) => Promise<boolean>
        onDataChanged: (callback: () => void) => () => void
        onSummaryUpdated: (callback: (noteId: string) => void) => () => void
        onNavigate: (callback: (data: { noteId: string; target?: { type: 'heading' | 'block'; value: string } }) => void) => () => void
      }
      daily: {
        getByDate: (date: string) => Promise<Note | null>
        create: (date: string, title?: string) => Promise<Note>
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
        reorder: (orderedIds: string[]) => Promise<void>
      }
      notebookFolder: {
        list: (notebookId?: string) => Promise<NotebookFolder[]>
        create: (input: NotebookFolderCreateInput) => Promise<NotebookFolderCreateResponse>
        rename: (input: NotebookFolderRenameInput) => Promise<NotebookFolderRenameResponse>
        delete: (input: NotebookFolderDeleteInput) => Promise<NotebookFolderDeleteResponse>
      }
      localFolder: {
        list: () => Promise<LocalFolderNotebookMount[]>
        getTree: (notebookId: string) => Promise<LocalFolderTreeResult | null>
        createFile: (input: LocalFolderCreateFileInput) => Promise<LocalFolderCreateFileResponse>
        createFolder: (input: LocalFolderCreateFolderInput) => Promise<LocalFolderCreateFolderResponse>
        renameEntry: (input: LocalFolderRenameEntryInput) => Promise<LocalFolderRenameEntryResponse>
        search: (input: LocalFolderSearchInput) => Promise<LocalFolderSearchResponse>
        listNoteMetadata: (input?: { notebook_ids?: string[] }) => Promise<LocalFolderListNoteMetadataResponse>
        updateNoteMetadata: (input: LocalFolderUpdateNoteMetadataInput) => Promise<LocalFolderUpdateNoteMetadataResponse>
        analyzeDelete: (input: LocalFolderDeleteEntryInput) => Promise<LocalFolderAnalyzeDeleteResponse>
        deleteEntry: (input: LocalFolderDeleteEntryInput) => Promise<LocalFolderDeleteEntryResponse>
        readFile: (input: LocalFolderReadFileInput) => Promise<LocalFolderReadFileResponse>
        saveFile: (input: LocalFolderSaveFileInput) => Promise<LocalFolderSaveFileResponse>
        selectRoot: () => Promise<string | null>
        mount: (input: LocalFolderMountInput) => Promise<LocalFolderMountResponse>
        relink: (input: LocalFolderRelinkInput) => Promise<LocalFolderRelinkResponse>
        openInFileManager: (notebookId: string) => Promise<boolean>
        unmount: (notebookId: string) => Promise<boolean>
        onChanged: (callback: (event: LocalFolderWatchEvent) => void) => () => void
      }
      context: {
        sync: (context: {
          currentNotebookId: string | null
          currentNotebookName: string | null
          currentNoteId: string | null
          currentNoteTitle: string | null
          currentBlockId?: string | null
          selectedText?: string | null
          cursorContext?: {
            nearestHeading: string | null
            currentParagraph: string | null
          } | null
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
        fetchRerankFromSanqian: () => Promise<{
          success: boolean
          config: {
            available: boolean
            apiUrl?: string
            apiKey?: string
            modelName?: string
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
      theme: {
        get: () => Promise<'light' | 'dark'>
        onChange: (callback: (theme: 'light' | 'dark') => void) => () => void
        sync: (settings: ThemeSettings) => Promise<{ success: boolean }>
      }
      platform: {
        get: () => Promise<NodeJS.Platform>
      }
      appSettings: {
        get: (key: string) => Promise<string | null>
        set: (key: string, value: string) => Promise<void>
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
      attachment: AttachmentAPI
      // Narrowed chat API -- only the subset needed for AI actions in main window.
      // FloatingWindow uses separate sanqian-chat:* handlers.
      chat: {
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
      popup: {
        continueInChat: (selectedText: string, explanation: string) => Promise<void>
        onContinueInChat: (callback: (selectedText: string, explanation: string) => void) => () => void
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
      chatWindow: {
        show: () => Promise<{ success: boolean }>
        showWithContext: (context: string) => Promise<{ success: boolean }>
        hide: () => Promise<{ success: boolean }>
        toggle: () => Promise<{ success: boolean }>
        isVisible: () => Promise<boolean>
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
        arxiv: (
          arxivId: string,
          options?: {
            includeAbstract?: boolean
            includeReferences?: boolean
            downloadFigures?: boolean
            preferHtml?: boolean
          }
        ) => Promise<{ content: string; title: string }>
      }
      agentTask: {
        get: (id: string) => Promise<AgentTaskRecord | null>
        getByBlockId: (blockId: string) => Promise<AgentTaskRecord | null>
        create: (input: AgentTaskInput) => Promise<AgentTaskRecord>
        update: (id: string, updates: Partial<AgentTaskRecord>) => Promise<AgentTaskRecord | null>
        delete: (id: string) => Promise<boolean>
        deleteByBlockId: (blockId: string) => Promise<boolean>
      }
      templates: {
        getAll: () => Promise<Template[]>
        get: (id: string) => Promise<Template | null>
        getDailyDefault: () => Promise<Template | null>
        create: (input: TemplateInput) => Promise<Template>
        update: (id: string, updates: Partial<TemplateInput>) => Promise<Template | null>
        delete: (id: string) => Promise<boolean>
        reorder: (orderedIds: string[]) => Promise<void>
        setDailyDefault: (id: string | null) => Promise<void>
        reset: () => Promise<void>
      }
      markdown: {
        toTiptap: (markdown: string) => Promise<string>
      }
      agent: {
        list: () => Promise<AgentCapability[]>
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
            executionContext?: AgentExecutionContext
          }
        ) => Promise<void>
        cancel: (taskId: string) => Promise<boolean>
        onEvent: (callback: (taskId: string, event: AgentTaskEvent) => void) => () => void
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
    }
    api: unknown
  }
}
