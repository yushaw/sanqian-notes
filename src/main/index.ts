import { app, shell, BaseWindow, WebContentsView, ipcMain, nativeTheme, protocol, net, Tray, Menu, nativeImage, globalShortcut, dialog } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import {
  initDatabase,
  closeDatabase,
  getNoteById,
  addNote,
  updateNote,
  updateNoteSafe,
  deleteNote,
  searchNotes,
  getNotebooks,
  addNotebook,
  updateNotebook,
  deleteNotebook,
  reorderNotebooks,
  getNotebookFolders,
  hasNotebookFolderPathReference,
  createNotebookFolderEntry,
  renameNotebookFolderEntry,
  deleteNotebookFolderEntry,
  getLocalFolderMounts,
  getLocalFolderMountByCanonicalPath,
  getLocalFolderMountByNotebookId,
  createLocalFolderNotebookMount,
  updateLocalFolderMountRoot,
  updateLocalFolderMountStatus,
  listLocalNoteMetadata,
  getLocalNoteIdentityByPath,
  getLocalNoteIdentityByUid,
  updateLocalNoteMetadata,
  ensureLocalNoteIdentity,
  renameLocalNoteIdentityPath,
  renameLocalNoteIdentityFolderPath,
  deleteLocalNoteIdentityByPath,
  renameLocalNoteMetadataPath,
  renameLocalNoteMetadataFolderPath,
  deleteLocalNoteMetadataByPath,
  getTags,
  getTagsByNote,
  createDemoNote,
  // Daily notes
  getDailyByDate,
  createDaily,
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
  // AI Popups
  getPopup,
  createPopup,
  updatePopupContent,
  deletePopup,
  cleanupPopups,
  // Agent Tasks
  getAgentTask,
  getAgentTaskByBlockId,
  createAgentTask,
  updateAgentTask,
  deleteAgentTask,
  deleteAgentTaskByBlockId,
  // App Settings
  getAppSetting,
  setAppSetting,
  // Templates
  getAllTemplates,
  getTemplate,
  getDailyDefaultTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  reorderTemplates,
  setDailyDefaultTemplate,
  resetTemplatesToDefaults,
} from './database'
import { markdownToTiptapString } from './markdown'
import {
  createLocalFolderAsync,
  createLocalFolderFileAsync,
  readLocalFolderFile,
  readLocalFolderFileAsync,
  renameLocalFolderEntryAsync,
  resolveLocalFolderDeleteTargetAsync,
  resolveLocalFolderFilePathAsync,
  saveLocalFolderFileAsync,
} from './local-folder'
import { registerLocalFolderSearchIpc } from './ipc/register-local-folder-search-ipc'
import { registerNoteIpc } from './ipc/register-note-ipc'
import { registerNotebookIpc } from './ipc/register-notebook-ipc'
import { registerNotebookFolderIpc } from './ipc/register-notebook-folder-ipc'
import { registerAttachmentIpc } from './ipc/register-attachment-ipc'
import { registerKnowledgeBaseIpc } from './ipc/register-knowledge-base-ipc'
import { registerAIIpc } from './ipc/register-ai-ipc'
import { registerImportExportIpc } from './ipc/register-import-export-ipc'
import { registerChatIpc } from './ipc/register-chat-ipc'
import { registerAppIpc } from './ipc/register-app-ipc'
import { registerLocalFolderIpc } from './ipc/register-local-folder-ipc'
import {
  buildLocalEtag,
  resolveIfMatchForLocal,
} from './note-gateway'
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
  setCurrentTaskIdGetter,
} from './sanqian-sdk'
import {
  listAgents,
  runAgentTask,
  cancelAgentTask,
  getCurrentTaskId,
} from './agent-task-service'
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
  updateNoteNotebookId,
  type EmbeddingConfig,
} from './embedding'
import { fetchEmbeddingConfigFromSanqian, fetchRerankConfigFromSanqian, updateSdkContexts } from './sanqian-sdk'
import { resolveSearchScope } from './search-scope'
import {
  resolveMountStatusFromFsError,
} from './local-folder-watch'
import { resolveRendererNoteIdForNavigation } from './navigation-resolver'
import {
  normalizeLocalRelativePathForEtag,
} from './internal-folder-path'
import {
  getAllNotesForRendererAsync,
  getNoteByIdForRenderer,
  getNotesByIdsForRenderer,
  initNoteSynthesis,
} from './note-synthesis'
import {
  getUserContext,
  buildAgentExecutionContext,
  setUserContext,
  getRawUserContext,
  getCurrentNoteContext,
  onUserContextChange,
} from './user-context'
import {
  getCachedLocalFolderTree,
  invalidateLocalFolderTreeCache,
  scanAndCacheLocalFolderTree,
  scanAndCacheLocalFolderTreeAsync,
} from './local-folder-tree-cache'
import {
  deleteIndexedLocalNotesByNotebook,
  deleteIndexForLocalPath,
  syncLocalNoteTagsMetadata,
  syncLocalNotePopupRefs,
  cancelPendingLocalNotebookIndexSync,
  enqueueLocalNotebookIndexSync,
  triggerFullKnowledgeBaseRebuild,
  scheduleAIPopupCleanup,
  clearAIPopupCleanupTimers,
  clearLocalNotebookIndexSyncForNotebook,
} from './local-notebook-index'
import {
  scheduleLocalFolderWatchEvent,
  initWatchEventScheduler,
  stopLocalFolderWatcher,
  stopAllLocalFolderWatchers,
  ensureLocalFolderWatcher,
  syncLocalFolderWatchers,
} from './local-folder-watcher'
import {
  setupSessionResourceListeners,
  handleSelectionChange,
  pushSelectionResource,
  removeSelectionResource,
  pushPinnedSelectionResource,
  clearSessionResourceTimers,
  initSessionResources,
} from './session-resources'
import { setAppLocale, t } from './i18n'
import { testEmbeddingAPI } from './embedding/api'
import { setRerankConfig, callRerankAPI } from './embedding/rerank-api'
import { semanticSearch, hybridSearch, configureRerank } from './embedding/semantic-search'
import {
  getImporters,
  detectImporter,
  previewImport,
  executeImport,
  executeExport,
} from './import-export'
import { getPdfServiceInfos } from './import-export/pdf-services'
import { exportNoteAsMarkdown, exportNoteAsPDF } from './export'
import { getPdfConfig, setPdfConfig, getServiceConfig, setServiceConfig } from './import-export/pdf-config'
import { pdfImporter } from './import-export/importers/pdf-importer'
import { arxivImporter, parseArxivInput } from './import-export/arxiv'
import { ChatPanel } from '@yushaw/sanqian-chat/main'
import {
  loadWindowState,
  saveWindowState,
  isWindowVisible,
  getCenteredBoundsOnMouseDisplay,
  initializeLanguage,
  getTranslations,
  getThemeSettings,
  setThemeSettings,
  getUpdateState,
  setUpdateStatus,
  setUpdateError,
  setUpdateProgress,
  sendUpdateStatus,
  setupAutoUpdater,
  initAutoUpdater,
} from './app'

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
let attachmentCleanupTimer: ReturnType<typeof setTimeout> | null = null

