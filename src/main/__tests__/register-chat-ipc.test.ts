import { describe, expect, it, vi } from 'vitest'
import { registerChatIpc, type ChatIpcDeps } from '../ipc/register-chat-ipc'

type Handler = (...args: unknown[]) => unknown

function createIpcMainLike() {
  const handleChannels = new Map<string, Handler>()
  const onChannels = new Map<string, Handler>()
  return {
    handleChannels,
    onChannels,
    ipcMainLike: {
      handle: vi.fn((channel: string, listener: Handler) => {
        handleChannels.set(channel, listener)
      }),
      on: vi.fn((channel: string, listener: Handler) => {
        onChannels.set(channel, listener)
      }),
    },
  }
}

function createDeps() {
  const sendMock = vi.fn()
  const chatWebContents = {
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    isLoading: vi.fn(() => false),
    once: vi.fn(),
  }
  const chatPanel = {
    show: vi.fn(),
    hide: vi.fn(),
    toggle: vi.fn(),
    isVisible: vi.fn(() => false),
    getWebContents: vi.fn(() => chatWebContents as any),
    focusInput: vi.fn(),
    notifyLocaleChanged: vi.fn(),
  }
  const mainWindow = {
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  }
  const navigationResolverDeps = {
    getNoteById: vi.fn(() => null),
    getLocalNoteIdentityByUid: vi.fn(() => null),
  }
  const deps: ChatIpcDeps = {
    getChatPanel: vi.fn(() => chatPanel as any),
    getMainWindow: vi.fn(() => mainWindow as any),
    getMainView: vi.fn(() => ({ webContents: { send: sendMock, isDestroyed: () => false } } as any)),
    pushPinnedSelectionResource: vi.fn(async () => undefined),
    resolveRendererNoteIdForNavigation: vi.fn(() => 'note-1'),
    navigationResolverDeps,
    getThemeSettings: vi.fn(() => ({ locale: 'en' })),
    setThemeSettings: vi.fn(),
    setAppLocale: vi.fn(),
    updateSdkContexts: vi.fn(async () => undefined),
    acquireReconnect: vi.fn(),
    releaseReconnect: vi.fn(),
    getClient: vi.fn(() => null),
    ensureAgentReady: vi.fn(async () => ({ agentId: 'assistant' })),
    getCurrentNoteContext: vi.fn(() => ({ noteId: null, noteTitle: null })),
  }
  return { deps, sendMock, mainWindow, chatPanel, chatWebContents }
}

