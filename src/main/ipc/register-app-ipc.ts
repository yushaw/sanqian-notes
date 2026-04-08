import type { BaseWindow, IpcMain, WebContentsView } from 'electron'
import type { UpdateStatus } from '../app'
import { createSafeHandler } from './safe-handler'

type IpcMainHandleLike = Pick<IpcMain, 'handle'>
const SHELL_ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const BARE_EXTERNAL_DOMAIN_PATTERN = /^[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+$/
const IPV4_OCTET_PATTERN = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4_ADDRESS_PATTERN = new RegExp(`^${IPV4_OCTET_PATTERN}(?:\\.${IPV4_OCTET_PATTERN}){3}$`)
const APP_SETTING_KEY_MAX_LENGTH = 256
const APP_SETTING_VALUE_MAX_LENGTH = 64 * 1024
const TITLE_BAR_OVERLAY_COLOR_MAX_LENGTH = 64
const EXTERNAL_URL_MAX_LENGTH = 4096
const POPUP_CONTINUE_TEXT_MAX_LENGTH = 200_000

interface TitleBarOverlayOptions {
  color: string
  symbolColor: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseNonEmptyString(
  input: unknown,
  options?: { maxLength?: number }
): string | null {
  if (typeof input !== 'string') return null
  if (input.includes('\0')) return null
  if (typeof options?.maxLength === 'number' && input.length > options.maxLength) return null
  const trimmed = input.trim()
  return trimmed ? trimmed : null
}

function parseAppSettingKeyInput(input: unknown): string | null {
  return parseNonEmptyString(input, { maxLength: APP_SETTING_KEY_MAX_LENGTH })
}

function parseAppSettingValueInput(input: unknown): string | null {
  if (typeof input !== 'string') return null
  if (input.includes('\0')) return null
  if (input.length > APP_SETTING_VALUE_MAX_LENGTH) return null
  return input
}

function parseBooleanInput(input: unknown): boolean | null {
  return typeof input === 'boolean' ? input : null
}

function parseTitleBarOverlayOptionsInput(input: unknown): TitleBarOverlayOptions | null {
  if (!isRecord(input)) return null
  const color = parseNonEmptyString(input.color, { maxLength: TITLE_BAR_OVERLAY_COLOR_MAX_LENGTH })
  const symbolColor = parseNonEmptyString(input.symbolColor, { maxLength: TITLE_BAR_OVERLAY_COLOR_MAX_LENGTH })
  if (!color || !symbolColor) return null
  return { color, symbolColor }
}

function parseExternalUrlInput(input: unknown): string | null {
  return parseNonEmptyString(input, { maxLength: EXTERNAL_URL_MAX_LENGTH })
}

function parsePopupContinueTextInput(input: unknown): string | null {
  if (typeof input !== 'string') return null
  if (input.includes('\0')) return null
  if (input.length > POPUP_CONTINUE_TEXT_MAX_LENGTH) return null
  return input
}

function isAllowedBareExternalHostname(hostname: string): boolean {
  if (!hostname) return false
  if (hostname === 'localhost') return true
  if (IPV4_ADDRESS_PATTERN.test(hostname)) return true
  return BARE_EXTERNAL_DOMAIN_PATTERN.test(hostname)
}

function resolveBareExternalUrlInput(input: string): string | null {
  if (!input || /\s/.test(input)) return null
  let parsed: URL
  try {
    parsed = new URL(`https://${input}`)
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return null
  if (!isAllowedBareExternalHostname(parsed.hostname)) return null
  return parsed.toString()
}

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
    const webContents = deps.getMainView()?.webContents
    if (webContents && !webContents.isDestroyed()) {
      try {
        webContents.send('theme:changed', dark ? 'dark' : 'light')
      } catch (err) {
        console.error('Failed to notify renderer on theme change:', err)
      }
    }
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
  ipcMainLike.handle('appSettings:get', createSafeHandler('appSettings:get', (_, keyInput: unknown) => {
    const key = parseAppSettingKeyInput(keyInput)
    if (key === null) {
      return null
    }
    return deps.getAppSetting(key)
  }))
  ipcMainLike.handle('appSettings:set', createSafeHandler('appSettings:set', (_, keyInput: unknown, valueInput: unknown) => {
    const key = parseAppSettingKeyInput(keyInput)
    const value = parseAppSettingValueInput(valueInput)
    if (key === null || value === null) {
      return
    }
    deps.setAppSetting(key, value)
  }))

  // Sanqian API URL
  ipcMainLike.handle('sanqian:getApiUrl', createSafeHandler('sanqian:getApiUrl', () => deps.getSanqianApiUrl()))

  // Window control - fullscreen
  ipcMainLike.handle('window:setFullScreen', createSafeHandler('window:setFullScreen', (_, isFullScreenInput: unknown) => {
    const isFullScreen = parseBooleanInput(isFullScreenInput)
    if (isFullScreen === null) {
      return false
    }
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
  ipcMainLike.handle('window:setTitleBarOverlay', createSafeHandler('window:setTitleBarOverlay', (_, optionsInput: unknown) => {
    const options = parseTitleBarOverlayOptionsInput(optionsInput)
    if (!options) {
      return
    }
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
  }))

  // Shell - open external URLs in default browser
  ipcMainLike.handle('shell:openExternal', createSafeHandler('shell:openExternal', async (_, urlInput: unknown) => {
    const url = parseExternalUrlInput(urlInput)
    if (!url) {
      return false
    }

    try {
      const urlObj = new URL(url)
      if (SHELL_ALLOWED_PROTOCOLS.has(urlObj.protocol)) {
        if (urlObj.username || urlObj.password) {
          return false
        }
        await deps.openExternal(url)
        return true
      }
    } catch {
      // Fallback handled below for bare domains and local hosts.
    }
    const bareUrl = resolveBareExternalUrlInput(url)
    if (bareUrl) {
      await deps.openExternal(bareUrl)
      return true
    }
    return false
  }))

  // Popup continue in chat - forward to main window
  ipcMainLike.handle('popup:continueInChat', createSafeHandler('popup:continueInChat', (_, selectedTextInput: unknown, explanationInput: unknown) => {
    const selectedText = parsePopupContinueTextInput(selectedTextInput)
    const explanation = parsePopupContinueTextInput(explanationInput)
    if (selectedText === null || explanation === null) {
      return
    }
    const mainWindow = deps.getMainWindow()
    const mainView = deps.getMainView()
    const webContents = mainView?.webContents
    if (!mainWindow || !webContents || mainWindow.isDestroyed() || webContents.isDestroyed()) {
      return
    }
    try {
      webContents.send('popup:openChatWithContext', selectedText, explanation)
      mainWindow.show()
      mainWindow.focus()
    } catch (err) {
      console.error('[popup:continueInChat] failed:', err)
    }
  }))

  // App version
  ipcMainLike.handle('app:getVersion', createSafeHandler('app:getVersion', () => {
    return deps.getAppVersion()
  }))

  // Auto updater IPC handlers
  ipcMainLike.handle('updater:check', async () => {
    try {
      if (deps.isDev) {
        return { status: 'not-available' as UpdateStatus }
      }
      deps.setUpdateStatus('checking')
      deps.setUpdateError(null)
      deps.sendUpdateStatus()
      await deps.checkForUpdates()
      const state = deps.getUpdateState()
      return { status: state.status, version: state.version }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      try {
        deps.setUpdateStatus('error')
        deps.setUpdateError(errorMessage)
        deps.sendUpdateStatus()
      } catch (statusErr) {
        console.error('[updater:check] Failed to publish error state:', statusErr)
      }
      return { status: 'error', error: errorMessage }
    }
  })

  ipcMainLike.handle('updater:download', async () => {
    try {
      if (deps.getUpdateState().status !== 'available') {
        return { success: false, error: 'No update available' }
      }
      deps.setUpdateStatus('downloading')
      deps.setUpdateProgress(0)
      deps.sendUpdateStatus()
      await deps.downloadUpdate()
      return { success: true }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      try {
        deps.setUpdateStatus('error')
        deps.setUpdateError(errorMessage)
        deps.sendUpdateStatus()
      } catch (statusErr) {
        console.error('[updater:download] Failed to publish error state:', statusErr)
      }
      return { success: false, error: errorMessage }
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