function resolveBoundedMsFromEnv(
  value: string | undefined,
  fallbackMs: number,
  minMs: number,
  maxMs: number
): number {
  const parsed = Number.parseInt(value || '', 10)
  if (!Number.isFinite(parsed)) return fallbackMs
  return Math.min(Math.max(parsed, minMs), maxMs)
}

const LOCAL_FOLDER_SEARCH_SCAN_CACHE_TTL_MS = resolveBoundedMsFromEnv(
  process.env.LOCAL_FOLDER_SEARCH_SCAN_CACHE_TTL_MS,
  10_000,
  1_200,
  120_000
)
const LOCAL_FOLDER_GLOBAL_SEARCH_CONCURRENCY = 4
// Re-export getRawUserContext for backward compatibility
export { getRawUserContext } from './user-context'

// ============ ChatPanel for Chat ============
let chatPanel: ChatPanel | null = null
let unsubscribeUserContextChange: (() => void) | null = null

type ChatClientWithInternalSdk = {
  _getSdk?: () => unknown | null
}

/**
 * ChatPanel currently expects SDK-level methods (e.g. cancelRun),
 * so unwrap SanqianAppClient to its internal SDK when available.
 */
function getChatPanelClient(): unknown {
  const client = getClient() as ChatClientWithInternalSdk | null
  return client?._getSdk?.() ?? client
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
    minHeight: 480,
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
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Add mainView to window
  mainWindow.contentView.addChildView(mainView)

  // Set initial bounds using contentView size (not window bounds)
  // On Windows with titleBarOverlay, window.getBounds() includes the title bar area
  // but contentView.getBounds() gives the actual content area size
  const { width, height } = mainWindow.contentView.getBounds()
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

  // Save window state on resize and update mainView bounds
  // Note: When ChatPanel is visible in embedded mode, it handles mainView bounds via onLayoutChange.
  //       Otherwise (hidden or floating mode), we need to update mainView bounds manually here.
  mainWindow.on('resize', () => {
    if (mainWindow) {
      if (!mainWindow.isMaximized()) {
        saveWindowState(mainWindow)
      }
      // Update mainView bounds when ChatPanel is not embedded-visible
      // Use setImmediate to ensure bounds are updated after resize is complete
      const isEmbeddedVisible = chatPanel?.isVisible() && chatPanel?.getMode() === 'embedded'
      if (mainView && !isEmbeddedVisible) {
        setImmediate(() => {
          if (mainView && mainWindow) {
            const { width, height } = mainWindow.contentView.getBounds()
            mainView.setBounds({ x: 0, y: 0, width, height })
          }
        })
      }
    }
  })

  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isMaximized()) {
      saveWindowState(mainWindow)
    }
  })

  // Handle external link opens - validate protocol to prevent file:// etc.
  mainView.webContents.setWindowOpenHandler((details) => {
    try {
      const urlObj = new URL(details.url)
      if (['http:', 'https:', 'mailto:'].includes(urlObj.protocol)) {
        shell.openExternal(details.url)
      }
    } catch {
      // invalid URL, silently ignore
    }
    return { action: 'deny' }
  })

  // Disable default context menu (dev tools available via Cmd+Option+I or View menu)
  mainView.webContents.on('context-menu', (event) => {
    event.preventDefault()
  })

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
        triggerFullKnowledgeBaseRebuild('sanqian-config-model-changed')
      } else {
        console.log('[Main] Embedding config synced from Sanqian')
      }

      // 同步 Rerank 配置
      await syncRerankConfigFromSanqian()
    } else {
      console.log('[Main] Sanqian embedding not available, using cached config')
      // 禁用 rerank
      setRerankConfig(null)
      configureRerank({ enabled: false })

      // Check model consistency with cached config
      const consistency = checkModelConsistency()
      if (consistency.needsRebuild) {
        console.log(
          `[Main] Model mismatch detected (config: ${consistency.currentModel}, indexed: ${consistency.indexedModel}), triggering rebuild...`
        )
        triggerFullKnowledgeBaseRebuild('model-consistency-mismatch')
      }
    }
  } catch (error) {
    console.error('[Main] Failed to sync embedding config:', error)
  }
}

