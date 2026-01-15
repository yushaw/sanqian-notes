/// <reference types="vite/client" />

// 从 shared/types 导入类型
type AgentTaskRecord = import('../../shared/types').AgentTaskRecord
type AgentTaskInput = import('../../shared/types').AgentTaskInput
type AgentExecutionContext = import('../../shared/types').AgentExecutionContext
type AttachmentResult = import('../../shared/types').AttachmentResult
type AttachmentSelectOptions = import('../../shared/types').AttachmentSelectOptions
type AttachmentAPI = import('../../shared/types').AttachmentAPI
type NoteSearchFilter = import('../../shared/types').NoteSearchFilter
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
type ThemeSettings = import('../../shared/types').ThemeSettings
type Template = import('../../shared/types').Template
type TemplateInput = import('../../shared/types').TemplateInput

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
      getAll: () => Promise<Note[]>
      getById: (id: string) => Promise<Note | null>
      getByIds: (ids: string[]) => Promise<Note[]>
      add: (note: NoteInput) => Promise<Note>
      update: (id: string, updates: Partial<NoteInput>) => Promise<Note | null>
      delete: (id: string) => Promise<boolean>
      search: (query: string, filter?: NoteSearchFilter) => Promise<Note[]>
      // 笔记失焦时触发增量索引检查（摘要由 indexing-service 根据 chunk 变化率自动触发）
      checkIndex: (noteId: string, notebookId: string, content: string) => Promise<boolean>
      onDataChanged: (callback: () => void) => () => void
      onSummaryUpdated: (callback: (noteId: string) => void) => () => void
      onNavigate: (callback: (data: { noteId: string; target?: { type: 'heading' | 'block'; value: string } }) => void) => () => void
    }
    trash: {
      getAll: () => Promise<Note[]>
      restore: (id: string) => Promise<boolean>
      permanentDelete: (id: string) => Promise<boolean>
      empty: () => Promise<number>
      cleanup: () => Promise<number>
    }
    daily: {
      getByDate: (date: string) => Promise<Note | null>
      create: (date: string, title?: string) => Promise<Note>
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
    theme: {
      get: () => Promise<'light' | 'dark'>
      onChange?: (callback: (theme: 'light' | 'dark') => void) => () => void
      sync?: (settings: ThemeSettings) => Promise<{ success: boolean }>
    }
    window: {
      setTitleBarOverlay?: (options: { color: string; symbolColor: string }) => void
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
}

// Agent types
interface AgentCapability {
  type: 'agent'
  id: string
  name: string
  description?: string
  source: 'builtin' | 'custom' | 'sdk'
  sourceId?: string
  icon?: string
  display?: { zh?: string; en?: string }
  shortDesc?: { zh?: string; en?: string }
}

interface AgentTaskEvent {
  type: 'start' | 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'phase' | 'editor_content'
  content?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  result?: unknown
  error?: string
  phase?: 'content' | 'editor'
}

// Note types are imported from shared/types
type Note = import('../../shared/types').Note
type NoteInput = import('../../shared/types').NoteInput
type Notebook = import('../../shared/types').Notebook
type NotebookInput = import('../../shared/types').NotebookInput
type Tag = import('../../shared/types').Tag
type TagWithSource = import('../../shared/types').TagWithSource
