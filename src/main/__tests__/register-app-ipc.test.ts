import { describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../app'
import type { AppIpcDeps } from '../ipc/register-app-ipc'
import { registerAppIpc } from '../ipc/register-app-ipc'

type Handler = (...args: unknown[]) => unknown

function createIpcMainLike() {
  const channels = new Map<string, Handler>()
  return {
    channels,
    ipcMainLike: {
      handle: vi.fn((channel: string, listener: Handler) => {
        channels.set(channel, listener)
      }),
    },
  }
}

function createDeps(overrides: Partial<AppIpcDeps> = {}): AppIpcDeps {
  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    setTitleBarOverlay: vi.fn(),
    setFullScreen: vi.fn(),
    isFullScreen: vi.fn(() => false),
    close: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  }
  const mainView = {
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
  }

  return {
    getDataPath: vi.fn(() => '/tmp/sanqian'),
    getAppVersion: vi.fn(() => '0.0.0-test'),
    isDev: false,
    shouldUseDarkColors: vi.fn(() => false),
    onNativeThemeUpdated: vi.fn(() => undefined),
    getAppSetting: vi.fn(() => 'value'),
    setAppSetting: vi.fn(),
    getSanqianApiUrl: vi.fn(() => null),
    getMainWindow: vi.fn(() => mainWindow as unknown as ReturnType<AppIpcDeps['getMainWindow']>),
    getMainView: vi.fn(() => mainView as unknown as ReturnType<AppIpcDeps['getMainView']>),
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
    getUpdateState: vi.fn(() => ({ status: 'idle' as UpdateStatus, version: null, error: null })),
    setUpdateStatus: vi.fn(),
    setUpdateError: vi.fn(),
    setUpdateProgress: vi.fn(),
    sendUpdateStatus: vi.fn(),
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    setIsQuitting: vi.fn(),
    ...overrides,
  }
}

