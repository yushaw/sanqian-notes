/**
 * ChatApp - Main chat application component
 *
 * Uses sanqian-chat hooks/components with note-scoped conversation switching.
 */

import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import {
  AddResourceButton,
  AttachButton,
  AttachedResourceTags,
  ChatInput,
  type ChatInputHandle,
  createIpcAdapter,
  type ChatAdapter,
  HistoryModal,
  HitlCard,
  ModeToggleButton,
  SanqianMessageList,
  resolveChatStrings,
  useChat,
  useChatStyles,
  useConnection,
  useConversations,
  useResourcePicker,
  useWindowDragLock,
  type ConversationInfo,
} from '@yushaw/sanqian-chat/renderer'
import '@yushaw/sanqian-chat/renderer/styles/variables.css'
import notesLogo from '../assets/notes-logo.png'
import type { ThemeSettings, ThemeAPI } from '../../../shared/types'
import { createNoteConversationScope } from './noteConversationScope'

interface NoteContextPayload {
  noteId: string | null
  noteTitle: string | null
}

interface NavigateToNotePayload {
  noteId: string
  target?: { type: 'heading' | 'block'; value: string }
}

interface ChatWindowBridge {
  onSetContext: (callback: (context: string) => void) => () => void
  navigateToNote: (payload: NavigateToNotePayload) => void
  getNoteContext: () => Promise<NoteContextPayload>
  onNoteContextChanged: (callback: (payload: NoteContextPayload) => void) => () => void
}

const NOTE_SCOPE_WINDOW_MS = 24 * 60 * 60 * 1000

const getThemeApi = () => window.sanqianChat as unknown as ThemeAPI | undefined

const getChatWindowBridge = (): ChatWindowBridge | undefined => (
  window as unknown as { chatWindow?: ChatWindowBridge }
).chatWindow

