import type { BaseWindow, IpcMain, WebContentsView } from 'electron'
import type { NavigationResolverDeps } from '../navigation-resolver'
import { createSafeHandler } from './safe-handler'

type IpcMainLike = Pick<IpcMain, 'handle' | 'on'>

interface ChatPanelLike {
  show: () => void
  hide: () => void
  toggle: () => void
  isVisible: () => boolean
  getWebContents: () => Electron.WebContents | null
  focusInput: () => void
  notifyLocaleChanged: (locale: string) => void
}

interface ChatNoteContextPayload {
  noteId: string | null
  noteTitle: string | null
}

export interface ChatIpcDeps {
  // ChatPanel access
  getChatPanel: () => ChatPanelLike | null
  // Window access
  getMainWindow: () => BaseWindow | null
  getMainView: () => WebContentsView | null
  // Session resources
  pushPinnedSelectionResource: () => Promise<unknown>
  // Note navigation
  resolveRendererNoteIdForNavigation: (noteId: string, deps: NavigationResolverDeps) => string
  navigationResolverDeps: NavigationResolverDeps
  // Theme
  getThemeSettings: () => { locale?: string }
  setThemeSettings: (settings: {
    colorMode: 'light' | 'dark'
    accentColor: string
    locale: 'en' | 'zh'
    fontSize?: 'small' | 'normal' | 'large' | 'extra-large'
  }) => void
  setAppLocale: (locale: 'en' | 'zh') => void
  updateSdkContexts: () => Promise<void>
  // Chat streaming
  acquireReconnect: () => void
  releaseReconnect: () => void
  getClient: () => {
    chatStream: (
      agentId: string,
      messages: Array<{ role: 'user' | 'assistant'; content: string }>,
      options: { conversationId?: string }
    ) => AsyncGenerator<unknown, unknown, unknown>
  } | null
  ensureAgentReady: (agentType: 'assistant' | 'writing' | 'generator') => Promise<{ agentId: string }>
  // User context
  getCurrentNoteContext: () => ChatNoteContextPayload
}