describe('register-app-ipc', () => {
  it('registers app IPC channels', () => {
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, createDeps())

    expect(ipcMainLike.handle).toHaveBeenCalledTimes(18)
    expect(channels.has('appSettings:get')).toBe(true)
    expect(channels.has('window:setFullScreen')).toBe(true)
    expect(channels.has('window:setTitleBarOverlay')).toBe(true)
    expect(channels.has('shell:openExternal')).toBe(true)
  })

  it('fails closed for invalid appSettings:get key payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('appSettings:get')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 123)).resolves.toBeNull()
    expect(deps.getAppSetting).not.toHaveBeenCalled()
  })

  it('fails closed for invalid appSettings:set payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('appSettings:set')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, '', 'ok')).resolves.toBeUndefined()
    await expect(handler({}, 'valid-key', 123)).resolves.toBeUndefined()
    await expect(handler({}, 'k'.repeat(257), 'ok')).resolves.toBeUndefined()
    await expect(handler({}, 'valid-key', 'v'.repeat(64 * 1024 + 1))).resolves.toBeUndefined()
    expect(deps.setAppSetting).not.toHaveBeenCalled()
  })

  it('fails closed for invalid window:setFullScreen payload', async () => {
    const mainWindow = {
      setFullScreen: vi.fn(),
    }
    const deps = createDeps({
      getMainWindow: vi.fn(() => mainWindow as unknown as ReturnType<AppIpcDeps['getMainWindow']>),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('window:setFullScreen')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'true')).resolves.toBe(false)
    expect(mainWindow.setFullScreen).not.toHaveBeenCalled()
  })

  it('fails closed for invalid shell:openExternal payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('shell:openExternal')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 42)).resolves.toBe(false)
    await expect(handler({}, 'https://example.com/' + 'a'.repeat(5000))).resolves.toBe(false)
    expect(deps.openExternal).not.toHaveBeenCalled()
  })

  it('normalizes bare-domain shell:openExternal payload to https', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('shell:openExternal')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'example.com')).resolves.toBe(true)
    expect(deps.openExternal).toHaveBeenCalledWith('https://example.com/')
  })

  it('accepts bare-domain shell:openExternal payload with port and path', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('shell:openExternal')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'example.com:3000/docs?q=1')).resolves.toBe(true)
    expect(deps.openExternal).toHaveBeenCalledWith('https://example.com:3000/docs?q=1')
  })

  it('accepts localhost shell:openExternal payload with port', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('shell:openExternal')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'localhost:5173')).resolves.toBe(true)
    expect(deps.openExternal).toHaveBeenCalledWith('https://localhost:5173/')
  })

  it('rejects shell:openExternal with disallowed protocol', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('shell:openExternal')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'javascript:alert(1)')).resolves.toBe(false)
    expect(deps.openExternal).not.toHaveBeenCalled()
  })

  it('rejects shell:openExternal bare-host credential alias input', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('shell:openExternal')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'example.com@evil.com')).resolves.toBe(false)
    expect(deps.openExternal).not.toHaveBeenCalled()
  })

  it('rejects shell:openExternal full-url credential input', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('shell:openExternal')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'https://example.com@evil.com/path')).resolves.toBe(false)
    expect(deps.openExternal).not.toHaveBeenCalled()
  })

  it('ignores invalid window:setTitleBarOverlay payload', async () => {
    const deps = createDeps()
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('window:setTitleBarOverlay')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { color: '#fff' })).resolves.toBeUndefined()
  })

  it('fails closed for invalid popup:continueInChat payload', async () => {
    const mainWindow = {
      show: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      setTitleBarOverlay: vi.fn(),
      setFullScreen: vi.fn(),
      isFullScreen: vi.fn(() => false),
      close: vi.fn(),
    }
    const send = vi.fn()
    const mainView = {
      webContents: {
        isDestroyed: vi.fn(() => false),
        send,
      },
    }
    const deps = createDeps({
      getMainWindow: vi.fn(() => mainWindow as unknown as ReturnType<AppIpcDeps['getMainWindow']>),
      getMainView: vi.fn(() => mainView as unknown as ReturnType<AppIpcDeps['getMainView']>),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('popup:continueInChat')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, { text: 'bad' }, 'ok')).resolves.toBeUndefined()
    await expect(handler({}, 'ok', 123)).resolves.toBeUndefined()
    await expect(handler({}, 'x'.repeat(200_001), 'ok')).resolves.toBeUndefined()
    expect(send).not.toHaveBeenCalled()
    expect(mainWindow.show).not.toHaveBeenCalled()
    expect(mainWindow.focus).not.toHaveBeenCalled()
  })

  it('ignores popup:continueInChat when window or renderer is destroyed', async () => {
    const mainWindow = {
      show: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => true),
      setTitleBarOverlay: vi.fn(),
      setFullScreen: vi.fn(),
      isFullScreen: vi.fn(() => false),
      close: vi.fn(),
    }
    const send = vi.fn()
    const mainView = {
      webContents: {
        isDestroyed: vi.fn(() => false),
        send,
      },
    }
    const deps = createDeps({
      getMainWindow: vi.fn(() => mainWindow as unknown as ReturnType<AppIpcDeps['getMainWindow']>),
      getMainView: vi.fn(() => mainView as unknown as ReturnType<AppIpcDeps['getMainView']>),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('popup:continueInChat')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'selected', 'explain')).resolves.toBeUndefined()
    expect(send).not.toHaveBeenCalled()
    expect(mainWindow.show).not.toHaveBeenCalled()
    expect(mainWindow.focus).not.toHaveBeenCalled()
  })

  it('swallows popup:continueInChat renderer send errors', async () => {
    const mainWindow = {
      show: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      setTitleBarOverlay: vi.fn(),
      setFullScreen: vi.fn(),
      isFullScreen: vi.fn(() => false),
      close: vi.fn(),
    }
    const mainView = {
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: vi.fn(() => {
          throw new Error('send failed')
        }),
      },
    }
    const deps = createDeps({
      getMainWindow: vi.fn(() => mainWindow as unknown as ReturnType<AppIpcDeps['getMainWindow']>),
      getMainView: vi.fn(() => mainView as unknown as ReturnType<AppIpcDeps['getMainView']>),
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('popup:continueInChat')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({}, 'selected', 'explain')).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith('[popup:continueInChat] failed:', expect.any(Error))
    expect(mainWindow.show).not.toHaveBeenCalled()
    expect(mainWindow.focus).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('swallows renderer send errors from native theme update callback', () => {
    let themeUpdatedCallback: (() => void) | null = null
    const deps = createDeps({
      onNativeThemeUpdated: vi.fn((callback: () => void) => {
        themeUpdatedCallback = callback
      }),
      getMainView: vi.fn(() => ({
        webContents: {
          isDestroyed: vi.fn(() => false),
          send: vi.fn(() => {
            throw new Error('send failed')
          }),
        },
      }) as unknown as ReturnType<AppIpcDeps['getMainView']>),
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ipcMainLike } = createIpcMainLike()

    registerAppIpc(ipcMainLike, deps)
    expect(themeUpdatedCallback).toBeTypeOf('function')
    if (!themeUpdatedCallback) return

    expect(() => themeUpdatedCallback?.()).not.toThrow()
    expect(errorSpy).toHaveBeenCalledWith('Failed to notify renderer on theme change:', expect.any(Error))
    errorSpy.mockRestore()
  })

  it('updater:check returns typed error when update state transition throws', async () => {
    const deps = createDeps({
      setUpdateStatus: vi.fn(() => {
        throw new Error('status write failed')
      }),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('updater:check')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({})).resolves.toEqual({
      status: 'error',
      error: 'status write failed',
    })
    expect(deps.checkForUpdates).not.toHaveBeenCalled()
  })

  it('updater:download returns typed error when update state lookup throws', async () => {
    const deps = createDeps({
      getUpdateState: vi.fn(() => {
        throw new Error('state read failed')
      }),
    })
    const { channels, ipcMainLike } = createIpcMainLike()
    registerAppIpc(ipcMainLike, deps)

    const handler = channels.get('updater:download')
    expect(handler).toBeDefined()
    if (!handler) return

    await expect(handler({})).resolves.toEqual({
      success: false,
      error: 'state read failed',
    })
    expect(deps.downloadUpdate).not.toHaveBeenCalled()
  })
})