/**
 * 同步 Rerank 配置
 */
async function syncRerankConfigFromSanqian(): Promise<void> {
  try {
    const rerankConfig = await fetchRerankConfigFromSanqian()

    if (rerankConfig?.available) {
      // 设置 Rerank API 配置
      setRerankConfig({
        apiUrl: rerankConfig.apiUrl || '',
        apiKey: rerankConfig.apiKey || '',
        modelName: rerankConfig.modelName || ''
      })

      // 配置 semantic-search 使用 rerank
      configureRerank({
        enabled: true,
        rerankFn: callRerankAPI
      })

      console.log(`[Main] Rerank config synced from Sanqian: model=${rerankConfig.modelName}`)
    } else {
      console.log('[Main] Sanqian rerank not available')
      setRerankConfig(null)
      configureRerank({ enabled: false })
    }
  } catch (error) {
    console.error('[Main] Failed to sync rerank config:', error)
    setRerankConfig(null)
    configureRerank({ enabled: false })
  }
}

// ============ App Lifecycle ============

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sanqian.notes')

  // Initialize language
  initializeLanguage()

  // Set custom application menu to fix toggleDevTools issue with WebContentsView
  // (default menu's toggleDevTools doesn't work with BaseWindow + WebContentsView)
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' as const },
    { role: 'editMenu' as const },
    {
      label: 'View',
      submenu: [
        ...(is.dev
          ? [
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
            ]
          : []),
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
  try {
    initDatabase()
  } catch (err) {
    console.error('[Main] Failed to initialize database:', err)
    dialog.showErrorBox(
      'Database Initialization Failed',
      `Failed to open or migrate the database. The app cannot start.\n\n${err instanceof Error ? err.message : String(err)}`
    )
    app.quit()
    return
  }

  // Initialize vector database for knowledge base
  try {
    initVectorDatabase()
  } catch (err) {
    console.error('[Main] Failed to initialize vector database:', err)
    // Vector DB failure is non-fatal: search/embedding won't work but app can still run
  }

  // Start indexing service (mainWindow is set in createWindow)
  indexingService.start()

  registerChatIpc(ipcMain, {
    getChatPanel: () => chatPanel,
    getMainWindow: () => mainWindow,
    getMainView: () => mainView,
    pushPinnedSelectionResource,
    resolveRendererNoteIdForNavigation,
    navigationResolverDeps: {
      getNoteById,
      getLocalNoteIdentityByUid,
    },
    getThemeSettings,
    setThemeSettings,
    setAppLocale,
    updateSdkContexts,
    acquireReconnect,
    releaseReconnect,
    getClient,
    ensureAgentReady,
    getCurrentNoteContext,
  })

  // Set up getter for Formatter Agent output tools
  setCurrentTaskIdGetter(() => getCurrentTaskId())

  // Initialize Sanqian SDK
  initializeSanqianSDK()
    .then(async () => {
      // Setup session resource event listeners
      setupSessionResourceListeners()
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

  // Initialize note synthesis with tree cache dependencies
  initNoteSynthesis({
    getCachedLocalFolderTree,
    scanAndCacheLocalFolderTree,
    scanAndCacheLocalFolderTreeAsync,
    searchScanCacheTtlMs: LOCAL_FOLDER_SEARCH_SCAN_CACHE_TTL_MS,
  })

  // Initialize watcher event scheduler (needs mainView for emitting events)
  initWatchEventScheduler({ getMainView: () => mainView })

  // Initialize session resources (needs chatPanel for visibility check)
  initSessionResources({ getChatPanel: () => chatPanel })

  // Initialize auto-updater (needs mainView for sending status, mainWindow for progress bar)
  initAutoUpdater({ getMainView: () => mainView, getMainWindow: () => mainWindow })

  // IPC handlers for note/daily/trash operations
  registerNoteIpc(ipcMain, {
    getAllNotesForRendererAsync,
    getNoteByIdForRenderer,
    getNotesByIdsForRenderer,
    addNote,
    getNoteById,
    updateNote,
    updateNoteSafe,
    updateNoteNotebookId,
    checkAndIndex: indexingService.checkAndIndex.bind(indexingService),
    deleteNote,
    deleteNoteIndex: indexingService.deleteNoteIndex.bind(indexingService),
    searchNotes,
    resolveSearchScope,
    createDemoNote,
    getDailyByDate,
    createDaily,
    getTrashNotes,
    restoreNote,
    getEmbeddingConfig,
    indexNoteFull: indexingService.indexNoteFull.bind(indexingService),
    indexNoteFtsOnly: indexingService.indexNoteFtsOnly.bind(indexingService),
    permanentlyDeleteNote,
    emptyTrash,
    cleanupOldTrash,
  })

  // IPC handlers for notebook operations
  registerNotebookIpc(ipcMain, {
    getNotebooks,
    addNotebook,
    updateNotebook,
    deleteNotebook,
    reorderNotebooks,
  })

  registerNotebookFolderIpc(ipcMain, {
    getNotebookFolders,
    hasNotebookFolderPathReference,
    createNotebookFolderEntry,
    renameNotebookFolderEntry,
    deleteNotebookFolderEntry,
    deleteNoteIndex: (noteId) => indexingService.deleteNoteIndex(noteId),
  })

  // IPC handlers for local folder notebook operations
  registerLocalFolderSearchIpc(ipcMain, {
    getLocalFolderMounts,
    getCachedLocalFolderTree,
    updateLocalFolderMountStatus,
    invalidateLocalFolderTreeCache,
    scheduleLocalFolderWatchEvent,
    resolveMountStatusFromFsError,
    globalSearchConcurrency: LOCAL_FOLDER_GLOBAL_SEARCH_CONCURRENCY,
    searchScanCacheTtlMs: LOCAL_FOLDER_SEARCH_SCAN_CACHE_TTL_MS,
  })

  registerLocalFolderIpc(ipcMain, {
    getLocalFolderMounts,
    getLocalFolderMountByCanonicalPath,
    getLocalFolderMountByNotebookId,
    createLocalFolderNotebookMount,
    updateLocalFolderMountRoot,
    updateLocalFolderMountStatus,
    readLocalFolderFileAsync,
    saveLocalFolderFileAsync,
    createLocalFolderFileAsync,
    createLocalFolderAsync,
    renameLocalFolderEntryAsync,
    resolveLocalFolderDeleteTargetAsync,
    resolveLocalFolderFilePathAsync,
    readLocalFolderFile,
    ensureLocalNoteIdentity,
    renameLocalNoteIdentityPath,
    renameLocalNoteIdentityFolderPath,
    deleteLocalNoteIdentityByPath,
    getLocalNoteIdentityByPath,
    listLocalNoteMetadata,
    updateLocalNoteMetadata,
    renameLocalNoteMetadataPath,
    renameLocalNoteMetadataFolderPath,
    deleteLocalNoteMetadataByPath,
    buildLocalEtag,
    resolveIfMatchForLocal,
    normalizeLocalRelativePathForEtag,
    deleteIndexedLocalNotesByNotebook,
    deleteIndexForLocalPath,
    syncLocalNoteTagsMetadata,
    syncLocalNotePopupRefs,
    enqueueLocalNotebookIndexSync,
    clearLocalNotebookIndexSyncForNotebook,
    scanAndCacheLocalFolderTree,
    scanAndCacheLocalFolderTreeAsync,
    invalidateLocalFolderTreeCache,
    ensureLocalFolderWatcher,
    stopLocalFolderWatcher,
    syncLocalFolderWatchers,
    scheduleLocalFolderWatchEvent,
    resolveMountStatusFromFsError,
    trashItem: (path) => shell.trashItem(path),
    openPath: (path) => shell.openPath(path),
    deleteNotebook,
  })

  registerAIIpc(ipcMain, {
    setUserContext,
    getUserContext,
    handleSelectionChange,
    getTags,
    getTagsByNote,
    getAIActions,
    getAllAIActions,
    getAIAction,
    createAIAction,
    updateAIAction,
    deleteAIAction,
    reorderAIActions,
    resetAIActionsToDefaults,
    getPopup,
    createPopup,
    updatePopupContent,
    deletePopup,
    cleanupPopups,
    getAgentTask,
    getAgentTaskByBlockId,
    createAgentTask,
    updateAgentTask,
    deleteAgentTask,
    deleteAgentTaskByBlockId,
    getAllTemplates,
    getTemplate,
    getDailyDefaultTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    reorderTemplates,
    setDailyDefaultTemplate,
    resetTemplatesToDefaults,
    markdownToTiptapString,
    listAgents,
    runAgentTask,
    cancelAgentTask,
    buildAgentExecutionContext,
  })

  registerKnowledgeBaseIpc(ipcMain, {
    getEmbeddingConfig,
    setEmbeddingConfig,
    fetchEmbeddingConfigFromSanqian,
    fetchRerankConfigFromSanqian,
    getDimensionsForModel,
    testEmbeddingAPI,
    getIndexStats,
    getLastIndexedTime,
    cancelPendingLocalNotebookIndexSync,
    clearAllIndexData,
    getQueueStatus: () => indexingService.getQueueStatus(),
    triggerFullKnowledgeBaseRebuild,
    semanticSearch,
    hybridSearch,
  })

  registerAttachmentIpc(ipcMain, {
    saveAttachment,
    saveAttachmentBuffer,
    deleteAttachment,
    openAttachment,
    showInFolder,
    selectFiles,
    selectImages,
    getFullPath,
    attachmentExists,
    getAllAttachments,
    getUsedAttachmentPaths,
    cleanupOrphanAttachments,
  })

  registerImportExportIpc(ipcMain, {
    getImporters,
    detectImporter,
    previewImport,
    executeImport,
    executeExport,
    exportNoteAsMarkdown,
    exportNoteAsPDF,
    getPdfServiceInfos,
    getPdfConfig,
    setPdfConfig,
    getServiceConfig,
    setServiceConfig,
    pdfImporter,
    parseArxivInput,
    arxivImporter,
    t,
    getMainView: () => mainView,
  })

  registerAppIpc(ipcMain, {
    getDataPath: () => app.getPath('userData'),
    getAppVersion: () => app.getVersion(),
    isDev: is.dev,
    shouldUseDarkColors: () => nativeTheme.shouldUseDarkColors,
    onNativeThemeUpdated: (callback) => nativeTheme.on('updated', callback),
    getAppSetting,
    setAppSetting,
    getSanqianApiUrl,
    getMainWindow: () => mainWindow,
    getMainView: () => mainView,
    openExternal: (url) => shell.openExternal(url),
    openPath: (path) => shell.openPath(path),
    getUpdateState,
    setUpdateStatus,
    setUpdateError,
    setUpdateProgress,
    sendUpdateStatus,
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    quitAndInstall: () => autoUpdater.quitAndInstall(),
    setIsQuitting: (value) => { isQuitting = value },
  })

  createWindow()
  syncLocalFolderWatchers()

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
    getClient: () => getChatPanelClient(),
    getAgentId: () => getAssistantAgentId(),
    shortcuts: {
      toggle: 'CommandOrControl+Shift+Space',
      toggleMode: 'CommandOrControl+Shift+E', // Enable mode toggle
    },
    stateKey: 'sanqian-notes',
    // Layout change callback - update mainView bounds when chat panel is shown/hidden
    onLayoutChange: ({ mainWidth, chatVisible }) => {
      if (mainView && mainWindow) {
        const { height } = mainWindow.contentView.getBounds()
        mainView.setBounds({ x: 0, y: 0, width: mainWidth, height })
      }

      // Handle Session Resource based on Chat visibility
      if (chatVisible) {
        // Chat became visible - push current selection if any
        if (getRawUserContext().selectedText) {
          pushSelectionResource()
        }
      } else {
        // Chat became hidden - remove selection resource
        removeSelectionResource()
      }
    },
  })

  unsubscribeUserContextChange?.()
  unsubscribeUserContextChange = onUserContextChange(() => {
    const webContents = chatPanel?.getWebContents()
    if (!webContents || webContents.isDestroyed()) {
      return
    }
    webContents.send('chatWindow:noteContextChanged', getCurrentNoteContext())
  })

  // Register "Ask AI" shortcut (Cmd+Shift+A / Ctrl+Shift+A)
  // Opens Chat and pushes selection as Session Resource
  const askAiRegistered = globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (!chatPanel) return

    // If Chat is already visible, explicitly push pinned selection
    if (chatPanel.isVisible()) {
      if (getRawUserContext().selectedText) {
        // Use pinned resource (same as right-click Ask AI) for consistency
        pushPinnedSelectionResource()
      }
    } else {
      // Push pinned selection first, then show (same as right-click Ask AI)
      if (getRawUserContext().selectedText) {
        pushPinnedSelectionResource()
      }
      chatPanel.show()
    }
  })
  if (!askAiRegistered) {
    console.warn('[GlobalShortcut] Failed to register Cmd+Shift+A - may be in use by another app')
  }

  setupTray()
  setupAutoUpdater()
  scheduleAIPopupCleanup()

  // 启动 5 分钟后自动清理孤儿附件（不阻塞启动）
  attachmentCleanupTimer = setTimeout(async () => {
    attachmentCleanupTimer = null
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
}).catch((error) => {
  console.error('[Main] Failed during app initialization:', error)
  app.quit()
})

