import type { BaseWindow, IpcMain, WebContentsView } from 'electron'
import type { NavigationResolverDeps } from '../navigation-resolver'
import { createSafeHandler } from './safe-handler'

type IpcMainLike = Pick<IpcMain, 'handle' | 'on'>
const CHAT_CONTEXT_MAX_LENGTH = 200_000
const CHAT_NOTE_ID_MAX_LENGTH = 4_096
const CHAT_NAVIGATE_TARGET_VALUE_MAX_LENGTH = 4_096
const CHAT_THEME_ACCENT_COLOR_MAX_LENGTH = 64
const CHAT_STREAM_ID_MAX_LENGTH = 512
const CHAT_STREAM_CONVERSATION_ID_MAX_LENGTH = 512
const CHAT_STREAM_MESSAGE_MAX_COUNT = 200
const CHAT_STREAM_MESSAGE_CONTENT_MAX_LENGTH = 1_000_000

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

interface ChatNavigateTarget {
  type: 'heading' | 'block'
  value: string
}

interface ChatNavigatePayload {
  noteId: string
  target?: ChatNavigateTarget
}

type ChatThemeColorMode = 'light' | 'dark'
type ChatThemeLocale = 'en' | 'zh'
type ChatThemeFontSize = 'small' | 'normal' | 'large' | 'extra-large'

interface ChatThemeSyncPayload {
  colorMode: ChatThemeColorMode
  accentColor: string
  locale: ChatThemeLocale
  fontSize?: ChatThemeFontSize
}

type ChatStreamRole = 'user' | 'assistant'
type ChatStreamAgentType = 'assistant' | 'writing' | 'generator'

interface ChatStreamMessage {
  role: ChatStreamRole
  content: string
}

interface ChatStreamPayload {
  streamId: string
  messages: ChatStreamMessage[]
  conversationId?: string
  agentId?: ChatStreamAgentType
}

interface ChatCancelStreamPayload {
  streamId: string
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
  resolveRendererNoteIdForNavigation: (noteIdInput: unknown, deps: NavigationResolverDeps) => string | null
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
      options: { conversationId?: string; signal?: AbortSignal }
    ) => AsyncGenerator<unknown, unknown, unknown>
  } | null
  ensureAgentReady: (agentType: 'assistant' | 'writing' | 'generator') => Promise<{ agentId: string }>
  // User context
  getCurrentNoteContext: () => ChatNoteContextPayload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseBoundedString(
  input: unknown,
  options: { maxLength: number; trim?: boolean; allowEmpty?: boolean }
): string | null {
  if (typeof input !== 'string') return null
  if (input.includes('\0')) return null
  if (input.length > options.maxLength) return null
  const value = options.trim ? input.trim() : input
  if (options.allowEmpty === false && !value) return null
  return value
}

function sendWebContentsEvent(
  webContents: Electron.WebContents | null | undefined,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!webContents || webContents.isDestroyed()) return false
  try {
    webContents.send(channel, ...args)
    return true
  } catch (err) {
    console.error(`[chat-ipc] failed to send "${channel}" event:`, err)
    return false
  }
}

function parseChatWindowContextInput(contextInput: unknown): string | null {
  return parseBoundedString(contextInput, { maxLength: CHAT_CONTEXT_MAX_LENGTH })
}

function parseChatNavigateTarget(targetInput: unknown): ChatNavigateTarget | undefined {
  if (!isRecord(targetInput)) return undefined

  const typeInput = targetInput.type
  const valueInput = parseBoundedString(targetInput.value, {
    maxLength: CHAT_NAVIGATE_TARGET_VALUE_MAX_LENGTH,
    trim: true,
    allowEmpty: false,
  })
  if ((typeInput !== 'heading' && typeInput !== 'block') || valueInput === null) {
    return undefined
  }

  return {
    type: typeInput,
    value: valueInput,
  }
}

function parseChatNavigatePayload(payloadInput: unknown): ChatNavigatePayload | null {
  if (!isRecord(payloadInput)) return null

  const noteIdInput = parseBoundedString(payloadInput.noteId, {
    maxLength: CHAT_NOTE_ID_MAX_LENGTH,
    trim: true,
    allowEmpty: false,
  })
  if (noteIdInput === null) {
    return null
  }

  const target = parseChatNavigateTarget(payloadInput.target)
  if (Object.prototype.hasOwnProperty.call(payloadInput, 'target') && target === undefined) {
    return null
  }
  return target
    ? { noteId: noteIdInput, target }
    : { noteId: noteIdInput }
}

