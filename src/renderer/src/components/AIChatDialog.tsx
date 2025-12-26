/**
 * AIChatDialog - Clean and minimal AI chat dialog
 *
 * Structure:
 * - Chat Panel (with header and messages/history)
 * - Input Bar (rendered via Portal from CompactChat)
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { CompactChat } from '../lib/chat-ui/components/CompactChat'
import { createElectronAdapter } from '../lib/chat-ui/adapters/electron'
import { useTheme } from '../theme'
import { useTranslations } from '../i18n'
import { TIMING, EASING, RETRY } from '../constants'
import { mapLegacyErrorCode, getAIErrorMessage } from '../utils/aiErrors'
import notesLogo from '../assets/notes-logo.png'

interface AIChatDialogProps {
  isOpen: boolean
  onClose: () => void
  onOpen?: () => void
}

// Event for opening chat with context
export const OPEN_CHAT_WITH_CONTEXT_EVENT = 'open-chat-with-context'

export interface OpenChatWithContextDetail {
  selectedText: string
  explanation: string
}

export function openChatWithContext(detail: OpenChatWithContextDetail) {
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_WITH_CONTEXT_EVENT, { detail }))
}


export function AIChatDialog({ isOpen, onClose, onOpen }: AIChatDialogProps) {
  const { resolvedColorMode } = useTheme()
  const t = useTranslations()
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasEverOpened, setHasEverOpened] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const panelRef = useRef<HTMLDivElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const [inputContainer, setInputContainer] = useState<HTMLElement | null>(null)
  const chatNewConversationRef = useRef<(() => void) | null>(null)
  const chatFocusInputRef = useRef<(() => void) | null>(null)
  const chatSetTextRef = useRef<((text: string) => void) | null>(null)
  const isOpenRef = useRef(isOpen)

  // Create adapter instance (using ref to ensure stability across HMR)
  const adapterRef = useRef<ReturnType<typeof createElectronAdapter> | null>(null)
  if (!adapterRef.current) {
    adapterRef.current = createElectronAdapter()
  }
  const adapter = adapterRef.current

  // Keep isOpenRef in sync
  useEffect(() => {
    if (isOpen) {
      isOpenRef.current = true
    }
  }, [isOpen])

  // Cleanup adapter on unmount
  useEffect(() => {
    const currentAdapter = adapterRef.current
    return () => {
      currentAdapter?.cleanup?.()
    }
  }, [])

  // Listen for "open chat with context" events
  useEffect(() => {
    const handleOpenWithContext = (e: Event) => {
      const detail = (e as CustomEvent<OpenChatWithContextDetail>).detail
      if (detail) {
        // Start a new conversation
        chatNewConversationRef.current?.()
        // Open the dialog
        onOpen?.()
        // Set the context text after a short delay to ensure dialog is open
        setTimeout(() => {
          const contextMessage = t.ai.continueContextTemplate
            .replace('{selectedText}', detail.selectedText)
            .replace('{explanation}', detail.explanation)
          chatSetTextRef.current?.(contextMessage)
          chatFocusInputRef.current?.()
        }, 100)
      }
    }

    window.addEventListener(OPEN_CHAT_WITH_CONTEXT_EVENT, handleOpenWithContext)
    return () => {
      window.removeEventListener(OPEN_CHAT_WITH_CONTEXT_EVENT, handleOpenWithContext)
    }
  }, [onOpen])

  // Close dialog without clearing session
  // ESC uses this: user may just want to temporarily hide the dialog
  const closeDialog = useCallback(() => {
    isOpenRef.current = false
    setIsHovered(false)
    onClose()
  }, [onClose])

  // Close and clear session completely
  // Click outside uses this: user has finished the conversation
  const clearAndClose = useCallback(() => {
    isOpenRef.current = false
    setMessages([])
    setIsLoading(false)
    setIsHovered(false)
    setConnectionStatus('connecting')
    onClose()
  }, [onClose])

  // Check if we have an active session
  const hasUserMessage = messages.some(m => m.role === 'user')
  const hasActiveSession = hasUserMessage

  // Connection retry with exponential backoff
  const connectWithRetry = useCallback(async (maxRetries = RETRY.MAX_ATTEMPTS) => {
    setConnectionStatus('connecting')
    for (let i = 0; i < maxRetries; i++) {
      try {
        await adapter.connect()
        setConnectionStatus('connected')
        return true
      } catch (err) {
        console.error(`[AIChatDialog] Connect failed (${i + 1}/${maxRetries}):`, err)
        if (i < maxRetries - 1) {
          const delayMs = Math.pow(2, i) * TIMING.RETRY_BASE_DELAY_MS
          await new Promise(resolve => setTimeout(resolve, delayMs))
        }
      }
    }
    setConnectionStatus('error')
    return false
  }, [adapter])

  // Manage connection based on dialog state  
  useEffect(() => {
    if (isOpen) {
      window.electron.chat.acquireReconnect().catch((err: unknown) => {
        console.error('[AIChatDialog] Failed to acquire reconnect:', err)
      })
      connectWithRetry().catch((err: unknown) => {
        console.error('[AIChatDialog] Failed to connect:', err)
      })
    } else {
      window.electron.chat.releaseReconnect().catch((err: unknown) => {
        console.error('[AIChatDialog] Failed to release reconnect:', err)
      })
    }
  }, [isOpen, connectWithRetry])

  // ESC key to close
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDialog()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeDialog])

  // Track if dialog has ever been opened
  useEffect(() => {
    if (isOpen && !hasEverOpened) {
      setHasEverOpened(true)
    }
  }, [isOpen, hasEverOpened])

  // Sync inputContainerRef to state for Portal (ref.current is null on first render)
  // Use requestAnimationFrame to ensure DOM has rendered
  useEffect(() => {
    if (hasEverOpened) {
      requestAnimationFrame(() => {
        if (inputContainerRef.current) {
          setInputContainer(inputContainerRef.current)
        }
      })
    }
  }, [hasEverOpened])

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        chatFocusInputRef.current?.()
      }, TIMING.FOCUS_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const isOutsidePanel = panelRef.current && !panelRef.current.contains(e.target as Node)
      const isOutsideInput = inputContainerRef.current && !inputContainerRef.current.contains(e.target as Node)

      if (isOutsidePanel && isOutsideInput) {
        clearAndClose()
      }
    }
    if (isOpen) {
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside)
      }, TIMING.CLICK_OUTSIDE_DELAY_MS)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [isOpen, clearAndClose])

  // Handle suggestion click - fill suggestion into input and focus
  const handleSuggestionClick = useCallback((suggestion: string) => {
    chatSetTextRef.current?.(suggestion)
    chatFocusInputRef.current?.()
  }, [])

  // Handle chat state change
  const handleStateChange = useCallback((state: { messages: Array<{ role: string; content: string }>; conversationId: string | null }) => {
    if (!isOpenRef.current) return
    setMessages(state.messages)
  }, [])

  // Handle loading state change
  const handleLoadingChange = useCallback((loading: boolean) => {
    if (!isOpenRef.current) return
    setIsLoading(loading)
  }, [])

  // Handle close button
  const handleClose = useCallback(() => {
    if (chatNewConversationRef.current) {
      chatNewConversationRef.current()
    }
    clearAndClose()
  }, [clearAndClose])

  // Handle session pill click
  const handleSessionPillClick = useCallback(() => {
    onOpen?.()
  }, [onOpen])

  // Animation variants for panel show/hide
  // Note: No AnimatePresence used - panel stays mounted to preserve CompactChat state
  // Using visibility:hidden + animate between states instead of mount/unmount
  const panelVariants = {
    hidden: {
      opacity: 0, y: 12, scale: 0.98, x: '-50%',
      transition: { duration: TIMING.PANEL_EXIT_S, ease: EASING.EXIT }
    },
    visible: {
      opacity: 1, y: 0, scale: 1, x: '-50%',
      transition: { duration: TIMING.PANEL_ENTER_S, ease: EASING.SMOOTH }
    },
  }

  const suggestions = [t.ai.suggestion1, t.ai.suggestion2, t.ai.suggestion3]

  const dialog = (
    <>
      {/* Chat Panel */}
      {hasEverOpened && (
        <motion.div
          ref={panelRef}
          className="fixed z-[99999] w-[420px] h-[360px] rounded-2xl shadow-app-elevated overflow-hidden flex flex-col border border-app-border"
          style={{
            bottom: '68px',
            left: '50%',
            visibility: isOpen ? 'visible' : 'hidden',
            pointerEvents: isOpen ? 'auto' : 'none',
          }}
          initial="hidden"
          animate={isOpen ? "visible" : "hidden"}
          variants={panelVariants}
        >
          {/* Connection Status Banner */}
          {connectionStatus === 'error' && (
            <div className="bg-red-100 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-red-800 dark:text-red-200">{t.ai.connectionFailed}</span>
                <button onClick={() => connectWithRetry()} className="text-sm text-red-800 dark:text-red-200 underline hover:no-underline">
                  {t.ai.retry}
                </button>
              </div>
              <p className="text-xs text-red-700 dark:text-red-300">
                {t.ai.ensureSanqianRunning}{' '}
                <a href="https://sanqian.io" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline font-medium">
                  {t.ai.visitSanqian}
                </a>
              </p>
            </div>
          )}
          {connectionStatus === 'connecting' && (
            <div className="bg-blue-100 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-4 py-2">
              <span className="text-sm text-blue-800 dark:text-blue-200">{t.ai.connecting}</span>
            </div>
          )}

          <CompactChat
            adapter={adapter}
            placeholder={t.ai.placeholder}
            autoConnect={false}
            hideHeader={false}
            inputPortalContainer={inputContainer}
            newConversationRef={chatNewConversationRef}
            focusInputRef={chatFocusInputRef}
            setTextRef={chatSetTextRef}
            onLoadingChange={handleLoadingChange}
            onStateChange={handleStateChange}
            isDarkMode={resolvedColorMode === 'dark'}
            getErrorMessage={(errorCode) => getAIErrorMessage(mapLegacyErrorCode(errorCode), t)}
            headerLeft={
              <div className="flex items-center gap-2">
                <img src={notesLogo} alt="Notes" className="w-5 h-5" />
              </div>
            }
            headerRight={
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg hover:bg-app-surface text-app-muted hover:text-app-text transition-colors"
                title={t.ai.close}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            }
            emptyState={
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <h3 className="text-base font-medium mb-3 text-app-text">{t.ai.greeting}</h3>
                <div className="flex flex-wrap justify-center gap-2 mb-3">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="px-3 py-1.5 text-sm bg-app-surface rounded-full hover:bg-app-border transition-colors text-app-text"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            }
            strings={{
              chat: t.ai.chat,
              selectConversation: t.ai.selectConversation,
              recentChats: t.ai.recentChats,
              newChat: t.ai.newChat,
              noHistory: t.ai.noHistory,
              loadMore: t.ai.loadMore,
              today: t.date.today,
              yesterday: t.date.yesterday,
              delete: t.ai.delete,
            }}
          />
        </motion.div>
      )}

      {/* AI Button */}
      <div className="fixed bottom-14 right-6 z-[99999]">
        <AnimatePresence mode="wait">
          {isOpen ? null : (
            <motion.button
              key="ai-button"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{
                opacity: hasActiveSession ? 1 : (isHovered ? 1 : 0.6),
                scale: 1
              }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{
                opacity: { duration: 0.3, ease: 'easeOut' },
                scale: { duration: TIMING.SESSION_PILL_S, ease: EASING.SMOOTH }
              }}
              onClick={handleSessionPillClick}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              className="bg-app-surface border border-app-border rounded-full w-9 h-9 flex items-center justify-center shadow-app-soft hover:shadow-app-elevated cursor-pointer relative"
            >
              <motion.img
                src={notesLogo}
                alt="AI"
                className="w-5 h-5"
                style={resolvedColorMode === 'dark' ? { filter: 'invert(1)' } : {}}
                animate={{ rotate: (hasActiveSession || isHovered) ? 360 : 0 }}
                transition={{
                  duration: 20,
                  ease: 'linear',
                  repeat: (hasActiveSession || isHovered) ? Infinity : 0,
                }}
              />
              {isLoading && (
                <div className="absolute -bottom-1 -right-1 flex gap-0.5 bg-app-surface rounded-full px-1.5 py-0.5 border border-app-border">
                  <span className="w-1 h-1 bg-app-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 bg-app-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 bg-app-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
              {hasActiveSession && !isLoading && (
                <div className="absolute -bottom-0.5 -right-0.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-app-accent opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-app-accent"></span>
                  </span>
                </div>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Input Container - Portal target */}
      <div
        ref={inputContainerRef}
        className="fixed z-[100000] w-[420px] bg-app-bg border border-app-border rounded-2xl shadow-app-elevated overflow-hidden"
        style={{
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          visibility: isOpen ? 'visible' : 'hidden',
          pointerEvents: isOpen ? 'auto' : 'none'
        }}
      />
    </>
  )

  return createPortal(dialog, document.body)
}