export function registerChatIpc(
  ipcMainLike: IpcMainLike,
  deps: ChatIpcDeps
): void {
  const sendCurrentNoteContext = (): void => {
    const chatPanel = deps.getChatPanel()
    const webContents = chatPanel?.getWebContents()
    if (!webContents || webContents.isDestroyed()) {
      return
    }
    webContents.send('chatWindow:noteContextChanged', deps.getCurrentNoteContext())
  }

  // ============ Chat Window Control ============
  ipcMainLike.handle('chatWindow:show', createSafeHandler('chatWindow:show', () => {
    const chatPanel = deps.getChatPanel()
    if (!chatPanel) {
      return { success: false, error: 'ChatPanel not initialized' }
    }
    chatPanel.show()
    sendCurrentNoteContext()
    return { success: true }
  }))

  ipcMainLike.handle('chatWindow:showWithContext', async (_, context: string) => {
    const chatPanel = deps.getChatPanel()
    if (!chatPanel) {
      return { success: false, error: 'ChatPanel not initialized' }
    }
    try {
      await deps.pushPinnedSelectionResource()

      chatPanel.show()
      const webContents = chatPanel.getWebContents()
      if (!webContents || webContents.isDestroyed()) {
        return { success: false, error: 'Chat window not available' }
      }

      if (webContents.isLoading()) {
        webContents.once('did-finish-load', () => {
          if (!webContents.isDestroyed()) {
            try {
              sendCurrentNoteContext()
              webContents.send('chatWindow:setContext', context)
              setTimeout(() => deps.getChatPanel()?.focusInput(), 50)
            } catch {
              // Window may have been destroyed during load
            }
          }
        })
      } else {
        sendCurrentNoteContext()
        webContents.send('chatWindow:setContext', context)
        setTimeout(() => deps.getChatPanel()?.focusInput(), 50)
      }
      return { success: true }
    } catch (err) {
      console.error('[ChatWindow] showWithContext failed:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  ipcMainLike.handle('chatWindow:hide', createSafeHandler('chatWindow:hide', () => {
    const chatPanel = deps.getChatPanel()
    if (!chatPanel) {
      return { success: false, error: 'ChatPanel not initialized' }
    }
    chatPanel.hide()
    return { success: true }
  }))

  ipcMainLike.handle('chatWindow:toggle', createSafeHandler('chatWindow:toggle', () => {
    const chatPanel = deps.getChatPanel()
    if (!chatPanel) {
      return { success: false, error: 'ChatPanel not initialized' }
    }
    chatPanel.toggle()
    return { success: true }
  }))

  ipcMainLike.handle('chatWindow:isVisible', createSafeHandler('chatWindow:isVisible', () => {
    return deps.getChatPanel()?.isVisible() ?? false
  }))
  ipcMainLike.handle('chatWindow:getNoteContext', createSafeHandler('chatWindow:getNoteContext', () => {
    return deps.getCurrentNoteContext()
  }))

  // Handle note navigation from chat window (triggered by sanqian-notes:// links)
  ipcMainLike.on('chat:navigate-to-note', (_, payload: { noteId: string; target?: { type: 'heading' | 'block'; value: string } }) => {
    const { noteId, target } = payload
    const resolvedNoteId = deps.resolveRendererNoteIdForNavigation(noteId, deps.navigationResolverDeps)

    const mainWindow = deps.getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
      mainWindow.focus()
    }

    deps.getMainView()?.webContents.send('note:navigate', { noteId: resolvedNoteId, target })
  })

  // Theme sync: main window notifies theme changes, chat window retrieves settings
  ipcMainLike.handle('theme:sync', async (_, settings: { colorMode: 'light' | 'dark'; accentColor: string; locale: 'en' | 'zh'; fontSize?: 'small' | 'normal' | 'large' | 'extra-large' }) => {
    const localeChanged = deps.getThemeSettings().locale !== settings.locale
    deps.setThemeSettings(settings)

    const chatPanel = deps.getChatPanel()
    const webContents = chatPanel?.getWebContents()
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('theme:updated', settings)
    }

    if (localeChanged) {
      try {
        deps.setAppLocale(settings.locale)
        await deps.updateSdkContexts()
        chatPanel?.notifyLocaleChanged(settings.locale)
      } catch (err) {
        console.error('[Notes] Failed to update SDK contexts on locale change:', err)
      }
    }
    return { success: true }
  })

  ipcMainLike.handle('theme:getSettings', createSafeHandler('theme:getSettings', () => {
    return deps.getThemeSettings()
  }))

  // ============ Chat API for AI actions (main window inline streaming) ============
  const activeStreams = new Map<string, {
    cancel: () => Promise<void>
    sendDone: () => void
  }>()

  ipcMainLike.handle('chat:acquireReconnect', createSafeHandler('chat:acquireReconnect', () => {
    deps.acquireReconnect()
  }))

  ipcMainLike.handle('chat:releaseReconnect', createSafeHandler('chat:releaseReconnect', () => {
    deps.releaseReconnect()
  }))

  ipcMainLike.handle('chat:stream', async (event, params: {
    streamId: string
    messages: Array<{ role: string; content: string }>
    conversationId?: string
    agentId?: string
  }) => {
    const client = deps.getClient()
    if (!client) {
      return { success: false, error: 'Client not initialized' }
    }

    try {
      const agentType: 'assistant' | 'writing' | 'generator' =
        params.agentId === 'writing' ? 'writing' :
        params.agentId === 'generator' ? 'generator' : 'assistant'
      const { agentId } = await deps.ensureAgentReady(agentType)

      let cancelled = false
      const abortController = new AbortController()
      let stream:
        | AsyncGenerator<unknown, unknown, unknown>
        | null = null

      activeStreams.set(params.streamId, {
        cancel: async () => {
          if (cancelled) return
          cancelled = true
          abortController.abort()
          if (stream && typeof stream.return === 'function') {
            try {
              await stream.return(undefined)
            } catch {
              // Ignore cancellation errors during forced stream teardown.
            }
          }
        },
        sendDone: () => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('chat:streamEvent', {
              streamId: params.streamId,
              event: { type: 'done', conversationId: params.conversationId ?? '' }
            })
          }
        }
      })

      const streamOptions: { conversationId?: string; signal: AbortSignal } = {
        signal: abortController.signal
      }
      if (params.conversationId) {
        streamOptions.conversationId = params.conversationId
      }
      stream = client.chatStream(
        agentId,
        params.messages as Array<{ role: 'user' | 'assistant'; content: string }>,
        streamOptions as { conversationId?: string }
      )
      const streamIterator = stream

      ;(async () => {
        try {
          for await (const streamEvent of streamIterator) {
            if (cancelled) break
            if (event.sender.isDestroyed()) {
              break
            }
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
          activeStreams.delete(params.streamId)
        }
      })()

      return { success: true }
    } catch (error) {
      activeStreams.delete(params.streamId)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMainLike.handle('chat:cancelStream', createSafeHandler('chat:cancelStream', async (_, params: { streamId: string }) => {
    const stream = activeStreams.get(params.streamId)
    if (stream) {
      await stream.cancel()
      stream.sendDone()
      activeStreams.delete(params.streamId)
      return { success: true }
    }
    return { success: false }
  }))
}
