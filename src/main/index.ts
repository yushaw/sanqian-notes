import { app, shell, BaseWindow, WebContentsView, ipcMain, nativeTheme, screen, protocol, net, Tray, Menu, nativeImage, globalShortcut } from 'electron'
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
  reorderNotebooks,
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
  type AIActionInput,
  type NoteSearchFilter,
  // AI Popups
  getPopup,
  createPopup,
  updatePopupContent,
  deletePopup,
  cleanupPopups,
  type PopupInput,
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
import type { AgentExecutionContext, AgentTaskInput, AgentTaskRecord, TemplateInput } from '../shared/types'
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
  type ImportOptions,
  type ExportOptions,
} from './import-export'
import { getPdfServiceInfos } from './import-export/pdf-services'
import {
  exportNoteAsMarkdown,
  exportNoteAsPDF,
  type MarkdownExportOptions,
  type PDFExportOptions,
} from './export'
import { getPdfConfig, setPdfConfig, getServiceConfig, setServiceConfig, type PdfServiceConfigs } from './import-export/pdf-config'
import { pdfImporter } from './import-export/importers/pdf-importer'
import type { PdfParseProgress } from './import-export/pdf-services/types'
import { arxivImporter, parseArxivInput } from './import-export/arxiv'
import type { ArxivImportOptions, ArxivBatchProgress } from './import-export/arxiv'
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
let updateReleaseNotes: string | null = null

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
 * Build execution context for agent tasks (concise, structured).
 */
