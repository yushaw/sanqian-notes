import type { BaseWindow, IpcMain, WebContentsView } from 'electron'
import type { UpdateStatus } from '../app'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>

export interface AppIpcDeps {
  // App
  getDataPath: () => string
  getAppVersion: () => string
  isDev: boolean
  // Theme (native)
  shouldUseDarkColors: () => boolean
  onNativeThemeUpdated: (callback: () => void) => void
  // Settings
  getAppSetting: (key: string) => unknown
  setAppSetting: (key: string, value: string) => void
  getSanqianApiUrl: () => string | null
  // Window access
  getMainWindow: () => BaseWindow | null
  getMainView: () => WebContentsView | null
  // Shell
  openExternal: (url: string) => Promise<void>
  openPath: (path: string) => Promise<string>
  // Updater
  getUpdateState: () => { status: UpdateStatus; version: string | null; error: string | null }
  setUpdateStatus: (status: UpdateStatus) => void
  setUpdateError: (error: string | null) => void
  setUpdateProgress: (progress: number) => void
  sendUpdateStatus: () => void
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: () => void
  setIsQuitting: (value: boolean) => void
}

export function registerAppIpc(
  ipcMainLike: IpcMainHandleLike,
  deps: AppIpcDeps
): void {
  ipcMainLike.handle('app:getDataPath', createSafeHandler('app:getDataPath', () => {
    return deps.getDataPath()
  }))

  ipcMainLike.handle('app:openDataPath', createSafeHandler('app:openDataPath', async () => {
    return deps.openPath(deps.getDataPath())
  }))

  // Theme
  ipcMainLike.handle('theme:get', createSafeHandler('theme:get', () => deps.shouldUseDarkColors() ? 'dark' : 'light'))

  // Consolidated theme change listener (handles both renderer notification and Windows titlebar)
  deps.onNativeThemeUpdated(() => {
    const dark = deps.shouldUseDarkColors()
    deps.getMainView()?.webContents.send('theme:changed', dark ? 'dark' : 'light')
    const mainWindow = deps.getMainWindow()
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
  ipcMainLike.handle('platform:get', createSafeHandler('platform:get', () => process.platform))

  // App Settings
  ipcMainLike.handle('appSettings:get', createSafeHandler('appSettings:get', (_, key: string) => deps.getAppSetting(key)))
  ipcMainLike.handle('appSettings:set', createSafeHandler('appSettings:set', (_, key: string, value: string) => {
    deps.setAppSetting(key, value)
  }))

  // Sanqian API URL
  ipcMainLike.handle('sanqian:getApiUrl', createSafeHandler('sanqian:getApiUrl', () => deps.getSanqianApiUrl()))

  // Window control - fullscreen
  ipcMainLike.handle('window:setFullScreen', createSafeHandler('window:setFullScreen', (_, isFullScreen: boolean) => {
    const mainWindow = deps.getMainWindow()
    if (mainWindow) {
      mainWindow.setFullScreen(isFullScreen)
      return true
    }
    return false
  }))

  ipcMainLike.handle('window:isFullScreen', createSafeHandler('window:isFullScreen', () => {
    return deps.getMainWindow()?.isFullScreen() ?? false
  }))

  ipcMainLike.handle('window:close', createSafeHandler('window:close', () => {
    const mainWindow = deps.getMainWindow()
    if (mainWindow) {
      mainWindow.close()
      return true
    }
    return false
  }))

  // Windows titlebar overlay - dynamic color update
  ipcMainLike.handle('window:setTitleBarOverlay', (_, options: { color: string; symbolColor: string }) => {
    const mainWindow = deps.getMainWindow()
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
  ipcMainLike.handle('shell:openExternal', async (_, url: string) => {
    const allowedProtocols = ['http:', 'https:', 'mailto:']
    try {
      const urlObj = new URL(url)
      if (allowedProtocols.includes(urlObj.protocol)) {
        await deps.openExternal(url)
        return true
      }
    } catch {
      if (/^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+$/.test(url)) {
        await deps.openExternal(`https://${url}`)
        return true
      }
    }
    return false
  })

  // Popup continue in chat - forward to main window
  ipcMainLike.handle('popup:continueInChat', createSafeHandler('popup:continueInChat', (_, selectedText: string, explanation: string) => {
    const mainWindow = deps.getMainWindow()
    const mainView = deps.getMainView()
    if (mainWindow && mainView) {
      mainView.webContents.send('popup:openChatWithContext', selectedText, explanation)
      mainWindow.show()
      mainWindow.focus()
    }
  }))

  // App version
  ipcMainLike.handle('app:getVersion', createSafeHandler('app:getVersion', () => {
    return deps.getAppVersion()
  }))

  // Auto updater IPC handlers
  ipcMainLike.handle('updater:check', async () => {
    if (deps.isDev) {
      return { status: 'not-available' as UpdateStatus }
    }
    deps.setUpdateStatus('checking')
    deps.setUpdateError(null)
    deps.sendUpdateStatus()
    try {
      await deps.checkForUpdates()
      const state = deps.getUpdateState()
      return { status: state.status, version: state.version }
    } catch (err) {
      deps.setUpdateStatus('error')
      deps.setUpdateError(err instanceof Error ? err.message : 'Unknown error')
      deps.sendUpdateStatus()
      return { status: 'error', error: deps.getUpdateState().error }
    }
  })

  ipcMainLike.handle('updater:download', async () => {
    if (deps.getUpdateState().status !== 'available') {
      return { success: false, error: 'No update available' }
    }
    try {
      deps.setUpdateStatus('downloading')
      deps.setUpdateProgress(0)
      deps.sendUpdateStatus()
      await deps.downloadUpdate()
      return { success: true }
    } catch (err) {
      deps.setUpdateStatus('error')
      deps.setUpdateError(err instanceof Error ? err.message : 'Unknown error')
      deps.sendUpdateStatus()
      return { success: false, error: deps.getUpdateState().error }
    }
  })

  ipcMainLike.handle('updater:install', createSafeHandler('updater:install', () => {
    if (deps.getUpdateState().status !== 'ready') {
      return { success: false, error: 'Update not ready' }
    }
    deps.setIsQuitting(true)
    deps.quitAndInstall()
    return { success: true }
  }))

  ipcMainLike.handle('updater:getStatus', createSafeHandler('updater:getStatus', () => {
    return deps.getUpdateState()
  }))
}