function parseThemeSyncPayload(settingsInput: unknown): ChatThemeSyncPayload | null {
  if (!isRecord(settingsInput)) return null

  const colorModeInput = settingsInput.colorMode
  const accentColorInput = settingsInput.accentColor
  const localeInput = settingsInput.locale
  const fontSizeInput = settingsInput.fontSize

  const accentColor = parseBoundedString(accentColorInput, {
    maxLength: CHAT_THEME_ACCENT_COLOR_MAX_LENGTH,
    trim: true,
    allowEmpty: false,
  })

  if ((colorModeInput !== 'light' && colorModeInput !== 'dark') || accentColor === null) {
    return null
  }
  if (localeInput !== 'en' && localeInput !== 'zh') return null

  if (fontSizeInput !== undefined) {
    if (
      fontSizeInput !== 'small'
      && fontSizeInput !== 'normal'
      && fontSizeInput !== 'large'
      && fontSizeInput !== 'extra-large'
    ) {
      return null
    }
  }

  return {
    colorMode: colorModeInput,
    accentColor,
    locale: localeInput,
    fontSize: fontSizeInput,
  }
}

function parseChatStreamPayload(paramsInput: unknown): ChatStreamPayload | null {
  if (!isRecord(paramsInput)) return null

  const streamIdInput = paramsInput.streamId
  const messagesInput = paramsInput.messages
  const conversationIdInput = paramsInput.conversationId
  const agentIdInput = paramsInput.agentId

  const streamId = parseBoundedString(streamIdInput, {
    maxLength: CHAT_STREAM_ID_MAX_LENGTH,
    trim: true,
    allowEmpty: false,
  })
  if (streamId === null) return null
  if (!Array.isArray(messagesInput) || messagesInput.length === 0) return null
  if (messagesInput.length > CHAT_STREAM_MESSAGE_MAX_COUNT) return null

  const messages: ChatStreamMessage[] = []
  for (const messageInput of messagesInput) {
    if (!isRecord(messageInput)) return null
    const roleInput = messageInput.role
    const contentInput = parseBoundedString(messageInput.content, {
      maxLength: CHAT_STREAM_MESSAGE_CONTENT_MAX_LENGTH,
    })
    if ((roleInput !== 'user' && roleInput !== 'assistant') || contentInput === null) {
      return null
    }
    messages.push({
      role: roleInput,
      content: contentInput,
    })
  }

  let conversationId: string | undefined
  if (conversationIdInput !== undefined) {
    const parsedConversationId = parseBoundedString(conversationIdInput, {
      maxLength: CHAT_STREAM_CONVERSATION_ID_MAX_LENGTH,
      trim: true,
    })
    if (parsedConversationId === null) return null
    if (parsedConversationId) {
      conversationId = parsedConversationId
    }
  }

  let agentId: ChatStreamAgentType | undefined
  if (agentIdInput !== undefined) {
    if (
      agentIdInput !== 'assistant'
      && agentIdInput !== 'writing'
      && agentIdInput !== 'generator'
    ) {
      return null
    }
    agentId = agentIdInput
  }

  return {
    streamId,
    messages,
    conversationId,
    agentId,
  }
}

function parseChatCancelStreamPayload(paramsInput: unknown): ChatCancelStreamPayload | null {
  if (!isRecord(paramsInput)) return null
  const streamId = parseBoundedString(paramsInput.streamId, {
    maxLength: CHAT_STREAM_ID_MAX_LENGTH,
    trim: true,
    allowEmpty: false,
  })
  if (streamId === null) return null
  return { streamId }
}

