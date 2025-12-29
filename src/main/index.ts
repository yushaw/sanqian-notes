import { app, shell, BrowserWindow, ipcMain, nativeTheme, screen, protocol, net, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import {
  initDatabase,
  getNotes,
  getNoteById,
  getNotesByIds,
  addNote,
  updateNote,
  deleteNote,
  searchNotes,
  getNotebooks,
  addNotebook,
  updateNotebook,
  deleteNotebook,
  getTags,
  getTagsByNote,
  createDemoNote,
  // Trash operations
  getTrashNotes,
  restoreNote,
  permanentlyDeleteNote,
  emptyTrash,
  cleanupOldTrash,
  // Attachment references
  getUsedAttachmentPaths,
  // AI Actions
  getAIActions,
  getAllAIActions,
  getAIAction,
  createAIAction,
  updateAIAction,
  deleteAIAction,
  reorderAIActions,
  resetAIActionsToDefaults,
  type AIActionInput,
} from './database'
import {
  saveAttachment,
  saveAttachmentBuffer,
  deleteAttachment,
  openAttachment,
  showInFolder,
  selectFiles,
  selectImages,
  getFullPath,
  getUserDataPath,
  attachmentExists,
  getAllAttachments,
  cleanupOrphanAttachments,
} from './attachment'
import {
  initializeSanqianSDK,
  ensureAgentReady,
  acquireReconnect,
  releaseReconnect,
  setOnSdkDataChange,
  stopSanqianSDK,
} from './sanqian-sdk'
import {
  getSanqianApiUrl,
  startPortWatcher,
  stopPortWatcher,
} from './sanqian'
import {
  initVectorDatabase,
  closeVectorDatabase,
  getEmbeddingConfig,
  setEmbeddingConfig,
  getIndexStats,
  clearAllIndexData,
  getLastIndexedTime,
  indexingService,
  type EmbeddingConfig,
} from './embedding'
import { testEmbeddingAPI } from './embedding/api'
import { semanticSearch, hybridSearch } from './embedding/semantic-search'
import {
  type Language,
  type ResolvedLanguage,
  translations
} from '../renderer/src/i18n/translations'

// ============ Custom Protocol ============

// 注册 attachment:// 协议（必须在 app.whenReady 之前）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'attachment',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true, // 支持视频/音频流式播放
    },
  },
])

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// ============ Auto Updater State ============
type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'ready' | 'error'
let updateStatus: UpdateStatus = 'idle'
let updateVersion: string | null = null
let updateProgress = 0
let updateError: string | null = null

function sendUpdateStatus(): void {
  mainWindow?.webContents.send('updater:status', {
    status: updateStatus,
    version: updateVersion,
    progress: updateProgress,
    error: updateError
  })
}

function setupAutoUpdater(): void {
  // Don't check for updates in development
  if (is.dev) {
    console.log('Skipping auto-updater in development mode')
    return
  }

  // Configure auto-updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // Update available
  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version)
    updateStatus = 'available'
    updateVersion = info.version
    updateError = null
    sendUpdateStatus()
  })

  // No update available
  autoUpdater.on('update-not-available', () => {
    console.log('No update available')
    updateStatus = 'not-available'
    updateError = null
    sendUpdateStatus()
  })

  // Download progress
  autoUpdater.on('download-progress', (progressInfo) => {
    updateStatus = 'downloading'
    updateProgress = Math.round(progressInfo.percent)
    mainWindow?.setProgressBar(progressInfo.percent / 100)
    sendUpdateStatus()
  })

  // Update downloaded
  autoUpdater.on('update-downloaded', () => {
    console.log('Update downloaded')
    updateStatus = 'ready'
    updateProgress = 100
    mainWindow?.setProgressBar(-1)
    sendUpdateStatus()
  })

  // Error handling
  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
    updateStatus = 'error'
    updateError = err.message
    mainWindow?.setProgressBar(-1)
    sendUpdateStatus()
  })

  // Check for updates on startup
  updateStatus = 'checking'
  sendUpdateStatus()
  autoUpdater.checkForUpdates().catch((err) => {
    console.log('Auto-updater check failed:', err.message)
    updateStatus = 'error'
    updateError = err.message
    sendUpdateStatus()
  })
}

