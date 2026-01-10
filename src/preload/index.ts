import { contextBridge, ipcRenderer } from 'electron'

// Expose APIs to renderer
contextBridge.exposeInMainWorld('electron', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    getStatus: () => ipcRenderer.invoke('updater:getStatus'),
    onStatus: (callback: (status: { status: string; version: string | null; progress: number; error: string | null }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, status: { status: string; version: string | null; progress: number; error: string | null }) => callback(status)
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    }
  },
  note: {
    getAll: () => ipcRenderer.invoke('note:getAll'),
    getById: (id: string) => ipcRenderer.invoke('note:getById', id),
    getByIds: (ids: string[]) => ipcRenderer.invoke('note:getByIds', ids),
    add: (note: unknown) => ipcRenderer.invoke('note:add', note),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('note:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('note:delete', id),
    search: (query: string) => ipcRenderer.invoke('note:search', query),
    createDemo: () => ipcRenderer.invoke('note:createDemo'),
    // 笔记失焦时触发增量索引检查（摘要由 indexing-service 根据 chunk 变化率自动触发）
    checkIndex: (noteId: string, notebookId: string, content: string) =>
      ipcRenderer.invoke('note:checkIndex', noteId, notebookId, content),
    onDataChanged: (callback: () => void) => {
      ipcRenderer.on('data:changed', callback)
      return () => ipcRenderer.removeListener('data:changed', callback)
    },
    onSummaryUpdated: (callback: (noteId: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, noteId: string) => callback(noteId)
      ipcRenderer.on('summary:updated', handler)
      return () => ipcRenderer.removeListener('summary:updated', handler)
    },
  },
  daily: {
    getByDate: (date: string) => ipcRenderer.invoke('daily:getByDate', date),
    create: (date: string, title?: string) => ipcRenderer.invoke('daily:create', date, title),
  },
  trash: {
    getAll: () => ipcRenderer.invoke('trash:getAll'),
    restore: (id: string) => ipcRenderer.invoke('trash:restore', id),
    permanentDelete: (id: string) => ipcRenderer.invoke('trash:permanentDelete', id),
    empty: () => ipcRenderer.invoke('trash:empty'),
    cleanup: () => ipcRenderer.invoke('trash:cleanup'),
  },
  notebook: {
    getAll: () => ipcRenderer.invoke('notebook:getAll'),
    add: (notebook: unknown) => ipcRenderer.invoke('notebook:add', notebook),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('notebook:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('notebook:delete', id),
  },
  context: {
    sync: (context: {
      currentNotebookId: string | null
      currentNotebookName: string | null
      currentNoteId: string | null
      currentNoteTitle: string | null
    }) => ipcRenderer.invoke('context:sync', context),
    get: () => ipcRenderer.invoke('context:get') as Promise<{ context: string }>,
  },
  tag: {
    getAll: () => ipcRenderer.invoke('tag:getAll'),
    getByNote: (noteId: string) => ipcRenderer.invoke('tag:getByNote', noteId),
  },
  aiAction: {
    getAll: () => ipcRenderer.invoke('aiAction:getAll'),
    getAllIncludingDisabled: () => ipcRenderer.invoke('aiAction:getAllIncludingDisabled'),
    getById: (id: string) => ipcRenderer.invoke('aiAction:getById', id),
    create: (input: unknown) => ipcRenderer.invoke('aiAction:create', input),
    update: (id: string, updates: unknown) => ipcRenderer.invoke('aiAction:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('aiAction:delete', id),
    reorder: (orderedIds: string[]) => ipcRenderer.invoke('aiAction:reorder', orderedIds),
    reset: () => ipcRenderer.invoke('aiAction:reset'),
  },
  knowledgeBase: {
    getConfig: () => ipcRenderer.invoke('knowledgeBase:getConfig'),
    setConfig: (config: unknown) => ipcRenderer.invoke('knowledgeBase:setConfig', config),
    fetchFromSanqian: () => ipcRenderer.invoke('knowledgeBase:fetchFromSanqian'),
    testAPI: (config?: unknown) => ipcRenderer.invoke('knowledgeBase:testAPI', config),
    getStats: () => ipcRenderer.invoke('knowledgeBase:getStats'),
    clearIndex: () => ipcRenderer.invoke('knowledgeBase:clearIndex'),
    getQueueStatus: () => ipcRenderer.invoke('knowledgeBase:getQueueStatus'),
    rebuildIndex: () => ipcRenderer.invoke('knowledgeBase:rebuildIndex'),
    onProgress: (callback: (progress: { type: string; total?: number; current?: number; noteId?: string; error?: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, progress: { type: string; total?: number; current?: number; noteId?: string; error?: string }) => callback(progress)
      ipcRenderer.on('knowledgeBase:progress', handler)
      return () => ipcRenderer.removeListener('knowledgeBase:progress', handler)
    },
    semanticSearch: (query: string, options?: { limit?: number; notebookId?: string }) =>
      ipcRenderer.invoke('knowledgeBase:semanticSearch', query, options),
    hybridSearch: (query: string, options?: { limit?: number; notebookId?: string }) =>
      ipcRenderer.invoke('knowledgeBase:hybridSearch', query, options),
  },
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    onChange: (callback: (theme: 'light' | 'dark') => void) => {
      const handler = (_: Electron.IpcRendererEvent, theme: 'light' | 'dark') => callback(theme)
      ipcRenderer.on('theme:changed', handler)
      return () => ipcRenderer.removeListener('theme:changed', handler)
    },
    // Sync theme settings to main process (for chat window)
    sync: (settings: { colorMode: 'light' | 'dark'; accentColor: string; locale: 'en' | 'zh'; fontSize?: 'small' | 'normal' | 'large' | 'extra-large' }) =>
      ipcRenderer.invoke('theme:sync', settings),
  },
  platform: {
    get: () => ipcRenderer.invoke('platform:get'),
  },
  appSettings: {
    get: (key: string) => ipcRenderer.invoke('appSettings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('appSettings:set', key, value),
  },
  window: {
    setFullScreen: (isFullScreen: boolean) => ipcRenderer.invoke('window:setFullScreen', isFullScreen),
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    setTitleBarOverlay: (options: { color: string; symbolColor: string }) =>
      ipcRenderer.invoke('window:setTitleBarOverlay', options),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },
  attachment: {
    save: (filePath: string) => ipcRenderer.invoke('attachment:save', filePath),
    saveBuffer: (buffer: Uint8Array, ext: string, name?: string) =>
      ipcRenderer.invoke('attachment:saveBuffer', Buffer.from(buffer), ext, name),
    delete: (relativePath: string) => ipcRenderer.invoke('attachment:delete', relativePath),
    open: (relativePath: string) => ipcRenderer.invoke('attachment:open', relativePath),
    showInFolder: (relativePath: string) => ipcRenderer.invoke('attachment:showInFolder', relativePath),
    selectFiles: (options?: { filters?: { name: string; extensions: string[] }[]; multiple?: boolean }) =>
      ipcRenderer.invoke('attachment:selectFiles', options),
    selectImages: () => ipcRenderer.invoke('attachment:selectImages'),
    getFullPath: (relativePath: string) => ipcRenderer.invoke('attachment:getFullPath', relativePath),
    exists: (relativePath: string) => ipcRenderer.invoke('attachment:exists', relativePath),
    getAll: () => ipcRenderer.invoke('attachment:getAll'),
    cleanup: () => ipcRenderer.invoke('attachment:cleanup'),
  },
  popup: {
    // 接着对话 - 在主窗口打开聊天 (用于 hover 预览中的继续对话按钮)
    continueInChat: (selectedText: string, explanation: string) =>
      ipcRenderer.invoke('popup:continueInChat', selectedText, explanation),
    // 监听接着对话事件（主窗口使用）
    onContinueInChat: (callback: (selectedText: string, explanation: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, selectedText: string, explanation: string) =>
        callback(selectedText, explanation)
      ipcRenderer.on('popup:openChatWithContext', handler)
      return () => ipcRenderer.removeListener('popup:openChatWithContext', handler)
    },
    // Popup data storage (database)
    get: (id: string) => ipcRenderer.invoke('popup:get', id),
    create: (input: { id: string; prompt: string; actionName?: string; targetText: string; documentTitle?: string }) =>
      ipcRenderer.invoke('popup:create', input),
    updateContent: (id: string, content: string) => ipcRenderer.invoke('popup:updateContent', id, content),
    delete: (id: string) => ipcRenderer.invoke('popup:delete', id),
    cleanup: (maxAgeDays?: number) => ipcRenderer.invoke('popup:cleanup', maxAgeDays),
  },
  agentTask: {
    get: (id: string) => ipcRenderer.invoke('agentTask:get', id),
    getByBlockId: (blockId: string) => ipcRenderer.invoke('agentTask:getByBlockId', blockId),
    create: (input: {
      blockId: string
      pageId: string
      notebookId?: string | null
      content: string
      additionalPrompt?: string
      agentMode?: 'auto' | 'specified'
      agentId?: string
      agentName?: string
    }) => ipcRenderer.invoke('agentTask:create', input),
    update: (id: string, updates: Record<string, unknown>) => ipcRenderer.invoke('agentTask:update', id, updates),
    delete: (id: string) => ipcRenderer.invoke('agentTask:delete', id),
    deleteByBlockId: (blockId: string) => ipcRenderer.invoke('agentTask:deleteByBlockId', blockId),
  },
  // Agent execution API
  agent: {
    list: () => ipcRenderer.invoke('agent:list'),
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
      }
    ) =>
      ipcRenderer.invoke('agent:run', taskId, agentId, agentName, content, additionalPrompt, outputContext),
    cancel: (taskId: string) => ipcRenderer.invoke('agent:cancel', taskId),
    onEvent: (callback: (taskId: string, event: {
      type: 'start' | 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'phase' | 'editor_content'
      content?: string
      toolName?: string
      toolArgs?: Record<string, unknown>
      result?: unknown
      error?: string
      phase?: 'content' | 'editor'
    }) => void) => {
      const handler = (_: unknown, taskId: string, event: unknown) => callback(taskId, event as Parameters<typeof callback>[1])
      ipcRenderer.on('agent:event', handler)
      return () => {
        ipcRenderer.removeListener('agent:event', handler)
      }
    },
    // Listen for editor output insertion events
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
    }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: Parameters<typeof callback>[0]) => callback(data)
      ipcRenderer.on('editor:insert-output', handler)
      return () => ipcRenderer.removeListener('editor:insert-output', handler)
    },
  },
  chatWindow: {
    show: () => ipcRenderer.invoke('chatWindow:show'),
    showWithContext: (context: string) => ipcRenderer.invoke('chatWindow:showWithContext', context),
    hide: () => ipcRenderer.invoke('chatWindow:hide'),
    toggle: () => ipcRenderer.invoke('chatWindow:toggle'),
    isVisible: () => ipcRenderer.invoke('chatWindow:isVisible'),
  },
  // Chat API for AI actions (inline streaming in main window)
  // Only includes what AI actions need - FloatingWindow uses separate sanqian-chat:* handlers
  chat: {
    acquireReconnect: () => ipcRenderer.invoke('chat:acquireReconnect'),
    releaseReconnect: () => ipcRenderer.invoke('chat:releaseReconnect'),
    stream: (params: { streamId: string; messages: unknown[]; conversationId?: string; agentId?: string }) =>
      ipcRenderer.invoke('chat:stream', params),
    cancelStream: (params: { streamId: string }) => ipcRenderer.invoke('chat:cancelStream', params),
    onStreamEvent: (callback: (streamId: string, event: unknown) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { streamId: string; event: unknown }) =>
        callback(data.streamId, data.event)
      ipcRenderer.on('chat:streamEvent', handler)
      return () => ipcRenderer.removeListener('chat:streamEvent', handler)
    },
  },
  // Import/Export API
  importExport: {
    // 导入
    getImporters: () => ipcRenderer.invoke('import:getImporters'),
    detect: (sourcePath: string) => ipcRenderer.invoke('import:detect', sourcePath),
    preview: (options: unknown) => ipcRenderer.invoke('import:preview', options),
    execute: (options: unknown) => ipcRenderer.invoke('import:execute', options),
    selectSource: (importerId?: string) => ipcRenderer.invoke('import:selectSource', importerId),
    // 导出
    export: (options: unknown) => ipcRenderer.invoke('export:execute', options),
    selectTarget: () => ipcRenderer.invoke('export:selectTarget'),
  },
  // PDF Import API
  pdfImport: {
    // 服务配置
    getServices: () => ipcRenderer.invoke('pdf:getServices'),
    getConfig: () => ipcRenderer.invoke('pdf:getConfig'),
    setConfig: (config: unknown) => ipcRenderer.invoke('pdf:setConfig', config),
    getServiceConfig: (serviceId: string) => ipcRenderer.invoke('pdf:getServiceConfig', serviceId),
    setServiceConfig: (serviceId: string, config: Record<string, string>) =>
      ipcRenderer.invoke('pdf:setServiceConfig', serviceId, config),
    // 文件选择
    selectFiles: () => ipcRenderer.invoke('pdf:selectFiles'),
    // 导入
    import: (options: {
      pdfPaths: string[]
      serviceId: string
      serviceConfig: Record<string, string>
      targetNotebookId?: string
      importImages: boolean
    }) => ipcRenderer.invoke('pdf:import', options),
    // 取消导入
    cancel: () => ipcRenderer.invoke('pdf:cancel'),
    // 进度监听
    onProgress: (callback: (progress: {
      stage: string
      message: string
      currentFile?: number
      totalFiles?: number
      fileName?: string
      percent?: number
    }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) =>
        callback(progress)
      ipcRenderer.on('pdf:importProgress', handler)
      return () => ipcRenderer.removeListener('pdf:importProgress', handler)
    },
  },
  // App data path
  appData: {
    getPath: () => ipcRenderer.invoke('app:getDataPath'),
    openPath: () => ipcRenderer.invoke('app:openDataPath'),
  },
})
