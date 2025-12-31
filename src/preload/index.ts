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
    // 笔记失焦时触发增量索引检查
    checkIndex: (noteId: string, notebookId: string, content: string) =>
      ipcRenderer.invoke('note:checkIndex', noteId, notebookId, content),
    onDataChanged: (callback: () => void) => {
      ipcRenderer.on('data:changed', callback)
      return () => ipcRenderer.removeListener('data:changed', callback)
    },
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
  },
  platform: {
    get: () => ipcRenderer.invoke('platform:get'),
  },
  window: {
    setFullScreen: (isFullScreen: boolean) => ipcRenderer.invoke('window:setFullScreen', isFullScreen),
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    setTitleBarOverlay: (options: { color: string; symbolColor: string }) =>
      ipcRenderer.invoke('window:setTitleBarOverlay', options),
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
    open: (popupId: string, options?: {
      x?: number
      y?: number
      width?: number
      height?: number
      prompt?: string
      context?: { targetText: string; documentTitle?: string }
    }) => ipcRenderer.invoke('popup:open', popupId, options),
    close: (popupId: string) => ipcRenderer.invoke('popup:close', popupId),
    focus: (popupId: string) => ipcRenderer.invoke('popup:focus', popupId),
    updateContent: (popupId: string, content: string) => ipcRenderer.invoke('popup:updateContent', popupId, content),
    exists: (popupId: string) => ipcRenderer.invoke('popup:exists', popupId),
    onClosed: (callback: (popupId: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, popupId: string) => callback(popupId)
      ipcRenderer.on('popup:closed', handler)
      return () => ipcRenderer.removeListener('popup:closed', handler)
    },
    onContentRequest: (callback: (popupId: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, popupId: string) => callback(popupId)
      ipcRenderer.on('popup:contentRequest', handler)
      return () => ipcRenderer.removeListener('popup:contentRequest', handler)
    },
    // 用于 popup 窗口接收内容更新
    onContentUpdate: (callback: (content: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, content: string) => callback(content)
      ipcRenderer.on('popup:contentUpdate', handler)
      return () => ipcRenderer.removeListener('popup:contentUpdate', handler)
    },
    // 接着对话 - 在主窗口打开聊天
    continueInChat: (selectedText: string, explanation: string) =>
      ipcRenderer.invoke('popup:continueInChat', selectedText, explanation),
    // 监听接着对话事件（主窗口使用）
    onContinueInChat: (callback: (selectedText: string, explanation: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, selectedText: string, explanation: string) =>
        callback(selectedText, explanation)
      ipcRenderer.on('popup:openChatWithContext', handler)
      return () => ipcRenderer.removeListener('popup:openChatWithContext', handler)
    },
  },
  chat: {
    // Connection management
    connect: () => ipcRenderer.invoke('chat:connect'),
    disconnect: () => ipcRenderer.invoke('chat:disconnect'),
    // Auto-reconnect control (reference counted)
    acquireReconnect: () => ipcRenderer.invoke('chat:acquireReconnect'),
    releaseReconnect: () => ipcRenderer.invoke('chat:releaseReconnect'),
    // Chat streaming
    stream: (params: unknown) => ipcRenderer.invoke('chat:stream', params),
    cancelStream: (params: unknown) => ipcRenderer.invoke('chat:cancelStream', params),
    // Conversation management
    listConversations: (params: unknown) => ipcRenderer.invoke('chat:listConversations', params),
    getConversation: (params: unknown) => ipcRenderer.invoke('chat:getConversation', params),
    deleteConversation: (params: unknown) => ipcRenderer.invoke('chat:deleteConversation', params),
    // Human-in-the-loop
    sendHitlResponse: (params: unknown) => ipcRenderer.send('chat:hitlResponse', params),
    // Event listeners
    onStatusChange: (callback: (...args: unknown[]) => void) => {
      const handler = (_event: unknown, ...args: unknown[]) => callback(...args)
      ipcRenderer.on('chat:statusChange', handler)
      return () => ipcRenderer.removeListener('chat:statusChange', handler)
    },
    onStreamEvent: (callback: (...args: unknown[]) => void) => {
      const handler = (_event: unknown, ...args: unknown[]) => {
        console.log('[Preload] Received streamEvent, args:', args.length, 'first arg:', args[0])
        callback(...args)
      }
      ipcRenderer.on('chat:streamEvent', handler)
      return () => ipcRenderer.removeListener('chat:streamEvent', handler)
    },
  },
})