// ============ Active Streams Management ============
// Track active chat streams for cancellation support
interface ActiveStream {
  abortController: AbortController
  webContents: Electron.WebContents
}
const activeStreams = new Map<string, ActiveStream>()

// ============ Language Settings ============
let currentLanguage: Language = 'system'
let resolvedLanguage: ResolvedLanguage = 'en'

function getSystemLanguage(): ResolvedLanguage {
  const locale = app.getLocale().toLowerCase()
  if (locale.startsWith('zh')) return 'zh'
  return 'en'
}

function resolveLanguage(lang: Language): ResolvedLanguage {
  if (lang === 'system') {
    return getSystemLanguage()
  }
  return lang
}

function initializeLanguage(): void {
  // For now, use system language. Could load from settings file later
  currentLanguage = 'system'
  resolvedLanguage = resolveLanguage(currentLanguage)
}

function getTranslations() {
  return translations[resolvedLanguage]
}

// ============ Window State Persistence ============

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized?: boolean
}

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1200,
  height: 800
}

function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState {
  try {
    const statePath = getWindowStatePath()
    if (existsSync(statePath)) {
      const data = JSON.parse(readFileSync(statePath, 'utf-8'))
      if (typeof data.width === 'number' && typeof data.height === 'number') {
        return { ...DEFAULT_WINDOW_STATE, ...data }
      }
    }
  } catch {
    // Ignore errors
  }
  return DEFAULT_WINDOW_STATE
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const isMaximized = win.isMaximized()
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized
    }
    writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2))
  } catch {
    // Ignore errors
  }
}

function isWindowVisible(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) {
    return false
  }

  const displays = screen.getAllDisplays()
  const windowArea = state.width * state.height
  let visibleArea = 0

  for (const display of displays) {
    const { x: dx, y: dy, width: dw, height: dh } = display.bounds
    const left = Math.max(state.x, dx)
    const top = Math.max(state.y, dy)
    const right = Math.min(state.x + state.width, dx + dw)
    const bottom = Math.min(state.y + state.height, dy + dh)

    if (left < right && top < bottom) {
      visibleArea += (right - left) * (bottom - top)
    }
  }

  return visibleArea >= windowArea * 0.2
}

function getCenteredBoundsOnMouseDisplay(state: WindowState): { x: number; y: number } {
  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { x, y, width, height } = display.workArea

  return {
    x: Math.round(x + (width - state.width) / 2),
    y: Math.round(y + (height - state.height) / 2)
  }
}

// ============ Window Management ============

