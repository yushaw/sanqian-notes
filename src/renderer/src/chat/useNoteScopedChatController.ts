import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createIpcAdapter,
  type ChatAdapter,
  type ChatUiConfig,
  type CompactChatController,
  type CompactChatHistoryConfig,
  type CompactChatProps,
  type CompactChatStateSnapshot,
  type ConversationChangeMeta,
  type ConversationInfo,
  type ConversationSwitchOptions,
} from '@yushaw/sanqian-chat/renderer'
import type { ThemeAPI, ThemeSettings } from '../../../shared/types'
import { createNoteConversationScope } from './noteConversationScope'
import {
  applyNoteConversationBinding,
  type ConversationChangeMetaLike,
  resolveDetachNoteIdForSwitch,
} from './noteConversationBinding'
import { planNoteConversationSwitch, supportsStreamPreservingSwitch } from './noteConversationSwitch'
import {
  applyNoteContextPayload,
  shouldApplyInitialNoteContextSnapshot,
  type NoteContextPayload,
} from './noteContextSync'

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

export interface UseNoteScopedChatControllerOptions {
  logo?: ChatUiConfig['logo']
}

export interface UseNoteScopedChatControllerResult {
  adapter: ChatAdapter | null
  activeAdapter: ChatAdapter
  compactChatProps: Omit<CompactChatProps, 'adapter' | 'className' | 'emptyState'>
}

const NOTE_SCOPE_WINDOW_MS = 24 * 60 * 60 * 1000

const getThemeApi = () => window.sanqianChat as unknown as ThemeAPI | undefined

const getChatWindowBridge = (): ChatWindowBridge | undefined => (
  window as unknown as { chatWindow?: ChatWindowBridge }
).chatWindow

const INITIAL_CHAT_STATE: CompactChatStateSnapshot = {
  messages: [],
  isLoading: false,
  isStreaming: false,
  error: null,
  conversationId: null,
  conversationTitle: null,
}

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