export function registerChatIpc(
  ipcMainLike: IpcMainLike,
  deps: ChatIpcDeps
): void {
  const sendCurrentNoteContext = (): void => {
    const chatPanel = deps.getChatPanel()
    const webContents = chatPanel?.getWebContents()
    sendWebContentsEvent(webContents, 'chatWindow:noteContextChanged', deps.getCurrentNoteContext())
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

  ipcMainLike.handle('chatWindow:showWithContext', async (_, contextInput: unknown) => {
    const context = parseChatWindowContextInput(contextInput)
    if (context === null) {
      return { success: false, error: 'Invalid context payload' }
    }

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
              sendWebContentsEvent(webContents, 'chatWindow:setContext', context)
              setTimeout(() => deps.getChatPanel()?.focusInput(), 50)
            } catch {
              // Window may have been destroyed during load
            }
          }
        })
      } else {
        sendCurrentNoteContext()
        sendWebContentsEvent(webContents, 'chatWindow:setContext', context)
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
  ipcMainLike.on('chat:navigate-to-note', (_, payload: unknown) => {
    const parsedPayload = parseChatNavigatePayload(payload)
    if (!parsedPayload) {
      console.warn('[chat:navigate-to-note] Invalid payload, skipping navigation')
      return
    }

    const resolvedNoteId = deps.resolveRendererNoteIdForNavigation(
      parsedPayload.noteId,
      deps.navigationResolverDeps
    )
    if (typeof resolvedNoteId !== 'string' || !resolvedNoteId.trim()) {
      console.warn('[chat:navigate-to-note] Failed to resolve note id, skipping navigation')
      return
    }

    const mainWindow = deps.getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.show()
      mainWindow.focus()
    }

    const mainViewWebContents = deps.getMainView()?.webContents
    sendWebContentsEvent(mainViewWebContents, 'note:navigate', {
      noteId: resolvedNoteId,
      target: parsedPayload.target,
    })
  })

  // Theme sync: main window notifies theme changes, chat window retrieves settings
  ipcMainLike.handle('theme:sync', async (_, settingsInput: unknown) => {
    const settings = parseThemeSyncPayload(settingsInput)
    if (!settings) {
      return { success: false, error: 'Invalid theme settings payload' }
    }

    try {
      const localeChanged = deps.getThemeSettings().locale !== settings.locale
      deps.setThemeSettings(settings)

      const chatPanel = deps.getChatPanel()
      const webContents = chatPanel?.getWebContents()
      sendWebContentsEvent(webContents, 'theme:updated', settings)

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
    } catch (err) {
      console.error('[Notes] theme:sync failed:', err)
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
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

  ipcMainLike.handle('chat:stream', async (event, paramsInput: unknown) => {
    const params = parseChatStreamPayload(paramsInput)
    if (!params) {
      return { success: false, error: 'Invalid chat:stream payload' }
    }

    const sendStreamEvent = (payload: { streamId: string; event: unknown }): boolean => {
      if (event.sender.isDestroyed()) return false
      try {
        event.sender.send('chat:streamEvent', payload)
        return true
      } catch (sendError) {
        console.error('[chat:stream] failed to send stream event:', sendError)
        return false
      }
    }

    const existingStream = activeStreams.get(params.streamId)
    if (existingStream) {
      await existingStream.cancel()
      existingStream.sendDone()
      if (activeStreams.get(params.streamId) === existingStream) {
        activeStreams.delete(params.streamId)
      }
    }

    const client = deps.getClient()
    if (!client) {
      return { success: false, error: 'Client not initialized' }
    }

    let streamEntry: {
      cancel: () => Promise<void>
      sendDone: () => void
    } | null = null

    try {
      const agentType: ChatStreamAgentType =
        params.agentId === 'writing' ? 'writing' :
        params.agentId === 'generator' ? 'generator' : 'assistant'
      const { agentId } = await deps.ensureAgentReady(agentType)

      let cancelled = false
      const abortController = new AbortController()
      let stream:
        | AsyncGenerator<unknown, unknown, unknown>
        | null = null

      streamEntry = {
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
          sendStreamEvent({
            streamId: params.streamId,
            event: { type: 'done', conversationId: params.conversationId ?? '' }
          })
        }
      }
      activeStreams.set(params.streamId, streamEntry)

      const streamOptions: { conversationId?: string; signal: AbortSignal } = {
        signal: abortController.signal
      }
      if (params.conversationId) {
        streamOptions.conversationId = params.conversationId
      }
      stream = client.chatStream(
        agentId,
        params.messages,
        streamOptions
      )
      const streamIterator = stream

      ;(async () => {
        try {
          for await (const streamEvent of streamIterator) {
            if (cancelled) break
            if (!sendStreamEvent({ streamId: params.streamId, event: streamEvent })) break
          }
        } catch (err) {
          if (!cancelled) {
            sendStreamEvent({
              streamId: params.streamId,
              event: { type: 'error', error: err instanceof Error ? err.message : 'Stream error' }
            })
          }
        } finally {
          if (activeStreams.get(params.streamId) === streamEntry) {
            activeStreams.delete(params.streamId)
          }
        }
      })()

      return { success: true }
    } catch (error) {
      if (streamEntry && activeStreams.get(params.streamId) === streamEntry) {
        activeStreams.delete(params.streamId)
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMainLike.handle('chat:cancelStream', createSafeHandler('chat:cancelStream', async (_, paramsInput: unknown) => {
    const params = parseChatCancelStreamPayload(paramsInput)
    if (!params) {
      return { success: false, error: 'Invalid chat:cancelStream payload' }
    }

    const stream = activeStreams.get(params.streamId)
    if (stream) {
      await stream.cancel()
      stream.sendDone()
      if (activeStreams.get(params.streamId) === stream) {
        activeStreams.delete(params.streamId)
      }
      return { success: true }
    }
    return { success: false }
  }))
}