function showMainWindow(): void {
  if (!mainWindow) {
    // Create window if it doesn't exist
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()

  // Show dock icon on macOS
  if (process.platform === 'darwin') {
    app.dock?.show()
  }
}

function hideMainWindow(): void {
  if (!mainWindow) {
    return
  }

  mainWindow.hide()

  // Hide dock icon on macOS
  if (process.platform === 'darwin') {
    app.dock?.hide()
  }
}

// ============ System Tray ============

function getTrayIconPath(): string {
  // Platform-specific tray icons with dev/prod path handling
  if (process.platform === 'darwin') {
    // macOS: Template icons (system handles dark/light mode)
    if (is.dev) {
      return join(__dirname, '../../resources/icons/tray/trayTemplate.png')
    }
    // Production: files are copied to resources root
    return join(process.resourcesPath, 'trayTemplate.png')
  } else if (process.platform === 'win32') {
    // Windows: .ico file
    if (is.dev) {
      return join(__dirname, '../../resources/icons/tray/tray.ico')
    }
    // Production: files are copied to resources root
    return join(process.resourcesPath, 'tray-icon.ico')
  } else {
    // Linux: use 32x32 png
    if (is.dev) {
      return join(__dirname, '../../resources/icons/tray/tray_32x32.png')
    }
    return join(process.resourcesPath, 'tray-icon.png')
  }
}

function setupTray(): void {
  if (tray) {
    return
  }

  const iconPath = getTrayIconPath()

  // Check if icon exists
  if (!existsSync(iconPath)) {
    console.warn(`[Tray] Icon not found: ${iconPath}`)
    // Try fallback paths
    const fallbackPaths = process.platform === 'win32'
      ? [
          join(process.resourcesPath, 'tray-icon.ico'),
          join(__dirname, '../../resources/icons/tray/tray.ico'),
        ]
      : process.platform === 'darwin'
      ? [
          join(process.resourcesPath, 'trayTemplate.png'),
          join(__dirname, '../../resources/icons/tray/trayTemplate.png'),
        ]
      : [
          join(process.resourcesPath, 'tray-icon.png'),
          join(__dirname, '../../resources/icons/tray/tray_32x32.png'),
        ]

    for (const fallback of fallbackPaths) {
      if (existsSync(fallback)) {
        console.log(`[Tray] Found fallback: ${fallback}`)
        createTrayWithPath(fallback)
        return
      }
    }
    console.error('[Tray] No fallback paths found')
    return
  }

  createTrayWithPath(iconPath)
}

function createTrayWithPath(iconPath: string): void {
  try {
    // Use nativeImage for better cross-platform support
    const icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      console.error(`[Tray] nativeImage is empty for path: ${iconPath}`)
      return
    }

    // For Windows, resize to 16x16 for system tray
    const trayIcon = process.platform === 'win32' ? icon.resize({ width: 16, height: 16 }) : icon

    tray = new Tray(trayIcon)
    console.log('[Tray] Tray created successfully')
  } catch (error) {
    console.error(`[Tray] Failed to create tray: ${error}`)
    return
  }

  const t = getTranslations()
  const contextMenu = Menu.buildFromTemplate([
    {
      label: t.tray.show,
      click: () => showMainWindow()
    },
    { type: 'separator' },
    {
      label: t.tray.quit,
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setToolTip('Flow')

  // Left-click: show/activate window (both platforms)
  tray.on('click', () => showMainWindow())

  // Right-click: show context menu
  // On macOS, we handle right-click manually via 'right-click' event
  // On Windows, set context menu directly (right-click shows menu automatically)
  if (process.platform === 'darwin') {
    tray.on('right-click', () => {
      tray?.popUpContextMenu(contextMenu)
    })
  } else {
    tray.setContextMenu(contextMenu)
  }
}

// ============ Main Window ============

function createWindow(): void {
  // Check if launched in silent mode by Sanqian
  const isSilent = process.argv.includes('--silent') || process.env.SANQIAN_NO_RECONNECT === '1'
  if (isSilent) {
    console.log('[Main] Launched in silent mode (from Sanqian)')
  }

  const savedState = loadWindowState()

  let windowBounds: { x?: number; y?: number; width: number; height: number }
  if (isWindowVisible(savedState) && savedState.x !== undefined && savedState.y !== undefined) {
    windowBounds = {
      x: savedState.x,
      y: savedState.y,
      width: savedState.width,
      height: savedState.height
    }
  } else {
    const centered = getCenteredBoundsOnMouseDisplay(savedState)
    windowBounds = {
      x: centered.x,
      y: centered.y,
      width: savedState.width,
      height: savedState.height
    }
  }

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    ...windowBounds,
    minWidth: 800,
    minHeight: 600,
    show: !isSilent, // Don't show window immediately if launched silently
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }

  const isDarkMode = nativeTheme.shouldUseDarkColors
  // Use card colors to match content area (basePalettes.light.card / dark.card)
  const initialBgColor = isDarkMode ? '#1F1F1F' : '#FFFFFF'
  const initialTextColor = isDarkMode ? '#ffffff' : '#1D1D1F'

  // Listen for theme changes to update titlebar overlay
  nativeTheme.on('updated', () => {
    if (mainWindow && process.platform === 'win32') {
      const dark = nativeTheme.shouldUseDarkColors
      try {
        mainWindow.setTitleBarOverlay({
          color: dark ? '#1F1F1F' : '#FFFFFF',
          symbolColor: dark ? '#ffffff' : '#1D1D1F',
          height: 40
        })
      } catch (err) {
        console.error('Failed to update title bar overlay on theme change:', err)
      }
    }
  })

  // macOS specific options
  if (process.platform === 'darwin') {
    Object.assign(windowOptions, {
      frame: false,
      transparent: true, // 修复深色模式下顶部白线问题
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      backgroundColor: initialBgColor
    })
  } else if (process.platform === 'win32') {
    Object.assign(windowOptions, {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: initialBgColor,
        symbolColor: initialTextColor,
        height: 40
      },
      backgroundColor: initialBgColor
    })
  } else {
    Object.assign(windowOptions, {
      frame: true,
      backgroundColor: initialBgColor
    })
  }

  mainWindow = new BrowserWindow(windowOptions)

  if (savedState.isMaximized && !isSilent) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    // Only show window automatically if not in silent mode
    if (!isSilent) {
      mainWindow?.show()
    }
  })

  // Save window state on close and hide to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (mainWindow) {
      saveWindowState(mainWindow)
      // If not actually quitting, hide to tray instead
      if (!isQuitting) {
        event.preventDefault()
        hideMainWindow()
      }
    }
  })

  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isMaximized()) {
      saveWindowState(mainWindow)
    }
  })

  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isMaximized()) {
      saveWindowState(mainWindow)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Set up data change notification callback for SDK
  const notifyRenderer = () => {
    mainWindow?.webContents.send('data:changed')
  }
  setOnSdkDataChange(notifyRenderer)
}