function buildAgentExecutionContext(context?: AgentExecutionContext | null): string | null {
  const fallback = {
    sourceApp: 'sanqian-notes',
    noteId: userContext.currentNoteId,
    noteTitle: userContext.currentNoteTitle,
    notebookId: userContext.currentNotebookId,
    notebookName: userContext.currentNotebookName,
    heading: userContext.cursorContext?.nearestHeading ?? null,
  }
  const resolved = context ?? fallback
  const parts: string[] = []

  const sourceApp = resolved.sourceApp || 'sanqian-notes'
  parts.push(`source_app: ${sourceApp}`)

  if (resolved.noteTitle) {
    const noteIdSuffix = resolved.noteId ? ` (ID: ${resolved.noteId})` : ''
    parts.push(`note: "${resolved.noteTitle}"${noteIdSuffix}`)
  }

  if (resolved.notebookName) {
    const notebookIdSuffix = resolved.notebookId ? ` (ID: ${resolved.notebookId})` : ''
    parts.push(`notebook: "${resolved.notebookName}"${notebookIdSuffix}`)
  }

  if (resolved.heading) {
    parts.push(`heading: "${resolved.heading}"`)
  }

  parts.push('This context is for your awareness. Do not mention it unless directly relevant to the user\'s request.')

  return parts.join('\n')
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

// ============ Session Resources for Chat Context ============

/** Current selection resource ID (null if no selection pushed) */
let currentSelectionResourceId: string | null = null

/** Debounce timer for selection changes */
let selectionDebounceTimer: ReturnType<typeof setTimeout> | null = null

/** Previous selected text (for change detection) */
let previousSelectedText: string | null = null

/** Timestamp when pinned selection was last pushed (to prevent duplicate auto-push) */
let lastPinnedSelectionTime: number = 0

/** Cooldown period after pinned selection push to prevent duplicate auto-push (ms) */
const PINNED_SELECTION_COOLDOWN_MS = 1000

/** Shared TextEncoder instance (avoid creating new instance on each call) */
const textEncoder = new TextEncoder()

/** Max content size for session resources (100KB) */
const MAX_RESOURCE_SIZE = 100 * 1024

/**
 * Truncate text to fit within byte size limit using binary search
 */
function truncateText(text: string, maxSize: number = MAX_RESOURCE_SIZE): string {
  if (textEncoder.encode(text).length <= maxSize) return text

  // Binary search to find the right character length that fits within byte limit
  let low = 0
  let high = text.length
  const targetSize = Math.floor(maxSize * 0.9)

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if (textEncoder.encode(text.slice(0, mid)).length <= targetSize) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return text.slice(0, low) + '\n\n' + t().common.contentTruncated
}

/**
 * Setup SDK event listeners for session resources
 * Called after SDK is initialized
 */
function setupSessionResourceListeners(): void {
  const client = getClient()
  if (!client) return

  // Listen for resourceRemoved events (e.g., when Chat clears resources after sending)
  client.on('resourceRemoved', (resourceId: string) => {
    console.log('[SessionResource] Resource removed by external:', resourceId)
    // Clear local state if our selection resource was removed
    if (currentSelectionResourceId === resourceId) {
      currentSelectionResourceId = null
      // Also reset previousSelectedText so next selection change will push again
      previousSelectedText = null
    }
  })

  // Listen for disconnected events to clean up state (resources may be lost on reconnect)
  client.on('disconnected', () => {
    console.log('[SessionResource] SDK disconnected, clearing resource state')
    currentSelectionResourceId = null
    previousSelectedText = null
  })
}

/**
 * Escape special characters for XML attribute values
 */
function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Format selection content for Session Resource
 */
function formatSelectionContent(
  selectedText: string,
  noteTitle: string | null,
  cursorContext: CursorContext | null
): string {
  const parts: string[] = []

  // Add note context
  if (noteTitle) {
    parts.push(`<note title="${escapeXmlAttr(noteTitle)}">`)
  }

  // Add section context if available
  if (cursorContext?.nearestHeading) {
    parts.push(`<section heading="${escapeXmlAttr(cursorContext.nearestHeading)}">`)
  }

  // Add selected text (escape XML special chars to prevent structure breakage)
  // Using CDATA would be cleaner but some LLMs handle escaped content better
  const escapedText = selectedText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  parts.push(`<selected_text>`)
  parts.push(escapedText)
  parts.push(`</selected_text>`)

  // Close tags
  if (cursorContext?.nearestHeading) {
    parts.push(`</section>`)
  }
  if (noteTitle) {
    parts.push(`</note>`)
  }

  return parts.join('\n')
}

/**
 * Push or update selection as Session Resource
 */
async function pushSelectionResource(): Promise<void> {
  const client = getClient()
  if (!client) return

  // Skip if a pinned selection was just pushed (within cooldown period)
  // This prevents duplicate push when Ask AI triggers before Editor's debounce completes
  if (Date.now() - lastPinnedSelectionTime < PINNED_SELECTION_COOLDOWN_MS) {
    return
  }

  const { selectedText, currentNoteTitle, cursorContext } = userContext
  if (!selectedText) return

  try {
    // Truncate if needed (100KB limit)
    const truncatedText = truncateText(selectedText)
    const content = formatSelectionContent(truncatedText, currentNoteTitle, cursorContext)

    // Show first 30 chars of selected text as title (replace newlines with spaces)
    const titlePreview = (selectedText.length > 30 ? selectedText.slice(0, 30) + '...' : selectedText)
      .replace(/[\r\n]+/g, ' ')
    const resource = await client.pushResource({
      id: 'editor-selection', // Fixed ID for single selection resource
      title: titlePreview,
      content,
      summary: currentNoteTitle || undefined, // Note title as tooltip
      icon: '📝',
      type: 'selection',
    })

    currentSelectionResourceId = resource.fullId
    console.log('[SessionResource] Pushed selection:', currentSelectionResourceId)
  } catch (error) {
    console.warn('[SessionResource] Failed to push selection:', error)
  }
}

/**
 * Remove selection Session Resource
 */
async function removeSelectionResource(): Promise<void> {
  if (!currentSelectionResourceId) return

  const client = getClient()
  if (!client) return

  try {
    await client.removeResource(currentSelectionResourceId)
    console.log('[SessionResource] Removed selection:', currentSelectionResourceId)
    currentSelectionResourceId = null
  } catch (error) {
    console.warn('[SessionResource] Failed to remove selection:', error)
  }
}

/**
 * Push pinned selection as Session Resource (for Ask AI action)
 * Uses unique ID so it accumulates and won't be auto-cleared
 */
async function pushPinnedSelectionResource(): Promise<string | null> {
  const client = getClient()
  if (!client) return null

  // Clear pending selection debounce FIRST to prevent duplicate push after Ask AI
  // Must be before any early return!
  if (selectionDebounceTimer) {
    clearTimeout(selectionDebounceTimer)
    selectionDebounceTimer = null
  }

  const { selectedText, currentNoteTitle, cursorContext } = userContext
  if (!selectedText) return null

  try {
    // If there's an existing editor-selection with the same content, remove it first
    // to avoid duplicating the same selection
    if (currentSelectionResourceId) {
      await removeSelectionResource()
    }

    // Truncate if needed (100KB limit)
    const truncatedText = truncateText(selectedText)
    const content = formatSelectionContent(truncatedText, currentNoteTitle, cursorContext)

    // Use unique ID with timestamp so resources accumulate
    const uniqueId = `pinned-selection-${Date.now()}`
    // Show first 30 chars of selected text as title (replace newlines with spaces)
    const titlePreview = (selectedText.length > 30 ? selectedText.slice(0, 30) + '...' : selectedText)
      .replace(/[\r\n]+/g, ' ')
    const resource = await client.pushResource({
      id: uniqueId,
      title: titlePreview,
      content,
      summary: currentNoteTitle || undefined, // Note title as tooltip
      icon: '📌', // Pin icon to distinguish from auto-tracked selection
      type: 'selection',
    })

    // Record timestamp to prevent duplicate auto-push
    lastPinnedSelectionTime = Date.now()
    console.log('[SessionResource] Pushed pinned selection:', resource.fullId)
    return resource.fullId
  } catch (error) {
    console.warn('[SessionResource] Failed to push pinned selection:', error)
    return null
  }
}

/**
 * Handle selection change with debounce
 * Only pushes when Chat is visible and setting is enabled
 */
function handleSelectionChange(newSelectedText: string | null): void {
  // Skip if selection hasn't changed
  if (newSelectedText === previousSelectedText) return
  previousSelectedText = newSelectedText

  // Clear pending debounce
  if (selectionDebounceTimer) {
    clearTimeout(selectionDebounceTimer)
    selectionDebounceTimer = null
  }

  // Check if sync selection setting is enabled (default: true)
  const syncEnabled = getAppSetting('syncSelectionToChat') !== 'false'
  if (!syncEnabled) {
    // Setting disabled, just clear local state
    if (!newSelectedText) {
      currentSelectionResourceId = null
    }
    return
  }

  // Check if Chat is visible
  const isChatVisible = chatPanel?.isVisible() ?? false
  if (!isChatVisible) {
    // Chat not visible, just clear local state (don't call SDK as it may be disconnected)
    if (!newSelectedText) {
      currentSelectionResourceId = null
    }
    return
  }

  // Debounce the push/remove
  selectionDebounceTimer = setTimeout(async () => {
    if (newSelectedText) {
      await pushSelectionResource()
    } else {
      await removeSelectionResource()
    }
  }, 300) // 300ms debounce
}

function sendUpdateStatus(): void {
  if (mainView && !mainView.webContents.isDestroyed()) {
    try {
      mainView.webContents.send('updater:status', {
        status: updateStatus,
        version: updateVersion,
        progress: updateProgress,
        error: updateError,
        releaseNotes: updateReleaseNotes
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
    // Extract release notes - can be string, array of ReleaseNoteInfo, or null
    if (typeof info.releaseNotes === 'string') {
      updateReleaseNotes = info.releaseNotes || null
    } else if (Array.isArray(info.releaseNotes)) {
      // ReleaseNoteInfo[] format - join all notes
      const notes = info.releaseNotes
        .map(n => n.note || '')
        .filter(Boolean)
        .join('\n\n')
      updateReleaseNotes = notes || null
    } else {
      updateReleaseNotes = null
    }
    sendUpdateStatus()
  })

  // No update available
  autoUpdater.on('update-not-available', () => {
    console.log('No update available')
    updateStatus = 'not-available'
    updateError = null
    updateReleaseNotes = null
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
    updateReleaseNotes = null
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
  locale: app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en', // use system locale as initial
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

  // Handle external link opens
  mainView.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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
        // Clear and rebuild index
        clearAllIndexData()
        const notes = getNotes()
        indexingService.rebuildAllNotes(notes).catch(console.error)
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
        clearAllIndexData()
        const notes = getNotes()
        indexingService.rebuildAllNotes(notes).catch(console.error)
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

  ipcMain.handle('chatWindow:showWithContext', async (_, context: string) => {
    if (!chatPanel) {
      return { success: false, error: 'ChatPanel not initialized' }
    }
    try {
      // Push pinned selection resource (accumulates, won't be auto-cleared)
      // This is user-initiated action, so we push a persistent resource
      await pushPinnedSelectionResource()

      chatPanel.show()
      // Send context (prompt) after window is ready
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
              // Focus input after a short delay to ensure window is fully shown
              setTimeout(() => chatPanel?.focusInput(), 50)
            } catch {
              // Window may have been destroyed during load
            }
          }
        })
      } else {
        // Window is already loaded, send immediately
        webContents.send('chatWindow:setContext', context)
        // Focus input after a short delay to ensure window is fully shown
        setTimeout(() => chatPanel?.focusInput(), 50)
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

  // Handle note navigation from chat window (triggered by sanqian-notes:// links)
  ipcMain.on('chat:navigate-to-note', (_, payload: { noteId: string; target?: { type: 'heading' | 'block'; value: string } }) => {
    const { noteId, target } = payload

    // Ensure main window is visible and focused
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
      mainWindow.focus()
    }

    // Send navigation event to main window renderer
    mainView?.webContents.send('note:navigate', { noteId, target })
  })

  // Theme sync: main window notifies theme changes, chat window retrieves settings
  ipcMain.handle('theme:sync', async (_, settings: { colorMode: 'light' | 'dark'; accentColor: string; locale: 'en' | 'zh'; fontSize?: 'small' | 'normal' | 'large' | 'extra-large' }) => {
    const localeChanged = currentThemeSettings.locale !== settings.locale
    currentThemeSettings = settings

    // Notify chat window if open
    const webContents = chatPanel?.getWebContents()
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('theme:updated', settings)
    }

    // Update SDK context providers when locale changes
    // Must wait for update before notifying renderer to refresh
    if (localeChanged) {
      try {
        // Update i18n module's locale state first
        setAppLocale(settings.locale)
        await updateSdkContexts()
        // Now notify renderer to refresh providers (after backend is updated)
        chatPanel?.notifyLocaleChanged(settings.locale)
      } catch (err) {
        console.error('[Notes] Failed to update SDK contexts on locale change:', err)
      }
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

  // IPC handlers for note operations
  ipcMain.handle('note:getAll', () => getNotes())
  ipcMain.handle('note:getById', (_, id) => getNoteById(id))
  ipcMain.handle('note:getByIds', (_, ids: string[]) => getNotesByIds(ids))
  ipcMain.handle('note:add', (_, note) => {
    return addNote(note)
  })
  ipcMain.handle('note:update', (_, id, updates) => {
    // Check if notebook_id is changing
    const oldNote = getNoteById(id)
    const result = updateNote(id, updates)
    // If notebook_id changed, update index
    if (result && oldNote && updates.notebook_id !== undefined && updates.notebook_id !== oldNote.notebook_id) {
      updateNoteNotebookId(id, updates.notebook_id || '')
    }
    return result
  })
  // 笔记失焦时触发索引检查
  // checkAndIndex 会根据 embedding 配置决定索引方式：
  // - embedding 启用：FTS + Embedding
  // - embedding 禁用：仅 FTS
  ipcMain.handle('note:checkIndex', async (_, noteId: string, notebookId: string, content: string) => {
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
  ipcMain.handle('note:search', (_, query: string, filter?: NoteSearchFilter) => searchNotes(query, filter))
  ipcMain.handle('note:createDemo', () => createDemoNote())

  // IPC handlers for daily notes
  ipcMain.handle('daily:getByDate', (_, date: string) => getDailyByDate(date))
  ipcMain.handle('daily:create', (_, date: string, title?: string) => createDaily(date, title))

  // IPC handlers for trash operations
  ipcMain.handle('trash:getAll', () => getTrashNotes())
  ipcMain.handle('trash:restore', async (_, id) => {
    const result = restoreNote(id)
    if (result) {
      // Rebuild index for restored note
      const note = getNoteById(id)
      if (note && note.content) {
        const config = getEmbeddingConfig()
        if (config.enabled) {
          indexingService.indexNoteFull(note.id, note.notebook_id || '', note.content).catch(console.error)
        } else {
          indexingService.indexNoteFtsOnly(note.id, note.notebook_id || '', note.content).catch(console.error)
        }
      }
    }
    return result
  })
  ipcMain.handle('trash:permanentDelete', (_, id) => permanentlyDeleteNote(id))
  ipcMain.handle('trash:empty', () => emptyTrash())
  ipcMain.handle('trash:cleanup', () => cleanupOldTrash())

  // IPC handlers for notebook operations
  ipcMain.handle('notebook:getAll', () => getNotebooks())
  ipcMain.handle('notebook:add', (_, notebook) => addNotebook(notebook))
  ipcMain.handle('notebook:update', (_, id, updates) => updateNotebook(id, updates))
  ipcMain.handle('notebook:delete', (_, id) => deleteNotebook(id))
  ipcMain.handle('notebook:reorder', (_, orderedIds: string[]) => reorderNotebooks(orderedIds))

  // IPC handlers for user context (for agent tools)
  ipcMain.handle('context:sync', (_, context: Partial<UserContext>) => {
    setUserContext(context)
    // Handle selection change for Session Resources
    if ('selectedText' in context) {
      handleSelectionChange(context.selectedText ?? null)
    }
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

  // IPC handlers for Agent Tasks
  ipcMain.handle('agentTask:get', (_, id: string) => getAgentTask(id))
  ipcMain.handle('agentTask:getByBlockId', (_, blockId: string) => getAgentTaskByBlockId(blockId))
  ipcMain.handle('agentTask:create', (_, input: AgentTaskInput) => createAgentTask(input))
  ipcMain.handle('agentTask:update', (_, id: string, updates: Partial<AgentTaskRecord>) => updateAgentTask(id, updates))
  ipcMain.handle('agentTask:delete', (_, id: string) => deleteAgentTask(id))
  ipcMain.handle('agentTask:deleteByBlockId', (_, blockId: string) => deleteAgentTaskByBlockId(blockId))

  // IPC handlers for Templates
  ipcMain.handle('templates:getAll', () => getAllTemplates())
  ipcMain.handle('templates:get', (_, id: string) => getTemplate(id))
  ipcMain.handle('templates:getDailyDefault', () => getDailyDefaultTemplate())
  ipcMain.handle('templates:create', (_, input: TemplateInput) => createTemplate(input))
  ipcMain.handle('templates:update', (_, id: string, updates: Partial<TemplateInput>) => updateTemplate(id, updates))
  ipcMain.handle('templates:delete', (_, id: string) => deleteTemplate(id))
  ipcMain.handle('templates:reorder', (_, orderedIds: string[]) => reorderTemplates(orderedIds))
  ipcMain.handle('templates:setDailyDefault', (_, id: string | null) => setDailyDefaultTemplate(id))
  ipcMain.handle('templates:reset', () => resetTemplatesToDefaults())

  // IPC handlers for Markdown utilities
  ipcMain.handle('markdown:toTiptap', (_, markdown: string) => markdownToTiptapString(markdown))

  // IPC handlers for Agent execution
  ipcMain.handle('agent:list', async () => {
    return listAgents()
  })

  ipcMain.handle('agent:run', async (
    event,
    taskId: string,
    agentId: string,
    agentName: string,
    content: string,
    additionalPrompt?: string,
    outputContext?: {
      targetBlockId: string
      pageId: string
      notebookId: string | null
      processMode: 'append' | 'replace'
      outputFormat?: 'auto' | 'paragraph' | 'list' | 'table' | 'code' | 'quote'
      executionContext?: AgentExecutionContext
    }
  ) => {
    const webContents = event.sender

    try {
      const executionContext = buildAgentExecutionContext(outputContext?.executionContext ?? null)
      const executionContextBlock = executionContext
        ? `<execution_context>\n${executionContext}\n</execution_context>`
        : undefined

      // Prepare options for two-step flow if outputContext is provided
      const options = outputContext ? {
        useTwoStepFlow: true,
        outputContext: {
          targetBlockId: outputContext.targetBlockId,
          pageId: outputContext.pageId,
          notebookId: outputContext.notebookId,
          processMode: outputContext.processMode,
          outputBlockId: null // Will be set after output is inserted
        },
        outputFormat: outputContext.outputFormat,
        executionContext: executionContextBlock,
        webContents
      } : executionContextBlock ? {
        executionContext: executionContextBlock
      } : undefined

      for await (const taskEvent of runAgentTask(
        taskId,
        agentId,
        agentName,
        content,
        additionalPrompt,
        options
      )) {
        // Check if webContents is still valid (window not closed)
        if (!webContents.isDestroyed()) {
          webContents.send('agent:event', taskId, taskEvent)
        }
      }
    } catch (error) {
      if (!webContents.isDestroyed()) {
        webContents.send('agent:event', taskId, {
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  })

  ipcMain.handle('agent:cancel', (_, taskId: string) => {
    return cancelAgentTask(taskId)
  })

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
  ipcMain.handle('knowledgeBase:fetchRerankFromSanqian', async () => {
    const config = await fetchRerankConfigFromSanqian()
    if (config?.available) {
      return {
        success: true,
        config: {
          available: true,
          apiUrl: config.apiUrl,
          apiKey: config.apiKey,
          modelName: config.modelName,
        },
      }
    }
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
  ipcMain.handle('knowledgeBase:hybridSearch', async (_, query: string, options?: { limit?: number; filter?: NoteSearchFilter }) => {
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
        ? ['openFile', 'openDirectory', 'multiSelections']
        : ['openFile', 'multiSelections'],
      filters: importer?.fileFilters || [
        { name: 'Markdown files', extensions: ['md', 'markdown'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })

    // Return all selected paths, or null if canceled
    return result.canceled ? null : result.filePaths
  })

  ipcMain.handle('export:selectTarget', async () => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })

    return result.canceled ? null : result.filePaths[0]
  })

  // ============ Single Note Export ============
  ipcMain.handle('export:noteAsMarkdown', async (_, noteId: string, options?: MarkdownExportOptions) => {
    return exportNoteAsMarkdown(noteId, options)
  })

  ipcMain.handle('export:noteAsPDF', async (_, noteId: string, options?: PDFExportOptions) => {
    return exportNoteAsPDF(noteId, options)
  })

  // ============ PDF Import ============
  ipcMain.handle('pdf:getServices', () => getPdfServiceInfos())

  ipcMain.handle('pdf:getConfig', () => getPdfConfig())

  ipcMain.handle('pdf:setConfig', (_, config: PdfServiceConfigs) => setPdfConfig(config))

  ipcMain.handle('pdf:getServiceConfig', (_, serviceId: string) => getServiceConfig(serviceId))

  ipcMain.handle('pdf:setServiceConfig', (_, serviceId: string, config: Record<string, string>) => {
    setServiceConfig(serviceId, config)
  })

  ipcMain.handle('pdf:selectFiles', async () => {
    const { dialog } = await import('electron')
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF files', extensions: ['pdf'] }],
    })
    return result.canceled ? [] : result.filePaths
  })

  // PDF import abort controller (module-level so it can be cancelled from another handler)
  let pdfImportAbortController: AbortController | null = null

  ipcMain.handle('pdf:cancel', () => {
    if (pdfImportAbortController) {
      pdfImportAbortController.abort()
      pdfImportAbortController = null
      return true
    }
    return false
  })

  ipcMain.handle(
    'pdf:import',
    async (
      _event,
      options: {
        pdfPaths: string[]
        serviceId: string
        serviceConfig: Record<string, string>
        targetNotebookId?: string
        importImages: boolean
        buildEmbedding?: boolean
      }
    ) => {
      const win = mainView

      // Create abort controller for this import session
      pdfImportAbortController = new AbortController()
      const abortSignal = pdfImportAbortController.signal

      const results: Array<{
        path: string
        success: boolean
        noteId?: string
        noteTitle?: string
        imageCount?: number
        error?: string
      }> = []

      try {
        for (let i = 0; i < options.pdfPaths.length; i++) {
          // Check if cancelled before processing next file
          if (abortSignal.aborted) {
            // Add remaining files as cancelled
            for (let j = i; j < options.pdfPaths.length; j++) {
              results.push({
                path: options.pdfPaths[j],
                success: false,
                error: 'Import cancelled',
              })
            }
            break
          }

          const pdfPath = options.pdfPaths[i]

          // 发送进度：当前文件
          win?.webContents.send('pdf:importProgress', {
            stage: 'file',
            message: t().pdf.processingFile(i + 1, options.pdfPaths.length),
            currentFile: i + 1,
            totalFiles: options.pdfPaths.length,
            fileName: pdfPath.split(/[/\\]/).pop() || pdfPath,
          })

          // 设置进度回调
          const onProgress = (progress: PdfParseProgress) => {
            win?.webContents.send('pdf:importProgress', {
              ...progress,
              currentFile: i + 1,
              totalFiles: options.pdfPaths.length,
            })
          }

          // 设置运行时配置（包含 abort signal）
          pdfImporter.setRuntimeConfig({
            serviceId: options.serviceId,
            serviceConfig: options.serviceConfig,
            onProgress,
            abortSignal,
          })

          try {
            // 复用现有导入流程
            const result = await executeImport({
              sourcePath: pdfPath,
              folderStrategy: 'single-notebook',
              targetNotebookId: options.targetNotebookId,
              tagStrategy: 'keep-nested',
              conflictStrategy: 'rename',
              importAttachments: options.importImages,
              parseFrontMatter: false,
              buildEmbedding: options.buildEmbedding,
            })

            results.push({
              path: pdfPath,
              success: result.success,
              noteId: result.importedNotes[0]?.id,
              noteTitle: result.importedNotes[0]?.title,
              imageCount: result.stats.importedAttachments,
              error: result.errors[0]?.error,
            })
          } catch (error) {
            results.push({
              path: pdfPath,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            })
          } finally {
            pdfImporter.cleanup()
          }
        }
      } finally {
        // Clean up abort controller
        pdfImportAbortController = null
      }

      // 通知数据更新
      const successCount = results.filter((r) => r.success).length
      if (successCount > 0) {
        mainView?.webContents.send('data:changed')
      }

      return {
        results,
        successCount,
        failCount: results.length - successCount,
      }
    }
  )

  // ============ arXiv Import ============
  ipcMain.handle('arxiv:parseInput', (_, input: string) => {
    return parseArxivInput(input)
  })

  ipcMain.handle('arxiv:import', async (_, options: ArxivImportOptions) => {
    const win = mainView

    const result = await arxivImporter.import(options, (progress: ArxivBatchProgress) => {
      win?.webContents.send('arxiv:importProgress', progress)
    })

    // Notify data update
    if (result.imported > 0) {
      mainView?.webContents.send('data:changed')
    }

    return result
  })

  ipcMain.handle('arxiv:cancel', () => {
    arxivImporter.cancel()
    return true
  })

  // ============ Inline Import (insert at cursor) ============
  ipcMain.handle('importInline:selectMarkdown', async () => {
    const { dialog } = await import('electron')
    const { readFile } = await import('fs/promises')

    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      properties: ['openFile'],
    })

    if (result.canceled || !result.filePaths[0]) return null

    const content = await readFile(result.filePaths[0], 'utf-8')
    return { content, path: result.filePaths[0] }
  })

  ipcMain.handle('importInline:selectAndParsePdf', async () => {
    const { dialog } = await import('electron')
    const win = mainView

    const result = await dialog.showOpenDialog({
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    })

    if (result.canceled || !result.filePaths[0]) return null

    const pdfPath = result.filePaths[0]

    // Get PDF service config
    const config = getPdfConfig()
    const serviceConfig = getServiceConfig(config.activeService)

    if (!serviceConfig) {
      throw new Error('PDF service not configured')
    }

    // Set up progress callback
    const onProgress = (progress: PdfParseProgress) => {
      win?.webContents.send('pdf:importProgress', progress)
    }

    // Parse PDF to markdown
    pdfImporter.setRuntimeConfig({
      serviceId: config.activeService,
      serviceConfig,
      onProgress,
    })

    try {
      const parseResult = await pdfImporter.parseFile(pdfPath)
      return { content: parseResult.content, path: pdfPath }
    } finally {
      pdfImporter.cleanup()
    }
  })

  ipcMain.handle('importInline:arxiv', async (_, arxivId: string) => {
    const win = mainView

    // Set up progress callback for PDF fallback
    const onPdfProgress = (progress: { stage: string; message: string }) => {
      win?.webContents.send('pdf:importProgress', progress)
    }

    // fetchAsMarkdown throws on error, which will be propagated to renderer
    const result = await arxivImporter.fetchAsMarkdown(arxivId, onPdfProgress)
    return { content: result.markdown, title: result.title }
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

  // App Settings
  ipcMain.handle('appSettings:get', (_, key: string) => getAppSetting(key))
  ipcMain.handle('appSettings:set', (_, key: string, value: string) => {
    setAppSetting(key, value)
  })

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

  ipcMain.handle('window:close', () => {
    if (mainWindow) {
      mainWindow.close()
      return true
    }
    return false
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
      error: updateError,
      releaseNotes: updateReleaseNotes
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
    onLayoutChange: ({ mainWidth, chatVisible }) => {
      if (mainView && mainWindow) {
        const { height } = mainWindow.contentView.getBounds()
        mainView.setBounds({ x: 0, y: 0, width: mainWidth, height })
      }

      // Handle Session Resource based on Chat visibility
      if (chatVisible) {
        // Chat became visible - push current selection if any
        if (userContext.selectedText) {
          pushSelectionResource()
        }
      } else {
        // Chat became hidden - remove selection resource
        removeSelectionResource()
      }
    },
  })

  // Register "Ask AI" shortcut (Cmd+Shift+A / Ctrl+Shift+A)
  // Opens Chat and pushes selection as Session Resource
  const askAiRegistered = globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (!chatPanel) return

    // If Chat is already visible, explicitly push pinned selection
    if (chatPanel.isVisible()) {
      if (userContext.selectedText) {
        // Use pinned resource (same as right-click Ask AI) for consistency
        pushPinnedSelectionResource()
      }
    } else {
      // Push pinned selection first, then show (same as right-click Ask AI)
      if (userContext.selectedText) {
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
  // Unregister all global shortcuts
  globalShortcut.unregisterAll()
  stopPortWatcher()
  // Clear selection debounce timer
  if (selectionDebounceTimer) {
    clearTimeout(selectionDebounceTimer)
    selectionDebounceTimer = null
  }
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
