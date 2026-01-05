import { app, shell, BaseWindow, WebContentsView, ipcMain, nativeTheme, screen, protocol, net, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import {
  initDatabase,
  closeDatabase,
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
  // AI Popups
  getPopup,
  createPopup,
  updatePopupContent,
  deletePopup,
  cleanupPopups,
  type PopupInput,
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
  getClient,
  getAssistantAgentId,
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
  checkModelConsistency,
  getIndexStats,
  clearAllIndexData,
  getLastIndexedTime,
  indexingService,
  getDimensionsForModel,
  type EmbeddingConfig,
} from './embedding'
import { fetchEmbeddingConfigFromSanqian } from './sanqian-sdk'
import { testEmbeddingAPI } from './embedding/api'
import { semanticSearch, hybridSearch } from './embedding/semantic-search'
import {
  getImporters,
  detectImporter,
  previewImport,
  executeImport,
  executeExport,
  type ImportOptions,
  type ExportOptions,
} from './import-export'
import {
  type Language,
  type ResolvedLanguage,
  translations
} from '../renderer/src/i18n/translations'
import { ChatPanel } from '@yushaw/sanqian-chat/main'

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

let mainWindow: BaseWindow | null = null
let mainView: WebContentsView | null = null
let tray: Tray | null = null
let isQuitting = false

// ============ Auto Updater State ============
type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'ready' | 'error'
let updateStatus: UpdateStatus = 'idle'
let updateVersion: string | null = null
let updateProgress = 0
let updateError: string | null = null

// ============ User Context for Agent ============
interface CursorContext {
  nearestHeading: string | null
  currentParagraph: string | null
}

interface UserContext {
  currentNotebookId: string | null
  currentNotebookName: string | null
  currentNoteId: string | null
  currentNoteTitle: string | null
  /** Block ID where cursor is located */
  currentBlockId: string | null
  /** Selected text (if any) */
  selectedText: string | null
  /** Cursor context with heading and paragraph info */
  cursorContext: CursorContext | null
}

let userContext: UserContext = {
  currentNotebookId: null,
  currentNotebookName: null,
  currentNoteId: null,
  currentNoteTitle: null,
  currentBlockId: null,
  selectedText: null,
  cursorContext: null,
}

/**
 * Get user context formatted for LLM (always in English, concise but with IDs)
 */
function getUserContext(): { context: string } {
  const { currentNotebookId, currentNotebookName, currentNoteId, currentNoteTitle, cursorContext } = userContext
  const parts: string[] = []

  if (currentNotebookId && currentNotebookName) {
    parts.push(`In notebook "${currentNotebookName}" (ID: ${currentNotebookId})`)
  } else {
    parts.push('Viewing all notes')
  }

  if (currentNoteId && currentNoteTitle) {
    parts.push(`editing "${currentNoteTitle}" (ID: ${currentNoteId})`)
  }

  // Add cursor context if available
  if (cursorContext) {
    if (cursorContext.nearestHeading) {
      parts.push(`under section "${cursorContext.nearestHeading}"`)
    }
    if (cursorContext.currentParagraph) {
      // Truncate long paragraphs
      const para = cursorContext.currentParagraph.length > 100
        ? cursorContext.currentParagraph.slice(0, 100) + '...'
        : cursorContext.currentParagraph
      parts.push(`at paragraph: "${para}"`)
    }
  }

  return { context: parts.join(', ') + '.' }
}

/**
 * Set user context from renderer
 */
function setUserContext(context: Partial<UserContext>): void {
  userContext = { ...userContext, ...context }
}

/**
 * Get raw user context (for context provider)
 */
export function getRawUserContext(): UserContext {
  return { ...userContext }
}

function sendUpdateStatus(): void {
  if (mainView && !mainView.webContents.isDestroyed()) {
    try {
      mainView.webContents.send('updater:status', {
        status: updateStatus,
        version: updateVersion,
        progress: updateProgress,
        error: updateError
      })
    } catch (err) {
      // Window may be closing, ignore send errors
      console.warn('[Updater] Failed to send status:', err)
    }
  }
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

// ============ ChatPanel for Chat ============
let chatPanel: ChatPanel | null = null

// ============ Theme Settings (synced from main window) ============
let currentThemeSettings: {
  colorMode: 'light' | 'dark'
  accentColor: string
  locale: 'en' | 'zh'
  fontSize?: 'small' | 'normal' | 'large' | 'extra-large'
} = {
  colorMode: 'light',
  accentColor: '#2563EB', // default cobalt
  locale: 'en',
  fontSize: 'normal'
}

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

function saveWindowState(win: BaseWindow): void {
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
    // Note: Use BaseWindow.getAllWindows() since mainWindow is BaseWindow, not BrowserWindow
    if (BaseWindow.getAllWindows().length === 0) {
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

  const isDarkMode = nativeTheme.shouldUseDarkColors
  // Use card colors to match content area (basePalettes.light.card / dark.card)
  const initialBgColor = isDarkMode ? '#1F1F1F' : '#FFFFFF'
  const initialTextColor = isDarkMode ? '#ffffff' : '#1D1D1F'

  // BaseWindow options (subset of BrowserWindow options)
  const windowOptions: Electron.BaseWindowConstructorOptions = {
    ...windowBounds,
    minWidth: 640,
    minHeight: 600,
    show: false, // Always start hidden, show after view is ready
    backgroundColor: initialBgColor,
  }

  // macOS specific options
  if (process.platform === 'darwin') {
    Object.assign(windowOptions, {
      frame: false,
      transparent: true,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
    })
  } else if (process.platform === 'win32') {
    Object.assign(windowOptions, {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: initialBgColor,
        symbolColor: initialTextColor,
        height: 40
      },
    })
  } else {
    Object.assign(windowOptions, {
      frame: true,
    })
  }

  // Create BaseWindow
  mainWindow = new BaseWindow(windowOptions)

  // Create WebContentsView for main content
  mainView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  // Add mainView to window
  mainWindow.contentView.addChildView(mainView)

  // Set initial bounds
  const { width, height } = mainWindow.getBounds()
  mainView.setBounds({ x: 0, y: 0, width, height })

  if (savedState.isMaximized && !isSilent) {
    mainWindow.maximize()
  }

  // Show window when content is ready
  mainView.webContents.on('did-finish-load', () => {
    if (!isSilent && mainWindow) {
      mainWindow.show()
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

  // Clear references when actually destroyed
  mainWindow.on('closed', () => {
    mainWindow = null
    mainView = null
  })

  // Save window state on resize (layout is handled by ChatPanel via onLayoutChange)
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

  // Handle external link opens
  mainView.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Handle context menu for WebContentsView (fix toggleDevTools error in dev mode)
  if (is.dev) {
    mainView.webContents.on('context-menu', (event, params) => {
      event.preventDefault()
      const menu = Menu.buildFromTemplate([
        {
          label: 'Inspect Element',
          click: () => {
            mainView?.webContents.inspectElement(params.x, params.y)
          }
        },
        {
          label: 'Toggle Developer Tools',
          click: () => {
            if (mainView?.webContents.isDevToolsOpened()) {
              mainView.webContents.closeDevTools()
            } else {
              mainView?.webContents.openDevTools({ mode: 'detach' })
            }
          }
        }
      ])
      menu.popup()
    })
  }

  // Load the app
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainView.webContents.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Set up data change notification callback for SDK
  const notifyRenderer = () => {
    mainView?.webContents.send('data:changed')
  }
  setOnSdkDataChange(notifyRenderer)

  // Set webContents for indexing service (for progress notifications)
  if (mainView) {
    indexingService.setWebContents(mainView.webContents)
  }
}

// ============ Embedding Config Sync ============

/**
 * Sync embedding config from Sanqian on startup
 *
 * If source is 'sanqian':
 * - Try to fetch config from Sanqian
 * - If successful, update local config
 * - If model changed, trigger rebuild
 *
 * Also checks model consistency and triggers rebuild if needed.
 */
async function syncEmbeddingConfigFromSanqian(): Promise<void> {
  try {
    const config = getEmbeddingConfig()

    // Only sync if source is 'sanqian' and enabled
    if (config.source !== 'sanqian' || !config.enabled) {
      console.log('[Main] Embedding source is not sanqian, skipping sync')
      return
    }

    console.log('[Main] Syncing embedding config from Sanqian...')

    // Try to fetch config from Sanqian
    const sanqianConfig = await fetchEmbeddingConfigFromSanqian()

    if (sanqianConfig?.available) {
      // Get dimensions from modelName
      const dimensions = sanqianConfig.dimensions || getDimensionsForModel(sanqianConfig.modelName || '')

      // Update local config with Sanqian's config
      const newConfig: EmbeddingConfig = {
        ...config,
        apiUrl: sanqianConfig.apiUrl || '',
        apiKey: sanqianConfig.apiKey || '',
        modelName: sanqianConfig.modelName || '',
        dimensions,
        // Determine apiType from apiUrl
        apiType: sanqianConfig.apiUrl?.includes('openai.com')
          ? 'openai'
          : sanqianConfig.apiUrl?.includes('bigmodel.cn')
            ? 'zhipu'
            : sanqianConfig.apiUrl?.includes('localhost')
              ? 'local'
              : 'custom',
      }

      const result = setEmbeddingConfig(newConfig)

      if (result.modelChanged) {
        console.log('[Main] Model changed, triggering rebuild...')
        // Clear and rebuild index
        clearAllIndexData()
        const notes = getNotes()
        indexingService.rebuildAllNotes(notes).catch(console.error)
      } else {
        console.log('[Main] Embedding config synced from Sanqian')
      }
    } else {
      console.log('[Main] Sanqian embedding not available, using cached config')

      // Check model consistency with cached config
      const consistency = checkModelConsistency()
      if (consistency.needsRebuild) {
        console.log(
          `[Main] Model mismatch detected (config: ${consistency.currentModel}, indexed: ${consistency.indexedModel}), triggering rebuild...`
        )
        clearAllIndexData()
        const notes = getNotes()
        indexingService.rebuildAllNotes(notes).catch(console.error)
      }
    }
  } catch (error) {
    console.error('[Main] Failed to sync embedding config:', error)
  }
}

// ============ App Lifecycle ============

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sanqian.notes')

  // Initialize language
  initializeLanguage()

  // Set custom application menu to fix toggleDevTools issue with WebContentsView
  if (is.dev) {
    const isMac = process.platform === 'darwin'
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(isMac ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' as const },
      { role: 'editMenu' as const },
      {
        label: 'View',
        submenu: [
          { role: 'reload' as const },
          { role: 'forceReload' as const },
          {
            label: 'Toggle Developer Tools (Main)',
            accelerator: 'Alt+CommandOrControl+I',
            click: () => mainView?.webContents?.openDevTools({ mode: 'detach' }),
          },
          {
            label: 'Toggle Developer Tools (Chat)',
            accelerator: 'Shift+CommandOrControl+I',
            click: () => chatPanel?.getWebContents()?.openDevTools({ mode: 'detach' }),
          },
          { type: 'separator' as const },
          { role: 'resetZoom' as const },
          { role: 'zoomIn' as const },
          { role: 'zoomOut' as const },
          { type: 'separator' as const },
          { role: 'togglefullscreen' as const },
        ],
      },
      { role: 'windowMenu' as const },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  // Note: This only triggers for BrowserWindow, not BaseWindow.
  // MainWindow (BaseWindow) won't get F12 shortcut - use View menu instead.
  // ChatPanel's floating window (BrowserWindow) will still trigger this.
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

  // Start indexing service (mainWindow is set in createWindow)
  indexingService.start()

  // Setup chatWindow IPC handlers (for main window to control chat window)
  // Note: ChatPanel is initialized after createWindow() below
  ipcMain.handle('chatWindow:show', () => {
    if (!chatPanel) {
      return { success: false, error: 'ChatPanel not initialized' }
    }
    chatPanel.show()
    return { success: true }
  })

  ipcMain.handle('chatWindow:showWithContext', (_, context: string) => {
    if (!chatPanel) {
      return { success: false, error: 'ChatPanel not initialized' }
    }
    try {
      chatPanel.show()
      // Send context after window is ready
      const webContents = chatPanel?.getWebContents()
      if (!webContents || webContents.isDestroyed()) {
        return { success: false, error: 'Chat window not available' }
      }

      if (webContents.isLoading()) {
        // Window is still loading, wait for it to finish
        webContents.once('did-finish-load', () => {
          if (!webContents.isDestroyed()) {
            try {
              webContents.send('chatWindow:setContext', context)
            } catch {
              // Window may have been destroyed during load
            }
          }
        })
      } else {
        // Window is already loaded, send immediately
        webContents.send('chatWindow:setContext', context)
      }
      return { success: true }
    } catch (err) {
      console.error('[ChatWindow] showWithContext failed:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  ipcMain.handle('chatWindow:hide', () => {
    if (!chatPanel) {
      return { success: false, error: 'ChatPanel not initialized' }
    }
    chatPanel.hide()
    return { success: true }
  })

  ipcMain.handle('chatWindow:toggle', () => {
    if (!chatPanel) {
      return { success: false, error: 'ChatPanel not initialized' }
    }
    chatPanel.toggle()
    return { success: true }
  })

  ipcMain.handle('chatWindow:isVisible', () => {
    return chatPanel?.isVisible() ?? false
  })

  // Theme sync: main window notifies theme changes, chat window retrieves settings
  ipcMain.handle('theme:sync', (_, settings: { colorMode: 'light' | 'dark'; accentColor: string; locale: 'en' | 'zh'; fontSize?: 'small' | 'normal' | 'large' | 'extra-large' }) => {
    currentThemeSettings = settings
    // Notify chat window if open
    const webContents = chatPanel?.getWebContents()
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('theme:updated', settings)
    }
    return { success: true }
  })

  ipcMain.handle('theme:getSettings', () => {
    return currentThemeSettings
  })

  // Note: chatPanel:* IPC handlers are registered by ChatPanel class internally

  // ============ Chat API for AI actions (main window inline streaming) ============
  // These handlers use SanqianAppClient directly for AI actions like popup explanations
  const activeStreams = new Map<string, { cancel: () => void }>()

  ipcMain.handle('chat:acquireReconnect', () => {
    acquireReconnect()
  })

  ipcMain.handle('chat:releaseReconnect', () => {
    releaseReconnect()
  })

  ipcMain.handle('chat:stream', async (event, params: {
    streamId: string
    messages: Array<{ role: string; content: string }>
    conversationId?: string
    agentId?: string
  }) => {
    const client = getClient()
    if (!client) {
      return { success: false, error: 'Client not initialized' }
    }

    try {
      // Ensure agent is ready (handles connection and agent sync)
      const agentType = params.agentId === 'writing' ? 'writing' : 'assistant'
      const { agentId } = await ensureAgentReady(agentType)

      // Track if cancelled
      let cancelled = false
      activeStreams.set(params.streamId, {
        cancel: () => { cancelled = true }
      })

      // Start streaming (AsyncGenerator)
      // Only pass options if conversationId is provided (stateful mode)
      // For stateless mode (AI actions), don't pass options at all
      const stream = params.conversationId
        ? client.chatStream(agentId, params.messages as Array<{ role: 'user' | 'assistant'; content: string }>, {
            conversationId: params.conversationId
          })
        : client.chatStream(agentId, params.messages as Array<{ role: 'user' | 'assistant'; content: string }>)

      // Process stream events in background
      ;(async () => {
        try {
          for await (const streamEvent of stream) {
            if (cancelled) break
            // Check if webContents is still valid before sending
            if (event.sender.isDestroyed()) {
              break
            }
            // Forward event to renderer
            event.sender.send('chat:streamEvent', { streamId: params.streamId, event: streamEvent })
          }
        } catch (err) {
          if (!cancelled && !event.sender.isDestroyed()) {
            event.sender.send('chat:streamEvent', {
              streamId: params.streamId,
              event: { type: 'error', error: err instanceof Error ? err.message : 'Stream error' }
            })
          }
        } finally {
          // Always clean up stream entry
          activeStreams.delete(params.streamId)
        }
      })()

      return { success: true }
    } catch (error) {
      // Clean up activeStreams if stream creation failed
      activeStreams.delete(params.streamId)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle('chat:cancelStream', (_, params: { streamId: string }) => {
    const stream = activeStreams.get(params.streamId)
    if (stream) {
      stream.cancel()
      activeStreams.delete(params.streamId)
      return { success: true }
    }
    return { success: false }
  })

  // Initialize Sanqian SDK
  initializeSanqianSDK()
    .then(async () => {
      // After SDK init, try to sync embedding config if source is 'sanqian'
      await syncEmbeddingConfigFromSanqian()
    })
    .catch((err) => {
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
    return addNote(note)
  })
  ipcMain.handle('note:update', (_, id, updates) => {
    return updateNote(id, updates)
  })
  // 笔记失焦时触发增量索引检查
  ipcMain.handle('note:checkIndex', async (_, noteId: string, notebookId: string, content: string) => {
    if (!getEmbeddingConfig().enabled) return false
    return indexingService.checkAndIndex(noteId, notebookId, content)
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

  // IPC handlers for user context (for agent tools)
  ipcMain.handle('context:sync', (_, context: Partial<UserContext>) => {
    setUserContext(context)
  })
  ipcMain.handle('context:get', () => getUserContext())

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

  // IPC handlers for AI popups
  ipcMain.handle('popup:get', (_, id: string) => getPopup(id))
  ipcMain.handle('popup:create', (_, input: PopupInput) => createPopup(input))
  ipcMain.handle('popup:updateContent', (_, id: string, content: string) => updatePopupContent(id, content))
  ipcMain.handle('popup:delete', (_, id: string) => deletePopup(id))
  ipcMain.handle('popup:cleanup', (_, maxAgeDays?: number) => cleanupPopups(maxAgeDays))

  // IPC handlers for knowledge base (embedding)
  ipcMain.handle('knowledgeBase:getConfig', () => getEmbeddingConfig())
  ipcMain.handle('knowledgeBase:setConfig', (_, config: EmbeddingConfig) => {
    const result = setEmbeddingConfig(config)
    return { success: true, indexCleared: result.indexCleared, modelChanged: result.modelChanged }
  })
  ipcMain.handle('knowledgeBase:fetchFromSanqian', async () => {
    const config = await fetchEmbeddingConfigFromSanqian()
    if (config?.available) {
      const dimensions = config.dimensions || getDimensionsForModel(config.modelName || '')
      return {
        success: true,
        config: {
          available: true,
          apiUrl: config.apiUrl,
          apiKey: config.apiKey,
          modelName: config.modelName,
          dimensions,
        },
      }
    }
    // config is null means timeout/error (likely Sanqian version too old)
    // config.available === false means Sanqian responded but embedding not configured
    if (config === null) {
      return { success: false, config: { available: false }, error: 'timeout' }
    }
    return { success: false, config: { available: false }, error: 'not_configured' }
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

  // ============ Import/Export ============
  ipcMain.handle('import:getImporters', () => getImporters())

  ipcMain.handle('import:detect', async (_, sourcePath: string) => {
    return detectImporter(sourcePath)
  })

  ipcMain.handle('import:preview', async (_, options: ImportOptions) => {
    return previewImport(options)
  })

  ipcMain.handle('import:execute', async (_, options: ImportOptions) => {
    const result = await executeImport(options)
    // 通知渲染进程数据已更新
    if (result.importedNotes.length > 0) {
      mainView?.webContents.send('data:changed')
    }
    return result
  })

  ipcMain.handle('export:execute', async (_, options: ExportOptions) => {
    return executeExport(options)
  })

  ipcMain.handle('import:selectSource', async (_, importerId?: string) => {
    const { dialog } = await import('electron')
    const importer = getImporters().find((i) => i.id === importerId) || getImporters()[0]

    const result = await dialog.showOpenDialog({
      properties: importer?.supportsFolder
        ? ['openFile', 'openDirectory']
        : ['openFile'],
      filters: importer?.fileFilters || [
        { name: 'Markdown files', extensions: ['md', 'markdown'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })

    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('export:selectTarget', async () => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })

    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:getDataPath', () => {
    return app.getPath('userData')
  })

  ipcMain.handle('app:openDataPath', async () => {
    const { shell } = await import('electron')
    return shell.openPath(app.getPath('userData'))
  })

  // Theme
  ipcMain.handle('theme:get', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  // Consolidated theme change listener (handles both renderer notification and Windows titlebar)
  nativeTheme.on('updated', () => {
    const dark = nativeTheme.shouldUseDarkColors
    // Notify renderer
    mainView?.webContents.send('theme:changed', dark ? 'dark' : 'light')
    // Update Windows titlebar overlay
    if (mainWindow && !mainWindow.isDestroyed() && process.platform === 'win32') {
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

  // Shell - open external URLs in default browser
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    // 安全检查：只允许 http/https/mailto 协议
    const allowedProtocols = ['http:', 'https:', 'mailto:']
    try {
      const urlObj = new URL(url)
      if (allowedProtocols.includes(urlObj.protocol)) {
        await shell.openExternal(url)
        return true
      }
    } catch {
      // 如果解析失败，可能是不带协议的域名，添加 https://
      if (/^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+$/.test(url)) {
        await shell.openExternal(`https://${url}`)
        return true
      }
    }
    return false
  })

  // 接着对话 - popup 预览调用，转发给主窗口
  ipcMain.handle('popup:continueInChat', (_, selectedText: string, explanation: string) => {
    if (mainWindow && mainView) {
      mainView.webContents.send('popup:openChatWithContext', selectedText, explanation)
      mainWindow.show()
      mainWindow.focus()
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

  // Setup ChatPanel for chat (using sanqian-chat package)
  // Note: Must be after createWindow() so mainWindow and mainView are available
  const chatPreloadPath = join(__dirname, '../preload/chat.js')
  const chatRendererPath = is.dev && process.env['ELECTRON_RENDERER_URL']
    ? `${process.env['ELECTRON_RENDERER_URL']}/chat.html`
    : join(__dirname, '../renderer/chat.html')
  const chatDevMode = is.dev && !!process.env['ELECTRON_RENDERER_URL']

  chatPanel = new ChatPanel({
    hostWindow: mainWindow!,
    hostMainView: mainView!, // Required for embedded mode
    initialMode: 'embedded', // Start in embedded mode (sidebar)
    position: 'right',
    width: 400,
    minHostContentWidth: 640, // Auto-expand window to ensure editor content is readable
    resizable: true,
    preloadPath: chatPreloadPath,
    rendererPath: chatRendererPath,
    devMode: chatDevMode,
    getClient: () => getClient(),
    getAgentId: () => getAssistantAgentId(),
    shortcuts: {
      toggle: 'CommandOrControl+Shift+Space',
      toggleMode: 'CommandOrControl+Shift+E', // Enable mode toggle
    },
    stateKey: 'sanqian-notes',
    // Layout change callback - update mainView bounds when chat panel is shown/hidden
    onLayoutChange: ({ mainWidth }) => {
      if (mainView && mainWindow) {
        const { height } = mainWindow.getBounds()
        mainView.setBounds({ x: 0, y: 0, width: mainWidth, height })
      }
    },
  })

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
  // Destroy chat panel before quitting
  chatPanel?.destroy()
  chatPanel = null
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
  // Close main database (ensures WAL checkpoint)
  closeDatabase()
  // Clean up SDK resources (fire and forget)
  stopSanqianSDK().catch((err) => {
    console.error('[Main] Failed to stop SDK:', err)
  })
})