function createUnavailableAdapter(): ChatAdapter {
  return {
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => false,
    getConnectionStatus: () => 'disconnected',
    onConnectionChange: () => () => {},
    listConversations: async () => ({ conversations: [], total: 0 }),
    getConversation: async () => {
      throw new Error('Chat adapter unavailable')
    },
    deleteConversation: async () => {},
    chatStream: async (_messages, _conversationId, onEvent) => {
      onEvent({ type: 'error', error: 'Chat adapter unavailable' })
      return { cancel: () => {} }
    },
  }
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function formatConversationTime(timestamp: string | undefined, locale: string, strings: { today: string; yesterday: string }): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  const timeText = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (isSameDay(date, now)) return `${strings.today} ${timeText}`
  if (isSameDay(date, yesterday)) return `${strings.yesterday} ${timeText}`
  return date.toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function useThemeSettings() {
  const [settings, setSettings] = useState<ThemeSettings>({
    colorMode: 'light',
    accentColor: '#2563EB',
    locale: 'en',
    fontSize: 'normal',
  })

  useEffect(() => {
    const api = getThemeApi()
    api?.getThemeSettings?.().then((value: ThemeSettings) => {
      if (value) setSettings(value)
    }).catch((err: Error) => {
      console.error('[ChatApp] Failed to get theme settings:', err)
    })

    const cleanup = api?.onThemeUpdated?.((value: ThemeSettings) => {
      setSettings(value)
    })

    return () => cleanup?.()
  }, [])

  return settings
}

export default function ChatApp() {
  useChatStyles()

  const themeSettings = useThemeSettings()
  const isDarkMode = themeSettings.colorMode === 'dark'
  const locale = themeSettings.locale === 'zh' ? 'zh' : 'en'
  const strings = useMemo(
    () => resolveChatStrings(locale),
    [locale]
  )

  const [isPinned, setIsPinned] = useState(true)
  const [showHistory, setShowHistory] = useState(false)
  const [scopeRevision, setScopeRevision] = useState(0)
  const [noteContext, setNoteContext] = useState<NoteContextPayload>({
    noteId: null,
    noteTitle: null,
  })

  useWindowDragLock(showHistory)

  const noteContextRef = useRef(noteContext)
  useEffect(() => {
    noteContextRef.current = noteContext
  }, [noteContext])

  const scopeRef = useRef(createNoteConversationScope())

  const adapter = useMemo<ChatAdapter | null>(() => {
    try {
      return createIpcAdapter()
    } catch (err) {
      console.error('[ChatApp] Failed to create adapter:', err)
      return null
    }
  }, [])
  const fallbackAdapter = useMemo(() => createUnavailableAdapter(), [])
  const activeAdapter = adapter ?? fallbackAdapter

  const chatInputRef = useRef<ChatInputHandle | null>(null)

  const handleClose = useCallback(() => {
    window.sanqianChat?.hide()
  }, [])

  const togglePin = useCallback(async () => {
    const nextPinned = !isPinned
    try {
      await window.sanqianChat?.setAlwaysOnTop({ alwaysOnTop: nextPinned })
      setIsPinned(nextPinned)
    } catch (err) {
      console.error('[ChatApp] Failed to toggle always-on-top:', err)
    }
  }, [isPinned])

  const navigateToInternalNote = useCallback((href: string): boolean => {
    if (!href.startsWith('sanqian-notes://')) {
      return false
    }

    try {
      const url = new URL(href)
      const action = url.hostname
      const noteId = url.pathname.slice(1)
      if (action !== 'note' || !noteId) {
        return true
      }

      const heading = url.searchParams.get('heading') || undefined
      const block = url.searchParams.get('block') || undefined
      getChatWindowBridge()?.navigateToNote({
        noteId,
        target: heading
          ? { type: 'heading', value: heading }
          : block
          ? { type: 'block', value: block }
          : undefined,
      })
      return true
    } catch (err) {
      console.error('[ChatApp] Failed to parse note link:', href, err)
      return true
    }
  }, [])

  const handleMessageAreaClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    if (!target) return
    const anchor = target.closest('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    const href = anchor.getAttribute('href') || ''
    if (!navigateToInternalNote(href)) return
    event.preventDefault()
    event.stopPropagation()
  }, [navigateToInternalNote])

  useEffect(() => {
    const bridge = getChatWindowBridge()
    if (!bridge) return

    let disposed = false
    bridge.getNoteContext().then((payload) => {
      if (!disposed && payload) {
        setNoteContext(payload)
      }
    }).catch((err: Error) => {
      console.error('[ChatApp] Failed to get initial note context:', err)
    })

    const cleanup = bridge.onNoteContextChanged((payload) => {
      setNoteContext((prev) => (
        prev.noteId === payload.noteId && prev.noteTitle === payload.noteTitle
          ? prev
          : payload
      ))
    })

    return () => {
      disposed = true
      cleanup()
    }
  }, [])

  useEffect(() => {
    const bridge = getChatWindowBridge()
    if (!bridge) return

    let retryTimeout: ReturnType<typeof setTimeout> | null = null
    const cleanup = bridge.onSetContext((context) => {
      if (!context) return

      if (retryTimeout) {
        clearTimeout(retryTimeout)
        retryTimeout = null
      }

      const trySetContext = (retriesLeft: number): void => {
        if (chatInputRef.current) {
          chatInputRef.current.setValue(context)
          chatInputRef.current.focus()
        } else if (retriesLeft > 0) {
          retryTimeout = setTimeout(() => trySetContext(retriesLeft - 1), 50 * (4 - retriesLeft))
        }
      }

      trySetContext(3)
    })

    return () => {
      cleanup()
      if (retryTimeout) clearTimeout(retryTimeout)
    }
  }, [])

  const handleConversationChange = useCallback((conversationId: string) => {
    const scope = scopeRef.current
    const ts = Date.now()
    const existing = scope.getBinding(conversationId)
    if (existing) {
      scope.touchConversation(conversationId, ts)
      setScopeRevision((value) => value + 1)
      return
    }

    const noteId = noteContextRef.current.noteId
    if (!noteId) return

    scope.bindConversationToNote(conversationId, noteId, ts)
    setScopeRevision((value) => value + 1)
  }, [])

  const connection = useConnection({
    adapter: activeAdapter,
    autoConnect: true,
  })

  const chat = useChat({
    adapter: activeAdapter,
    onConversationChange: handleConversationChange,
    onError: (err) => {
      console.error('[ChatApp] chat error:', err)
    }
  })

  const chatRef = useRef(chat)
  useEffect(() => {
    chatRef.current = chat
  }, [chat])

  const pendingNoteSwitchRef = useRef<{ targetConversationId: string | null } | null>(null)

  const switchConversationForNote = useCallback((targetConversationId: string | null, allowQueue: boolean) => {
    const activeChat = chatRef.current
    const shouldOpenTargetConversation = !!targetConversationId && activeChat.conversationId !== targetConversationId
    const shouldOpenEmptyConversation = !targetConversationId && (activeChat.conversationId || activeChat.messages.length > 0)
    if (!shouldOpenTargetConversation && !shouldOpenEmptyConversation) {
      pendingNoteSwitchRef.current = null
      return
    }

    const supportsSwitchOptions = activeChat.loadConversation.length >= 2
    if (activeChat.isStreaming && !supportsSwitchOptions && allowQueue) {
      pendingNoteSwitchRef.current = { targetConversationId }
      return
    }

    pendingNoteSwitchRef.current = null
    if (shouldOpenTargetConversation && targetConversationId) {
      if (activeChat.isStreaming && supportsSwitchOptions) {
        const loadWithOptions = activeChat.loadConversation as unknown as (
          id: string,
          options?: { cancelActiveStream?: boolean }
        ) => Promise<void>
        void loadWithOptions(targetConversationId, { cancelActiveStream: false })
        return
      }
      if (activeChat.isStreaming) {
        activeChat.stopStreaming()
      }
      void activeChat.loadConversation(targetConversationId)
      return
    }

    if (activeChat.isStreaming && supportsSwitchOptions) {
      const newWithOptions = activeChat.newConversation as unknown as (
        options?: { cancelActiveStream?: boolean }
      ) => void
      newWithOptions({ cancelActiveStream: false })
      return
    }
    if (activeChat.isStreaming) {
      activeChat.stopStreaming()
    }
    activeChat.newConversation()
  }, [])

  useEffect(() => {
    if (!activeAdapter.onFocusInput) return
    return activeAdapter.onFocusInput(() => {
      chatInputRef.current?.focus()
    })
  }, [activeAdapter])

  useEffect(() => {
    const noteId = noteContext.noteId
    const scope = scopeRef.current
    const targetConversationId = noteId
      ? scope.getLatestConversationForNote(noteId, { withinMs: NOTE_SCOPE_WINDOW_MS })
      : null
    switchConversationForNote(targetConversationId, true)
  }, [noteContext.noteId, switchConversationForNote])

  useEffect(() => {
    if (chat.isStreaming) return
    const pending = pendingNoteSwitchRef.current
    if (!pending) return
    switchConversationForNote(pending.targetConversationId, false)
  }, [chat.isStreaming, switchConversationForNote])

  const conversations = useConversations({
    adapter: activeAdapter,
    onError: (err) => {
      console.error('[ChatApp] failed to load conversations:', err)
    }
  })
  const { loadConversations } = conversations

  useEffect(() => {
    if (!showHistory || !connection.isConnected) return
    void loadConversations()
  }, [showHistory, connection.isConnected, loadConversations])

  const resourcePicker = useResourcePicker({ adapter: activeAdapter })
  const { refreshProviders } = resourcePicker
  useEffect(() => {
    if (!connection.isConnected) return
    void refreshProviders()
  }, [connection.isConnected, refreshProviders])

  const resourceProviders = useMemo(
    () => resourcePicker.providers.filter((provider) => provider.hasGetList),
    [resourcePicker.providers]
  )

  const handleHitlCancel = useCallback(() => {
    if (chat.pendingInterrupt?.type === 'approval_request') {
      chat.rejectHitl()
    } else {
      chat.submitHitlInput({ cancelled: true })
    }
  }, [chat])

  const handleSendWithResources = useCallback(async (content: string) => {
    const attachedResources = [...resourcePicker.attachedResources]
    const sent = await chat.trySendMessage(
      content,
      attachedResources.length > 0 ? { attachedResources } : undefined
    )
    if (sent) {
      resourcePicker.clearAttachedResources()
    }
    return sent
  }, [chat, resourcePicker])

  const relatedConversationIdSet = useMemo(() => {
    void scopeRevision
    if (!noteContext.noteId) return new Set<string>()
    return new Set(scopeRef.current.getRelatedConversationIds(noteContext.noteId))
  }, [noteContext.noteId, scopeRevision])

  const handleSelectConversation = useCallback(async (conversationId: string) => {
    setShowHistory(false)
    await chat.loadConversation(conversationId)
  }, [chat])

  const handleDeleteConversation = useCallback(async (conversationId: string) => {
    await conversations.deleteConversation(conversationId)
    scopeRef.current.removeConversation(conversationId)
    setScopeRevision((value) => value + 1)
    if (chat.conversationId === conversationId) {
      chat.newConversation()
    }
  }, [chat, conversations])

  const handleNewConversation = useCallback(() => {
    chat.newConversation()
    setShowHistory(false)
    setTimeout(() => chatInputRef.current?.focus(), 0)
  }, [chat])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.includes('Mac')
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey
      if (!modifierPressed || event.key.toLowerCase() !== 'n') return
      event.preventDefault()
      handleNewConversation()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNewConversation])

  const rootStyle = useMemo<CSSProperties>(() => ({
    '--chat-accent': themeSettings.accentColor,
  } as CSSProperties), [themeSettings.accentColor])

  const headerButtonClass = 'h-7 w-7 rounded-md border border-transparent text-[var(--chat-muted)] hover:bg-[var(--chat-hover)] hover:text-[var(--chat-text)] flex items-center justify-center transition-colors'
  const hasContextTags = chat.sessionResources.length > 0 || resourcePicker.attachedResources.length > 0
  const allowEmptySubmit = hasContextTags

  const historyRows = conversations.conversations
  const selectedConversationId = chat.conversationId

  if (!adapter) {
    return (
      <div className={`h-full ${isDarkMode ? 'dark' : ''}`}>
        <div className="chat-window-container h-full flex items-center justify-center">
          <p className="text-[var(--chat-error)]">Failed to initialize chat</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`h-full ${isDarkMode ? 'dark' : ''}`}
      style={rootStyle}
      data-chat-font-size={themeSettings.fontSize ?? 'normal'}
    >
      <div className="chat-window-container h-full flex flex-col">
        <header className="flex h-[42px] shrink-0 items-center border-b chat-divider-border px-2">
          <div className="flex items-center gap-2">
            <img src={notesLogo} alt="Notes" className="chat-header-logo" draggable={false} />
            <span className="text-sm font-medium text-[var(--chat-text)]">{strings.chat}</span>
            {noteContext.noteTitle && (
              <span className="max-w-[220px] truncate text-xs text-[var(--chat-muted)]">
                · {noteContext.noteTitle}
              </span>
            )}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <ModeToggleButton locale={locale} />
            <AttachButton locale={locale} />
            <button
              type="button"
              className={headerButtonClass}
              onClick={() => setShowHistory(true)}
              title={strings.recentChats}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className={headerButtonClass}
              onClick={handleNewConversation}
              title={strings.newChat}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 5v14m-7-7h14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className={headerButtonClass}
              onClick={togglePin}
              title={isPinned ? strings.unpin : strings.pin}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {isPinned ? (
                  <>
                    <path d="M12 17v5" />
                    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                  </>
                ) : (
                  <>
                    <path d="M12 17v5" />
                    <path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" />
                    <path d="m2 2 20 20" />
                    <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />
                  </>
                )}
              </svg>
            </button>
            <button
              type="button"
              className={headerButtonClass}
              onClick={handleClose}
              title={strings.close}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M6 6l12 12M18 6l-12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </header>

        <HistoryModal
          isOpen={showHistory}
          onClose={() => setShowHistory(false)}
          title={strings.recentChats}
          closeLabel={strings.close}
          isDarkMode={isDarkMode}
        >
          <div style={{ maxHeight: '56vh', overflowY: 'auto', paddingRight: 2 }}>
            {conversations.isLoading && historyRows.length === 0 && (
              <div style={{ color: 'var(--chat-muted)', fontSize: 13, padding: '1rem 0.25rem', textAlign: 'center' }}>
                {strings.messageLoading}
              </div>
            )}
            {!conversations.isLoading && historyRows.length === 0 && (
              <div style={{ color: 'var(--chat-muted)', fontSize: 13, padding: '1rem 0.25rem', textAlign: 'center' }}>
                {strings.noHistory}
              </div>
            )}
            {historyRows.map((conversation: ConversationInfo) => {
              const isSelected = selectedConversationId === conversation.id
              const isRelated = relatedConversationIdSet.has(conversation.id)
              const conversationTime = formatConversationTime(conversation.updatedAt, locale, {
                today: strings.today,
                yesterday: strings.yesterday,
              })

              return (
                <div
                  key={conversation.id}
                  style={{
                    position: 'relative',
                    borderRadius: 10,
                    marginBottom: 8,
                    border: isRelated ? '1px solid var(--chat-accent)' : '1px solid transparent',
                    background: isSelected
                      ? 'var(--chat-hover)'
                      : isRelated
                      ? 'color-mix(in srgb, var(--chat-accent) 10%, var(--chat-surface) 90%)'
                      : 'var(--chat-surface)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void handleSelectConversation(conversation.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      padding: '0.6rem 2.1rem 0.6rem 0.75rem',
                      cursor: 'pointer',
                      color: 'var(--chat-text)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {conversation.title || strings.conversationUntitled}
                      </span>
                      {isRelated && (
                        <span
                          style={{
                            fontSize: 10,
                            lineHeight: 1,
                            padding: '3px 6px',
                            borderRadius: 999,
                            background: 'var(--chat-accent)',
                            color: '#fff',
                            flexShrink: 0,
                          }}
                        >
                          NOTE
                        </span>
                      )}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--chat-muted)' }}>
                      {conversationTime}
                      {conversation.messageCount > 0 ? ` · ${conversation.messageCount}` : ''}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteConversation(conversation.id)}
                    title={strings.delete}
                    style={{
                      position: 'absolute',
                      top: 7,
                      right: 6,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--chat-muted)',
                      cursor: 'pointer',
                      borderRadius: 6,
                      width: 24,
                      height: 24,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              )
            })}
            {conversations.hasMore && (
              <button
                type="button"
                onClick={() => void conversations.loadMore()}
                style={{
                  width: '100%',
                  marginTop: 4,
                  padding: '0.45rem 0.5rem',
                  borderRadius: 8,
                  border: '1px solid var(--chat-border)',
                  background: 'var(--chat-surface)',
                  color: 'var(--chat-text)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {strings.loadMore}
              </button>
            )}
          </div>
        </HistoryModal>

        <div className="flex-1 min-h-0" onClickCapture={handleMessageAreaClickCapture}>
          <SanqianMessageList
            messages={chat.messages}
            isLoading={chat.isLoading}
            className="h-full"
            emptyState={
              <div className="flex h-full items-center justify-center">
                <img src={notesLogo} alt="Notes" className="chat-header-logo" draggable={false} />
              </div>
            }
          />
        </div>

        {chat.pendingInterrupt && (
          <div className="px-3 pb-2">
            <HitlCard
              interrupt={chat.pendingInterrupt}
              onApprove={chat.approveHitl}
              onReject={chat.rejectHitl}
              onSubmit={chat.submitHitlInput}
              onCancel={handleHitlCancel}
              isDarkMode={isDarkMode}
              strings={{
                approve: strings.hitlApprove,
                reject: strings.hitlReject,
                submit: strings.hitlSubmit,
                cancel: strings.hitlCancel,
                rememberChoice: strings.hitlRememberChoice,
                requiredField: strings.hitlRequiredField,
                timeoutIn: strings.hitlTimeoutIn,
                seconds: strings.hitlSeconds,
                executeTool: strings.hitlExecuteTool,
                toolLabel: strings.hitlToolLabel,
                argsLabel: strings.hitlArgsLabel,
                defaultPrefix: strings.hitlDefaultPrefix,
                enterResponse: strings.hitlEnterResponse,
                approvalRequest: strings.hitlApprovalRequest,
                inputRequest: strings.hitlInputRequest,
              }}
            />
          </div>
        )}

        {hasContextTags && (
          <div className="px-3 pb-2">
            {chat.sessionResources.length > 0 && (
              <AttachedResourceTags
                resources={chat.sessionResources.map((resource) => ({
                  providerId: resource.appName,
                  resourceId: resource.fullId,
                  title: resource.title,
                  summary: resource.summary,
                  icon: resource.icon,
                  type: resource.type,
                }))}
                onRemove={(_, resourceId) => chat.removeSessionResource(resourceId)}
              />
            )}
            {resourcePicker.attachedResources.length > 0 && (
              <AttachedResourceTags
                resources={resourcePicker.attachedResources}
                onRemove={resourcePicker.detachResource}
              />
            )}
          </div>
        )}

        <div className="shrink-0 border-t chat-divider-border px-3 pb-3 pt-2">
          <ChatInput
            ref={chatInputRef}
            onSend={handleSendWithResources}
            onStop={chat.stopStreaming}
            placeholder={strings.inputPlaceholder}
            sendLabel={strings.inputSend}
            stopLabel={strings.inputStop}
            disabled={!!chat.pendingInterrupt || (chat.isLoading && !chat.isStreaming)}
            isStreaming={chat.isStreaming}
            isLoading={chat.isLoading}
            allowEmptySubmit={allowEmptySubmit}
            autoFocus={true}
            leftSlot={
              resourceProviders.length > 0 ? (
                <AddResourceButton
                  providers={resourceProviders}
                  isLoadingProviders={resourcePicker.isLoadingProviders}
                  resources={resourcePicker.resources}
                  isLoadingResources={resourcePicker.isLoadingResources}
                  hasMore={resourcePicker.hasMore}
                  onLoadMore={resourcePicker.loadMore}
                  searchQuery={resourcePicker.searchQuery}
                  onSearchChange={resourcePicker.setSearchQuery}
                  selectedProviderId={resourcePicker.selectedProviderId}
                  onSelectProvider={resourcePicker.selectProvider}
                  onAttachResource={resourcePicker.attachResource}
                  isResourceAttached={resourcePicker.isResourceAttached}
                  pickerError={resourcePicker.error}
                  disabled={!!chat.pendingInterrupt || chat.isLoading}
                  locale={locale}
                />
              ) : null
            }
          />
        </div>
      </div>
    </div>
  )
}