export function useNoteScopedChatController(
  options: UseNoteScopedChatControllerOptions = {}
): UseNoteScopedChatControllerResult {
  const { logo } = options
  const themeSettings = useThemeSettings()
  const locale = useMemo<'zh' | 'en'>(() => {
    const normalized = typeof themeSettings.locale === 'string'
      ? themeSettings.locale.toLowerCase()
      : 'en'
    return normalized.startsWith('zh') ? 'zh' : 'en'
  }, [themeSettings.locale])

  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean | undefined>(undefined)
  const [scopeRevision, setScopeRevision] = useState(0)
  const [chatReady, setChatReady] = useState(false)
  const [noteContext, setNoteContext] = useState<NoteContextPayload>({
    noteId: null,
    noteTitle: null,
  })

  const scopeRef = useRef(createNoteConversationScope())
  const noteContextRef = useRef(noteContext)
  const previousNoteIdRef = useRef<string | null | undefined>(undefined)
  const activeStreamOwnerNoteIdRef = useRef<string | null | undefined>(undefined)
  const pendingNoteSwitchRef = useRef<{ targetConversationId: string | null } | null>(null)
  const chatReadyRef = useRef(false)
  const chatStateRef = useRef<CompactChatStateSnapshot>(INITIAL_CHAT_STATE)
  const wasStreamingRef = useRef(false)
  const noteContextRevisionRef = useRef(0)

  const setTextRef = useRef<((text: string) => void) | null>(null)
  const focusInputRef = useRef<(() => void) | null>(null)
  const controllerRef = useRef<CompactChatController | null>(null)

  useEffect(() => {
    noteContextRef.current = noteContext
  }, [noteContext])

  const applyIncomingNoteContext = useCallback((payload: NoteContextPayload) => {
    setNoteContext((prev) => {
      const result = applyNoteContextPayload(prev, payload, noteContextRevisionRef.current)
      if (!result.changed) return prev
      noteContextRevisionRef.current = result.nextRevision
      return result.nextPayload
    })
  }, [])

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

  useEffect(() => {
    let disposed = false
    window.sanqianChat?.getAlwaysOnTop?.()
      .then((result) => {
        if (disposed || !result?.success || typeof result.data !== 'boolean') return
        setAlwaysOnTop(result.data)
      })
      .catch((err: Error) => {
        console.error('[ChatApp] Failed to get always-on-top state:', err)
      })
    return () => {
      disposed = true
    }
  }, [])

  const handlePinChange = useCallback((pinned: boolean) => {
    setAlwaysOnTop(pinned)
    void window.sanqianChat?.setAlwaysOnTop?.({ alwaysOnTop: pinned })
  }, [])

  const chatConfig = useMemo<ChatUiConfig>(() => ({
    theme: themeSettings.colorMode,
    accentColor: themeSettings.accentColor,
    locale,
    fontSize: themeSettings.fontSize,
    logo,
    alwaysOnTop: alwaysOnTop ?? true,
    onPin: handlePinChange,
  }), [
    themeSettings.colorMode,
    themeSettings.accentColor,
    themeSettings.fontSize,
    locale,
    logo,
    alwaysOnTop,
    handlePinChange,
  ])

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

  const relatedConversationIdSet = useMemo(() => {
    void scopeRevision
    if (!noteContext.noteId) return new Set<string>()
    return new Set(scopeRef.current.getRelatedConversationIds(noteContext.noteId))
  }, [noteContext.noteId, scopeRevision])

  const historyConfig = useMemo<CompactChatHistoryConfig>(() => ({
    isConversationHighlighted: (conversation: ConversationInfo) => (
      relatedConversationIdSet.has(conversation.id)
    ),
    // Keep related rows subtly highlighted without an extra badge.
    highlightedLabel: () => null,
  }), [relatedConversationIdSet])

  const switchConversationForNote = useCallback((
    targetConversationId: string | null,
    allowQueue: boolean,
    detachNoteId?: string | null
  ) => {
    const controller = controllerRef.current
    if (!controller) {
      pendingNoteSwitchRef.current = { targetConversationId }
      return
    }

    const state = controller.getState()
    const plan = planNoteConversationSwitch({
      targetConversationId,
      allowQueue,
      currentConversationId: state.conversationId,
      currentMessageCount: state.messages.length,
      isStreaming: state.isStreaming,
      supportsStreamPreservingSwitch: supportsStreamPreservingSwitch(state.capabilities),
      detachNoteId: detachNoteId ?? noteContextRef.current.noteId,
    })

    if (plan.kind === 'noop') {
      pendingNoteSwitchRef.current = null
      return
    }
    if (plan.kind === 'queue') {
      pendingNoteSwitchRef.current = { targetConversationId: plan.targetConversationId }
      return
    }

    pendingNoteSwitchRef.current = null
    if (plan.kind === 'load') {
      if (plan.stopStreamingFirst) {
        controller.stopStreaming()
      }
      void controller.loadConversation(plan.conversationId, plan.options as ConversationSwitchOptions | undefined)
      return
    }

    if (plan.stopStreamingFirst) {
      controller.stopStreaming()
    }
    controller.newConversation(plan.options as ConversationSwitchOptions | undefined)
  }, [])

  const handleConversationChange = useCallback((conversationId: string, _title?: string, meta?: ConversationChangeMeta) => {
    const result = applyNoteConversationBinding({
      scope: scopeRef.current,
      conversationId,
      currentNoteId: noteContextRef.current.noteId,
      activeStreamOwnerNoteId: activeStreamOwnerNoteIdRef.current,
      timestampMs: Date.now(),
      meta: meta as ConversationChangeMetaLike | undefined,
    })
    if (result === 'skipped') return
    setScopeRevision((value) => value + 1)
  }, [])

  const handleConversationDeleted = useCallback((conversationId: string) => {
    scopeRef.current.removeConversation(conversationId)
    setScopeRevision((value) => value + 1)
  }, [])

  const handleStateChange = useCallback((state: CompactChatStateSnapshot) => {
    chatStateRef.current = state

    if (!chatReadyRef.current) {
      chatReadyRef.current = true
      setChatReady(true)
    }

    const wasStreaming = wasStreamingRef.current
    if (state.isStreaming && !wasStreaming) {
      activeStreamOwnerNoteIdRef.current = noteContextRef.current.noteId
    } else if (!state.isStreaming && wasStreaming) {
      activeStreamOwnerNoteIdRef.current = undefined
    }

    if (!state.isStreaming) {
      const pending = pendingNoteSwitchRef.current
      if (pending) {
        switchConversationForNote(pending.targetConversationId, false)
      }
    }
    wasStreamingRef.current = state.isStreaming
  }, [switchConversationForNote])

  useEffect(() => {
    if (!chatReady) return
    const noteId = noteContext.noteId
    const previousNoteId = previousNoteIdRef.current
    const detachNoteId = resolveDetachNoteIdForSwitch(previousNoteId, noteId)
    const targetConversationId = noteId
      ? scopeRef.current.getLatestConversationForNote(noteId, { withinMs: NOTE_SCOPE_WINDOW_MS })
      : null
    switchConversationForNote(targetConversationId, true, detachNoteId)
    previousNoteIdRef.current = noteId
  }, [chatReady, noteContext.noteId, switchConversationForNote])

  useEffect(() => {
    const bridge = getChatWindowBridge()
    if (!bridge) return

    let disposed = false
    const initialRequestRevision = noteContextRevisionRef.current

    const cleanup = bridge.onNoteContextChanged((payload) => {
      if (disposed || !payload) return
      applyIncomingNoteContext(payload)
    })

    bridge.getNoteContext().then((payload) => {
      if (disposed || !payload) return
      if (!shouldApplyInitialNoteContextSnapshot(initialRequestRevision, noteContextRevisionRef.current)) {
        return
      }
      applyIncomingNoteContext(payload)
    }).catch((err: Error) => {
      console.error('[ChatApp] Failed to get initial note context:', err)
    })

    return () => {
      disposed = true
      cleanup()
    }
  }, [applyIncomingNoteContext])

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
        const setText = setTextRef.current
        if (setText) {
          setText(context)
          focusInputRef.current?.()
          return
        }
        if (retriesLeft > 0) {
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

  const handleChatError = useCallback((err: Error) => {
    console.error('[ChatApp] chat error:', err)
  }, [])

  const compactChatProps = useMemo<Omit<CompactChatProps, 'adapter' | 'className' | 'emptyState'>>(() => ({
    config: chatConfig,
    onError: handleChatError,
    onConversationChange: handleConversationChange,
    onStateChange: handleStateChange,
    setTextRef,
    focusInputRef,
    controllerRef,
    onConversationDeleted: handleConversationDeleted,
    historyConfig,
    linkHandler: {
      allowedProtocols: ['sanqian-notes:'],
      onLinkClick: ({ href }) => navigateToInternalNote(href),
    },
  }), [
    chatConfig,
    handleChatError,
    handleConversationChange,
    handleStateChange,
    handleConversationDeleted,
    historyConfig,
    navigateToInternalNote,
  ])

  return {
    adapter,
    activeAdapter,
    compactChatProps,
  }
}