describe('register-chat-ipc chat:navigate-to-note payload hardening', () => {
  it('fails closed for invalid payload shape without throwing', () => {
    const { deps, sendMock } = createDeps()
    const { onChannels, ipcMainLike } = createIpcMainLike()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tooLongNoteId = 'x'.repeat(4097)

    registerChatIpc(ipcMainLike as any, deps)

    const navigateToNote = onChannels.get('chat:navigate-to-note')
    expect(navigateToNote).toBeDefined()
    if (!navigateToNote) return

    expect(() => navigateToNote({}, null)).not.toThrow()
    expect(() => navigateToNote({}, { noteId: {} })).not.toThrow()
    expect(() => navigateToNote({}, { noteId: '   ' })).not.toThrow()
    expect(() => navigateToNote({}, { noteId: tooLongNoteId })).not.toThrow()

    expect(deps.resolveRendererNoteIdForNavigation).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('fails closed when target payload is explicitly invalid', () => {
    const { deps, sendMock, mainWindow } = createDeps()
    const { onChannels, ipcMainLike } = createIpcMainLike()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mainWindow.isMinimized.mockReturnValue(true)
    vi.mocked(deps.resolveRendererNoteIdForNavigation).mockReturnValue('local:nb-1:docs%2Fplan.md')

    registerChatIpc(ipcMainLike as any, deps)

    const navigateToNote = onChannels.get('chat:navigate-to-note')
    expect(navigateToNote).toBeDefined()
    if (!navigateToNote) return

    navigateToNote({}, {
      noteId: 'note-1',
      target: { type: 'bad', value: 'hello' },
    })

    expect(deps.resolveRendererNoteIdForNavigation).not.toHaveBeenCalled()
    expect(mainWindow.restore).not.toHaveBeenCalled()
    expect(mainWindow.show).not.toHaveBeenCalled()
    expect(mainWindow.focus).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('swallows renderer send failures when dispatching note navigation', () => {
    const { deps, mainWindow } = createDeps()
    const { onChannels, ipcMainLike } = createIpcMainLike()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sendMock = vi.fn(() => {
      throw new Error('send failed')
    })
    vi.mocked(deps.getMainView).mockReturnValue({
      webContents: {
        isDestroyed: () => false,
        send: sendMock,
      }
    } as any)
    mainWindow.isMinimized.mockReturnValue(true)
    vi.mocked(deps.resolveRendererNoteIdForNavigation).mockReturnValue('local:nb-1:docs%2Fplan.md')

    registerChatIpc(ipcMainLike as any, deps)

    const navigateToNote = onChannels.get('chat:navigate-to-note')
    expect(navigateToNote).toBeDefined()
    if (!navigateToNote) return

    expect(() => navigateToNote({}, { noteId: 'note-1' })).not.toThrow()
    expect(sendMock).toHaveBeenCalledWith('note:navigate', {
      noteId: 'local:nb-1:docs%2Fplan.md',
      target: undefined,
    })
    expect(errorSpy).toHaveBeenCalledWith('[chat-ipc] failed to send "note:navigate" event:', expect.any(Error))

    errorSpy.mockRestore()
  })

  it('fails closed when note id cannot be resolved', () => {
    const { deps, sendMock } = createDeps()
    const { onChannels, ipcMainLike } = createIpcMainLike()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(deps.resolveRendererNoteIdForNavigation).mockReturnValue(null)

    registerChatIpc(ipcMainLike as any, deps)

    const navigateToNote = onChannels.get('chat:navigate-to-note')
    expect(navigateToNote).toBeDefined()
    if (!navigateToNote) return

    navigateToNote({}, { noteId: 'note-1', target: { type: 'heading', value: 'Intro' } })

    expect(deps.resolveRendererNoteIdForNavigation).toHaveBeenCalledWith(
      'note-1',
      deps.navigationResolverDeps
    )
    expect(sendMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})

describe('register-chat-ipc payload validation hardening', () => {
  it('chatWindow:showWithContext fails closed for invalid context payload', async () => {
    const { deps, chatPanel } = createDeps()
    const { handleChannels, ipcMainLike } = createIpcMainLike()
    const tooLongContext = 'x'.repeat(200_001)

    registerChatIpc(ipcMainLike as any, deps)

    const showWithContext = handleChannels.get('chatWindow:showWithContext')
    expect(showWithContext).toBeDefined()
    if (!showWithContext) return

    await expect(showWithContext({}, { context: 'bad' })).resolves.toEqual({
      success: false,
      error: 'Invalid context payload',
    })
    await expect(showWithContext({}, tooLongContext)).resolves.toEqual({
      success: false,
      error: 'Invalid context payload',
    })
    await expect(showWithContext({}, 'hello\0world')).resolves.toEqual({
      success: false,
      error: 'Invalid context payload',
    })

    expect(deps.pushPinnedSelectionResource).not.toHaveBeenCalled()
    expect(chatPanel.show).not.toHaveBeenCalled()
  })

  it('theme:sync fails closed for invalid payload shape', async () => {
    const { deps } = createDeps()
    const { handleChannels, ipcMainLike } = createIpcMainLike()

    registerChatIpc(ipcMainLike as any, deps)

    const themeSync = handleChannels.get('theme:sync')
    expect(themeSync).toBeDefined()
    if (!themeSync) return

    await expect(themeSync({}, null)).resolves.toEqual({
      success: false,
      error: 'Invalid theme settings payload',
    })
    await expect(themeSync({}, { colorMode: 'light', accentColor: '', locale: 'en' })).resolves.toEqual({
      success: false,
      error: 'Invalid theme settings payload',
    })
    await expect(themeSync({}, { colorMode: 'light', accentColor: '#fff', locale: 'jp' })).resolves.toEqual({
      success: false,
      error: 'Invalid theme settings payload',
    })
    await expect(themeSync({}, { colorMode: 'light', accentColor: 'x'.repeat(65), locale: 'en' })).resolves.toEqual({
      success: false,
      error: 'Invalid theme settings payload',
    })
    await expect(themeSync({}, { colorMode: 'light', accentColor: '#fff\0', locale: 'en' })).resolves.toEqual({
      success: false,
      error: 'Invalid theme settings payload',
    })

    expect(deps.setThemeSettings).not.toHaveBeenCalled()
  })

  it('theme:sync keeps success when chat window send fails', async () => {
    const { deps, chatWebContents } = createDeps()
    const { handleChannels, ipcMainLike } = createIpcMainLike()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chatWebContents.send.mockImplementation(() => {
      throw new Error('send failed')
    })

    registerChatIpc(ipcMainLike as any, deps)

    const themeSync = handleChannels.get('theme:sync')
    expect(themeSync).toBeDefined()
    if (!themeSync) return

    await expect(themeSync({}, { colorMode: 'light', accentColor: '#fff', locale: 'en' })).resolves.toEqual({
      success: true,
    })
    expect(deps.setThemeSettings).toHaveBeenCalledWith({
      colorMode: 'light',
      accentColor: '#fff',
      locale: 'en',
      fontSize: undefined,
    })
    expect(errorSpy).toHaveBeenCalledWith('[chat-ipc] failed to send "theme:updated" event:', expect.any(Error))

    errorSpy.mockRestore()
  })

  it('theme:sync returns typed failure when setting theme throws', async () => {
    const { deps } = createDeps()
    const { handleChannels, ipcMainLike } = createIpcMainLike()
    vi.mocked(deps.setThemeSettings).mockImplementation(() => {
      throw new Error('persist failed')
    })

    registerChatIpc(ipcMainLike as any, deps)

    const themeSync = handleChannels.get('theme:sync')
    expect(themeSync).toBeDefined()
    if (!themeSync) return

    await expect(themeSync({}, { colorMode: 'light', accentColor: '#fff', locale: 'en' })).resolves.toEqual({
      success: false,
      error: 'persist failed',
    })
    expect(deps.setAppLocale).not.toHaveBeenCalled()
    expect(deps.updateSdkContexts).not.toHaveBeenCalled()
  })

  it('chat:stream fails closed for invalid payload before client lookup', async () => {
    const { deps } = createDeps()
    const { handleChannels, ipcMainLike } = createIpcMainLike()
    const sender = { sender: { isDestroyed: () => false, send: vi.fn() } }
    const tooLongStreamId = 's'.repeat(513)
    const tooLongConversationId = 'c'.repeat(513)
    const tooManyMessages = Array.from({ length: 201 }, () => ({ role: 'user', content: 'x' }))

    registerChatIpc(ipcMainLike as any, deps)

    const chatStream = handleChannels.get('chat:stream')
    expect(chatStream).toBeDefined()
    if (!chatStream) return

    await expect(chatStream(sender, null)).resolves.toEqual({
      success: false,
      error: 'Invalid chat:stream payload',
    })
    await expect(
      chatStream(sender, { streamId: 's1', messages: [{ role: 'system', content: 'x' }] })
    ).resolves.toEqual({
      success: false,
      error: 'Invalid chat:stream payload',
    })
    await expect(
      chatStream(sender, { streamId: tooLongStreamId, messages: [{ role: 'user', content: 'x' }] })
    ).resolves.toEqual({
      success: false,
      error: 'Invalid chat:stream payload',
    })
    await expect(
      chatStream(sender, { streamId: 's1', messages: tooManyMessages })
    ).resolves.toEqual({
      success: false,
      error: 'Invalid chat:stream payload',
    })
    await expect(
      chatStream(sender, { streamId: 's1', messages: [{ role: 'user', content: 'x\0y' }] })
    ).resolves.toEqual({
      success: false,
      error: 'Invalid chat:stream payload',
    })
    await expect(
      chatStream(
        sender,
        {
          streamId: 's1',
          messages: [{ role: 'user', content: 'x' }],
          conversationId: tooLongConversationId,
        }
      )
    ).resolves.toEqual({
      success: false,
      error: 'Invalid chat:stream payload',
    })

    expect(deps.getClient).not.toHaveBeenCalled()
    expect(deps.ensureAgentReady).not.toHaveBeenCalled()
  })

  it('chat:stream accepts valid payload and starts stream', async () => {
    const { deps } = createDeps()
    const { handleChannels, ipcMainLike } = createIpcMainLike()
    const chatStreamMock = vi.fn(async function *streamGenerator() {
      yield { type: 'delta', delta: 'hello' }
    })
    vi.mocked(deps.getClient).mockReturnValue({ chatStream: chatStreamMock })
    vi.mocked(deps.ensureAgentReady).mockResolvedValue({ agentId: 'assistant-ready' })

    registerChatIpc(ipcMainLike as any, deps)

    const chatStream = handleChannels.get('chat:stream')
    expect(chatStream).toBeDefined()
    if (!chatStream) return

    const senderSend = vi.fn()
    await expect(
      chatStream(
        { sender: { isDestroyed: () => false, send: senderSend } },
        {
          streamId: 'stream-1',
          messages: [{ role: 'user', content: 'hello' }],
        }
      )
    ).resolves.toEqual({ success: true })

    expect(deps.ensureAgentReady).toHaveBeenCalledWith('assistant')
    expect(chatStreamMock).toHaveBeenCalledWith(
      'assistant-ready',
      [{ role: 'user', content: 'hello' }],
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('chat:stream swallows stream-event send failures and tears down iterator', async () => {
    const { deps } = createDeps()
    const { handleChannels, ipcMainLike } = createIpcMainLike()
    const senderSend = vi.fn(() => {
      throw new Error('send failed')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const returnMock = vi.fn(async () => ({ done: true, value: undefined }))
    const stream = {
      next: vi.fn()
        .mockResolvedValueOnce({ done: false, value: { type: 'delta', delta: 'hello' } })
        .mockResolvedValueOnce({ done: true, value: undefined }),
      return: returnMock,
      throw: vi.fn(async () => ({ done: true, value: undefined })),
      [Symbol.asyncIterator]() {
        return this
      },
    } as unknown as AsyncGenerator<unknown, unknown, unknown>

    vi.mocked(deps.getClient).mockReturnValue({
      chatStream: vi.fn(() => stream),
    })
    vi.mocked(deps.ensureAgentReady).mockResolvedValue({ agentId: 'assistant-ready' })

    registerChatIpc(ipcMainLike as any, deps)

    const chatStream = handleChannels.get('chat:stream')
    expect(chatStream).toBeDefined()
    if (!chatStream) return

    await expect(
      chatStream(
        { sender: { isDestroyed: () => false, send: senderSend } },
        {
          streamId: 'stream-send-error',
          messages: [{ role: 'user', content: 'hello' }],
        }
      )
    ).resolves.toEqual({ success: true })

    await vi.waitFor(() => {
      expect(returnMock).toHaveBeenCalledTimes(1)
    })
    expect(errorSpy).toHaveBeenCalledWith('[chat:stream] failed to send stream event:', expect.any(Error))

    errorSpy.mockRestore()
  })

  it('chat:cancelStream fails closed for invalid payload', async () => {
    const { deps } = createDeps()
    const { handleChannels, ipcMainLike } = createIpcMainLike()
    const tooLongStreamId = 's'.repeat(513)

    registerChatIpc(ipcMainLike as any, deps)

    const cancelStream = handleChannels.get('chat:cancelStream')
    expect(cancelStream).toBeDefined()
    if (!cancelStream) return

    await expect(cancelStream({}, {})).resolves.toEqual({
      success: false,
      error: 'Invalid chat:cancelStream payload',
    })
    await expect(cancelStream({}, { streamId: tooLongStreamId })).resolves.toEqual({
      success: false,
      error: 'Invalid chat:cancelStream payload',
    })
  })

  it('chat:cancelStream succeeds when done-event send fails', async () => {
    const { deps } = createDeps()
    const { handleChannels, ipcMainLike } = createIpcMainLike()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const returnMock = vi.fn(async () => ({ done: true, value: undefined }))
    const pendingStream = {
      next: vi.fn(async () => new Promise<IteratorResult<unknown>>(() => {})),
      return: returnMock,
      throw: vi.fn(async () => ({ done: true, value: undefined })),
      [Symbol.asyncIterator]() {
        return this
      },
    } as unknown as AsyncGenerator<unknown, unknown, unknown>

    vi.mocked(deps.getClient).mockReturnValue({
      chatStream: vi.fn(() => pendingStream),
    })
    vi.mocked(deps.ensureAgentReady).mockResolvedValue({ agentId: 'assistant-ready' })

    registerChatIpc(ipcMainLike as any, deps)

    const chatStream = handleChannels.get('chat:stream')
    const cancelStream = handleChannels.get('chat:cancelStream')
    expect(chatStream).toBeDefined()
    expect(cancelStream).toBeDefined()
    if (!chatStream || !cancelStream) return

    await expect(
      chatStream(
        {
          sender: {
            isDestroyed: () => false,
            send: vi.fn(() => {
              throw new Error('send failed')
            }),
          }
        },
        {
          streamId: 'cancel-send-error',
          messages: [{ role: 'user', content: 'hello' }],
        }
      )
    ).resolves.toEqual({ success: true })

    await expect(cancelStream({}, { streamId: 'cancel-send-error' })).resolves.toEqual({ success: true })
    expect(returnMock).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith('[chat:stream] failed to send stream event:', expect.any(Error))

    errorSpy.mockRestore()
  })

  it('chat:stream replaces duplicated streamId safely and keeps latest stream cancellable', async () => {
    const { deps } = createDeps()
    const { handleChannels, ipcMainLike } = createIpcMainLike()
    const firstSenderSend = vi.fn()
    const secondSenderSend = vi.fn()

    const firstReturn = vi.fn(async () => ({ done: true, value: undefined }))
    const secondReturn = vi.fn(async () => ({ done: true, value: undefined }))

    const createPendingStream = (returnFn: typeof firstReturn): AsyncGenerator<unknown, unknown, unknown> => {
      const iterator = {
        next: vi.fn(async () => new Promise<IteratorResult<unknown>>(() => {})),
        return: returnFn,
        throw: vi.fn(async () => ({ done: true, value: undefined })),
        [Symbol.asyncIterator]() {
          return this
        },
      }
      return iterator as unknown as AsyncGenerator<unknown, unknown, unknown>
    }

    const chatStreamMock = vi.fn()
      .mockImplementationOnce(() => createPendingStream(firstReturn))
      .mockImplementationOnce(() => createPendingStream(secondReturn))
    vi.mocked(deps.getClient).mockReturnValue({ chatStream: chatStreamMock })
    vi.mocked(deps.ensureAgentReady).mockResolvedValue({ agentId: 'assistant-ready' })

    registerChatIpc(ipcMainLike as any, deps)

    const chatStream = handleChannels.get('chat:stream')
    const cancelStream = handleChannels.get('chat:cancelStream')
    expect(chatStream).toBeDefined()
    expect(cancelStream).toBeDefined()
    if (!chatStream || !cancelStream) return

    await expect(
      chatStream(
        { sender: { isDestroyed: () => false, send: firstSenderSend } },
        { streamId: 'dup-1', messages: [{ role: 'user', content: 'first' }] }
      )
    ).resolves.toEqual({ success: true })

    await expect(
      chatStream(
        { sender: { isDestroyed: () => false, send: secondSenderSend } },
        { streamId: 'dup-1', messages: [{ role: 'user', content: 'second' }] }
      )
    ).resolves.toEqual({ success: true })

    expect(firstReturn).toHaveBeenCalledTimes(1)
    expect(firstSenderSend).toHaveBeenCalledWith('chat:streamEvent', {
      streamId: 'dup-1',
      event: { type: 'done', conversationId: '' },
    })

    await expect(cancelStream({}, { streamId: 'dup-1' })).resolves.toEqual({ success: true })
    expect(secondReturn).toHaveBeenCalledTimes(1)
  })
})