let sdkCleanedUp = false
app.on('before-quit', (e) => {
  isQuitting = true
  if (attachmentCleanupTimer) {
    clearTimeout(attachmentCleanupTimer)
    attachmentCleanupTimer = null
  }
  clearAIPopupCleanupTimers()
  stopAllLocalFolderWatchers()
  // Destroy chat panel before quitting
  unsubscribeUserContextChange?.()
  unsubscribeUserContextChange = null
  chatPanel?.destroy()
  chatPanel = null
  // Await SDK cleanup before allowing quit (max 2s timeout)
  if (!sdkCleanedUp) {
    e.preventDefault()
    const sdkPromise = stopSanqianSDK().catch((err) => {
      console.error('[Main] Failed to stop SDK:', err)
    })
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000))
    Promise.race([sdkPromise, timeout]).finally(() => {
      sdkCleanedUp = true
      app.quit()
    })
  }
})

app.on('window-all-closed', () => {
  // Don't quit when all windows are closed - we stay in tray
  // Cleanup only happens when actually quitting via tray menu or Cmd+Q
})

app.on('will-quit', () => {
  // Unregister all global shortcuts
  globalShortcut.unregisterAll()
  stopPortWatcher()
  // Clear selection debounce timer
  clearSessionResourceTimers()
  // Stop indexing service (sync cleanup)
  indexingService.stop()
  // Close vector database
  closeVectorDatabase()
  // Close main database (ensures WAL checkpoint)
  closeDatabase()
})