// ============ App Lifecycle ============

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sanqian.notes')

  // Initialize language
  initializeLanguage()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 注册 attachment:// 协议处理器
  protocol.handle('attachment', (request) => {
    try {
      const relativePath = decodeURIComponent(request.url.replace('attachment://', ''))

      // 安全检查：防止目录遍历攻击（getFullPath 会抛出异常）
      const fullPath = getFullPath(relativePath)
      const userData = getUserDataPath()
      if (!fullPath.startsWith(userData)) {
        return new Response('Forbidden', { status: 403 })
      }

      // 返回文件
      return net.fetch(pathToFileURL(fullPath).toString())
    } catch (error) {
      console.error('Attachment protocol error:', error)
      return new Response('Bad Request', { status: 400 })
    }
  })

  // Initialize database
  initDatabase()

  // Initialize vector database for knowledge base
  initVectorDatabase()

  // Initialize and start indexing service
  indexingService.setMainWindow(mainWindow!)
  indexingService.start()

  // Initialize Sanqian SDK
  initializeSanqianSDK().catch((err) => {
    console.error('[Main] Failed to initialize Sanqian SDK:', err)
  })

  // Start port watcher
  startPortWatcher((port) => {
    console.log('[Main] Sanqian port changed:', port)
  })

  // IPC handlers for note operations
  ipcMain.handle('note:getAll', () => getNotes())
  ipcMain.handle('note:getById', (_, id) => getNoteById(id))
  ipcMain.handle('note:getByIds', (_, ids: string[]) => getNotesByIds(ids))
  ipcMain.handle('note:add', (_, note) => {
    const result = addNote(note)
    // Trigger indexing for new note
    if (result && getEmbeddingConfig().enabled) {
      indexingService.markPending(result.id, result.notebook_id || '', result.content)
    }
    return result
  })
  ipcMain.handle('note:update', (_, id, updates) => {
    const result = updateNote(id, updates)
    // Trigger indexing if content changed
    if (result && updates.content && getEmbeddingConfig().enabled) {
      indexingService.markPending(result.id, result.notebook_id || '', result.content)
    }
    return result
  })
  ipcMain.handle('note:delete', (_, id) => {
    const result = deleteNote(id)
    // Clean up index data
    if (result) {
      indexingService.deleteNoteIndex(id)
    }
    return result
  })
  ipcMain.handle('note:search', (_, query) => searchNotes(query))
  ipcMain.handle('note:createDemo', () => createDemoNote())

  // IPC handlers for trash operations
  ipcMain.handle('trash:getAll', () => getTrashNotes())
  ipcMain.handle('trash:restore', (_, id) => restoreNote(id))
  ipcMain.handle('trash:permanentDelete', (_, id) => permanentlyDeleteNote(id))
  ipcMain.handle('trash:empty', () => emptyTrash())
  ipcMain.handle('trash:cleanup', () => cleanupOldTrash())

  // IPC handlers for notebook operations
  ipcMain.handle('notebook:getAll', () => getNotebooks())
  ipcMain.handle('notebook:add', (_, notebook) => addNotebook(notebook))
  ipcMain.handle('notebook:update', (_, id, updates) => updateNotebook(id, updates))
  ipcMain.handle('notebook:delete', (_, id) => deleteNotebook(id))

  // IPC handlers for tag operations
  ipcMain.handle('tag:getAll', () => getTags())
  ipcMain.handle('tag:getByNote', (_, noteId) => getTagsByNote(noteId))

  // IPC handlers for AI actions
  ipcMain.handle('aiAction:getAll', () => getAIActions())
  ipcMain.handle('aiAction:getAllIncludingDisabled', () => getAllAIActions())
  ipcMain.handle('aiAction:getById', (_, id: string) => getAIAction(id))
  ipcMain.handle('aiAction:create', (_, input: AIActionInput) => createAIAction(input))
  ipcMain.handle('aiAction:update', (_, id: string, updates: Partial<AIActionInput> & { enabled?: boolean }) =>
    updateAIAction(id, updates)
  )
  ipcMain.handle('aiAction:delete', (_, id: string) => deleteAIAction(id))
  ipcMain.handle('aiAction:reorder', (_, orderedIds: string[]) => reorderAIActions(orderedIds))
  ipcMain.handle('aiAction:reset', () => resetAIActionsToDefaults())

  // IPC handlers for knowledge base (embedding)
  ipcMain.handle('knowledgeBase:getConfig', () => getEmbeddingConfig())
  ipcMain.handle('knowledgeBase:setConfig', (_, config: EmbeddingConfig) => {
    const result = setEmbeddingConfig(config)
    return { success: true, indexCleared: result.indexCleared }
  })
  ipcMain.handle('knowledgeBase:testAPI', async (_, config?: EmbeddingConfig) => {
    return testEmbeddingAPI(config)
  })
  ipcMain.handle('knowledgeBase:getStats', () => {
    const stats = getIndexStats()
    const lastIndexedTime = getLastIndexedTime()
    return { ...stats, lastIndexedTime }
  })
  ipcMain.handle('knowledgeBase:clearIndex', () => {
    clearAllIndexData()
    return { success: true }
  })
  ipcMain.handle('knowledgeBase:getQueueStatus', () => {
    return indexingService.getQueueStatus()
  })
  ipcMain.handle('knowledgeBase:rebuildIndex', async () => {
    const notes = getNotes()
    const total = notes.length
    // 异步执行，不等待完成，让前端通过 onProgress 监听进度
    indexingService.rebuildAllNotes(notes).catch(console.error)
    return { success: true, total }
  })
  ipcMain.handle('knowledgeBase:semanticSearch', async (_, query: string, options?: { limit?: number; notebookId?: string }) => {
    return semanticSearch(query, options)
  })
  ipcMain.handle('knowledgeBase:hybridSearch', async (_, query: string, options?: { limit?: number; notebookId?: string }) => {
    return hybridSearch(query, options)
  })

  // IPC handlers for attachment operations
  ipcMain.handle('attachment:save', (_, filePath: string) => saveAttachment(filePath))
  ipcMain.handle('attachment:saveBuffer', (_, buffer: Buffer, ext: string, name?: string) =>
    saveAttachmentBuffer(buffer, ext, name)
  )
  ipcMain.handle('attachment:delete', (_, relativePath: string) => deleteAttachment(relativePath))
  ipcMain.handle('attachment:open', (_, relativePath: string) => openAttachment(relativePath))
  ipcMain.handle('attachment:showInFolder', (_, relativePath: string) => showInFolder(relativePath))
  ipcMain.handle('attachment:selectFiles', (_, options?: { filters?: { name: string; extensions: string[] }[]; multiple?: boolean }) =>
    selectFiles(options)
  )
  ipcMain.handle('attachment:selectImages', () => selectImages())
  ipcMain.handle('attachment:getFullPath', (_, relativePath: string) => getFullPath(relativePath))
  ipcMain.handle('attachment:exists', (_, relativePath: string) => attachmentExists(relativePath))
  ipcMain.handle('attachment:getAll', () => getAllAttachments())
  ipcMain.handle('attachment:cleanup', async () => {
    const usedPaths = getUsedAttachmentPaths()
    return cleanupOrphanAttachments(usedPaths)
  })

  // ============ Chat IPC Handlers ============
  //
  // Connection management follows TodoList's pattern:
  // - connect/disconnect: control actual SDK connection
  // - acquireReconnect/releaseReconnect: control auto-reconnect behavior (reference counted)
  //
  // Usage pattern:
  // 1. When chat dialog opens: acquireReconnect() → connect()
  // 2. When chat dialog closes: releaseReconnect() (connection stays alive)
  // 3. Multiple components can acquire reconnect, SDK only disables auto-reconnect when all release

  // Connect to Sanqian SDK and ensure agent is ready
  ipcMain.handle('chat:connect', async () => {
    try {
      await ensureAgentReady('assistant')
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect'
      }
    }
  })

  // Disconnect from Sanqian SDK (no-op by design)
  // Connection management is handled via acquireReconnect/releaseReconnect reference counting
  // This handler exists for API completeness and future extensibility
  ipcMain.handle('chat:disconnect', async () => {
    try {
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disconnect'
      }
    }
  })

  // Enable auto-reconnect (increments reference count)
  ipcMain.handle('chat:acquireReconnect', () => {
    try {
      acquireReconnect()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to acquire reconnect'
      }
    }
  })

  // Disable auto-reconnect (decrements reference count)
  ipcMain.handle('chat:releaseReconnect', () => {
    try {
      releaseReconnect()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to release reconnect'
      }
    }
  })

  // Chat: Stream
  ipcMain.handle('chat:stream', async (event, params: {
    streamId: string
    messages: Array<{ role: string; content: string }>
    conversationId?: string
    agentId?: string
  }) => {
    const webContents = event.sender
    const { streamId, messages, conversationId } = params
    console.log(`[Chat] Stream request received:`, streamId)

    // Cancel any existing stream with the same ID
    const existingStream = activeStreams.get(streamId)
    if (existingStream) {
      console.log(`[Chat] Cancelling existing stream ${streamId}`)
      existingStream.abortController.abort()
      activeStreams.delete(streamId)
    }

    // Create abort controller for this stream
    const abortController = new AbortController()
    activeStreams.set(streamId, { abortController, webContents })

    try {
      // Determine which agent to use (default to assistant)
      const agentType = params.agentId?.includes('writing') ? 'writing' : 'assistant'
      console.log(`[Chat] Getting agent:`, agentType)
      const { sdk, agentId } = await ensureAgentReady(agentType)
      console.log(`[Chat] Agent ready:`, agentId)

      // Start streaming
      // Note: SDK's chatStream doesn't support AbortSignal, so we check manually in the loop
      console.log(`[Chat] Starting chatStream for:`, streamId)
      const stream = sdk.chatStream(
        agentId,
        messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        conversationId ? { conversationId } : undefined
      )
      console.log(`[Chat] Stream created, entering event loop`)

      // Forward events to renderer
      let eventCount = 0
      for await (const streamEvent of stream) {
        eventCount++
        if (eventCount % 10 === 1) {
          console.log(`[Chat] Stream event #${eventCount}:`, streamEvent.type)
        }
        // Check if stream was cancelled
        if (abortController.signal.aborted) {
          console.log(`[Chat] Stream ${streamId} cancelled by user`)
          // Send cancellation event to renderer
          if (!webContents.isDestroyed()) {
            webContents.send('chat:streamEvent', streamId, {
              type: 'done',
              reason: 'cancelled'
            })
          }
          break
        }

        // Check if webContents is still valid before sending
        if (!webContents.isDestroyed()) {
          // Convert SDK format to standard StreamEvent format
          // SDK sends: { type: "chat_stream", event: "thinking", content: "..." }
          // We need: { type: "thinking", content: "..." }
          const sdkEvent = streamEvent as any
          let convertedEvent: any

          if (sdkEvent.type === 'chat_stream' && sdkEvent.event) {
            // Extract event type from SDK format
            convertedEvent = { ...sdkEvent, type: sdkEvent.event }
            delete convertedEvent.event
            delete convertedEvent.id // Remove SDK message id
          } else {
            // Already in standard format (done, error, etc.)
            convertedEvent = streamEvent
          }

          webContents.send('chat:streamEvent', streamId, convertedEvent)
          if (eventCount % 20 === 1) {
            console.log(`[Chat] Sent event to renderer:`, streamId, convertedEvent.type)
          }
        } else {
          console.log('[Chat] WebContents destroyed, aborting stream')
          // Actively abort the stream to stop iteration and free resources
          abortController.abort()
          activeStreams.delete(streamId)
          break
        }
      }

      // Clean up after stream completes
      activeStreams.delete(streamId)
      console.log(`[Chat] Stream ${streamId} completed successfully`)
      return { success: true }
    } catch (error) {
      // Clean up on error
      activeStreams.delete(streamId)

      // Build detailed error info
      const errorInfo = {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: (error as any).code,
        stack: is.dev ? (error instanceof Error ? error.stack : undefined) : undefined,
        name: error instanceof Error ? error.name : undefined,
      }
      console.error(`[Chat] Stream ${streamId} error:`, errorInfo)

      // Send error event to renderer (check if webContents is still valid)
      if (!webContents.isDestroyed()) {
        webContents.send('chat:streamEvent', streamId, {
          type: 'error',
          error: errorInfo.message,
          errorCode: errorInfo.code,
          errorName: errorInfo.name,
        })
      }

      return {
        success: false,
        error: errorInfo.message,
        errorCode: errorInfo.code,
        errorName: errorInfo.name,
        // Only include stack in development mode
        ...(is.dev && errorInfo.stack ? { stack: errorInfo.stack } : {}),
      }
    }
  })

  // Chat: Cancel Stream
  ipcMain.handle('chat:cancelStream', async (_, params: { streamId: string }) => {
    const stream = activeStreams.get(params.streamId)
    if (stream) {
      console.log(`[Chat] Cancelling stream ${params.streamId}`)
      stream.abortController.abort()
      activeStreams.delete(params.streamId)
      return { success: true }
    }
    // Stream not found or already completed
    return { success: true, message: 'Stream not found or already completed' }
  })

  // Chat: List Conversations
  ipcMain.handle('chat:listConversations', async (_, params: {
    limit?: number
    offset?: number
    agentId?: string
  }) => {
    try {
      const agentType = params.agentId?.includes('writing') ? 'writing' : 'assistant'
      const { sdk, agentId } = await ensureAgentReady(agentType)

      const result = await sdk.listConversations({
        agentId: agentId,
        limit: params.limit,
        offset: params.offset
      })

      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list conversations'
      }
    }
  })

  // Chat: Get Conversation
  ipcMain.handle('chat:getConversation', async (_, params: {
    conversationId: string
    messageLimit?: number
  }) => {
    try {
      // Always use assistant agent for conversation history
      const { sdk } = await ensureAgentReady('assistant')

      const result = await sdk.getConversation(params.conversationId, {
        messageLimit: params.messageLimit
      })

      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get conversation'
      }
    }
  })

  // Chat: Delete Conversation
  ipcMain.handle('chat:deleteConversation', async (_, params: { conversationId: string }) => {
    try {
      // Always use assistant agent for conversation deletion
      const { sdk } = await ensureAgentReady('assistant')

      await sdk.deleteConversation(params.conversationId)

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete conversation'
      }
    }
  })

  // Chat: Send HITL Response
  ipcMain.on('chat:hitlResponse', (_) => {
    // HITL response is handled by SDK automatically via the stream
    // This handler exists for future extensibility
  })

  // Theme
  ipcMain.handle('theme:get', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })

  // Platform info
  ipcMain.handle('platform:get', () => process.platform)

  // Sanqian API URL
  ipcMain.handle('sanqian:getApiUrl', () => getSanqianApiUrl())

  // Window control - fullscreen
  ipcMain.handle('window:setFullScreen', (_, isFullScreen: boolean) => {
    if (mainWindow) {
      mainWindow.setFullScreen(isFullScreen)
      return true
    }
    return false
  })

  ipcMain.handle('window:isFullScreen', () => {
    return mainWindow?.isFullScreen() ?? false
  })

  // Windows titlebar overlay - dynamic color update
  ipcMain.handle('window:setTitleBarOverlay', (_, options: { color: string; symbolColor: string }) => {
    if (process.platform === 'win32' && mainWindow) {
      try {
        mainWindow.setTitleBarOverlay({
          color: options.color,
          symbolColor: options.symbolColor,
          height: 40
        })
      } catch (err) {
        console.error('Failed to set title bar overlay:', err)
      }
    }
  })

  // App version
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  // Auto updater IPC handlers
  ipcMain.handle('updater:check', async () => {
    if (is.dev) {
      return { status: 'not-available' as UpdateStatus }
    }
    updateStatus = 'checking'
    updateError = null
    sendUpdateStatus()
    try {
      await autoUpdater.checkForUpdates()
      return { status: updateStatus, version: updateVersion }
    } catch (err) {
      updateStatus = 'error'
      updateError = err instanceof Error ? err.message : 'Unknown error'
      sendUpdateStatus()
      return { status: 'error', error: updateError }
    }
  })

  ipcMain.handle('updater:download', async () => {
    if (updateStatus !== 'available') {
      return { success: false, error: 'No update available' }
    }
    try {
      updateStatus = 'downloading'
      updateProgress = 0
      sendUpdateStatus()
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      updateStatus = 'error'
      updateError = err instanceof Error ? err.message : 'Unknown error'
      sendUpdateStatus()
      return { success: false, error: updateError }
    }
  })

  ipcMain.handle('updater:install', () => {
    if (updateStatus !== 'ready') {
      return { success: false, error: 'Update not ready' }
    }
    // Important: set isQuitting to prevent window close from being intercepted
    isQuitting = true
    autoUpdater.quitAndInstall()
    return { success: true }
  })

  ipcMain.handle('updater:getStatus', () => {
    return {
      status: updateStatus,
      version: updateVersion,
      progress: updateProgress,
      error: updateError
    }
  })

  createWindow()
  setupTray()
  setupAutoUpdater()

  // 启动 5 分钟后自动清理孤儿附件（不阻塞启动）
  setTimeout(async () => {
    try {
      const usedPaths = getUsedAttachmentPaths()
      const deleted = await cleanupOrphanAttachments(usedPaths)
      if (deleted > 0) {
        console.log(`[Attachment Cleanup] Deleted ${deleted} orphan attachment(s)`)
      }
    } catch (error) {
      console.error('[Attachment Cleanup] Failed:', error)
    }
  }, 5 * 60 * 1000) // 5 minutes

  app.on('activate', function () {
    // Show existing window or create a new one (macOS behavior)
    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  // Don't quit when all windows are closed - we stay in tray
  // Cleanup only happens when actually quitting via tray menu or Cmd+Q
})

app.on('will-quit', () => {
  stopPortWatcher()
  // Stop indexing service (sync cleanup)
  indexingService.stop()
  // Close vector database
  closeVectorDatabase()
  // Clean up SDK resources (fire and forget)
  stopSanqianSDK().catch((err) => {
    console.error('[Main] Failed to stop SDK:', err)
  })
})
