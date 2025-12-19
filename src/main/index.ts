import { app, shell, BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  initDatabase,
  getNotes,
  getNoteById,
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
} from './database'

let mainWindow: BrowserWindow | null = null

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

// ============ Main Window ============

function createWindow(): void {
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
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }

  const isDarkMode = nativeTheme.shouldUseDarkColors
  const initialBgColor = isDarkMode ? '#1a1a1a' : '#F5F5F7'
  const initialTextColor = isDarkMode ? '#ffffff' : '#1D1D1F'

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

  if (savedState.isMaximized) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', () => {
    if (mainWindow) {
      saveWindowState(mainWindow)
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
}

// ============ App Lifecycle ============

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sanqian.notes')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize database
  initDatabase()

  // IPC handlers for note operations
  ipcMain.handle('note:getAll', () => getNotes())
  ipcMain.handle('note:getById', (_, id) => getNoteById(id))
  ipcMain.handle('note:add', (_, note) => addNote(note))
  ipcMain.handle('note:update', (_, id, updates) => updateNote(id, updates))
  ipcMain.handle('note:delete', (_, id) => deleteNote(id))
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

  // Theme
  ipcMain.handle('theme:get', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })

  // Platform info
  ipcMain.handle('platform:get', () => process.platform)

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

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
