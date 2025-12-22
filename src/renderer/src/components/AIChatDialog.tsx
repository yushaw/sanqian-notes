/**
 * AIChatDialog - Clean and minimal AI chat dialog
 *
 * Completely mirrors TodoList's ChatPanel structure.
 * Structure:
 * - Chat Panel (with header and messages/history)
 * - Input Bar (separate, below the panel)
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { CompactChat } from '../lib/chat-ui/components/CompactChat'
import { createElectronAdapter } from '../lib/chat-ui/adapters/electron'
import { useTheme } from '../theme'
import { useTranslations } from '../i18n'
import notesLogo from '../assets/notes-logo.png'

// Animation timing constants (copied from TodoList)
const TIMING = {
  panelEnter: 0.2,
  panelExit: 0.15,
  sessionPill: 0.2,
}

interface AIChatDialogProps {
  isOpen: boolean
  onClose: () => void
  onOpen?: () => void  // Callback to request opening (for session pill)
}

export function AIChatDialog({ isOpen, onClose, onOpen }: AIChatDialogProps) {
  const { resolvedColorMode } = useTheme()
  const t = useTranslations()
  const [inputValue, setInputValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [lastActivityTime, setLastActivityTime] = useState<number | null>(null)
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [hasEverOpened, setHasEverOpened] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const chatSendMessageRef = useRef<((message: string) => void) | null>(null)

  // Create adapter instance (memoized)
  const adapter = useMemo(() => createElectronAdapter(), [])

  // Cleanup adapter on unmount
  useEffect(() => {
    return () => {
      adapter.cleanup?.()
    }
  }, [adapter])

  // Check if we have an active session (loading or recent activity within 10 min)
  // Must have at least one user message to be considered active
  const hasUserMessage = messages.some(m => m.role === 'user')
  const hasActiveSession = isLoading || (
    lastActivityTime !== null &&
    messages.length > 0 &&
    hasUserMessage &&
    Date.now() - lastActivityTime < 10 * 60 * 1000
  )

  // Get last message summary for session pill
  const lastMessage = messages[messages.length - 1]
  const sessionSummary = lastMessage?.role === 'assistant'
    ? lastMessage.content.slice(0, 30) + (lastMessage.content.length > 30 ? '...' : '')
    : null

  // Manage Sanqian SDK connection based on dialog state
  // Pattern follows TodoList's ChatPanel for consistency:
  //
  // When dialog opens:
  //   1. acquireReconnect() - Enable auto-reconnect (ref count++)
  //   2. connect() - Ensure SDK is connected and agent is ready
  //
  // When dialog closes:
  //   1. releaseReconnect() - Disable auto-reconnect (ref count--)
  //   2. Keep connection alive for faster next open
  //
  // This approach:
  // - Saves resources when inactive (no auto-reconnect)
  // - Keeps connection warm for instant reactivation
  // - Supports multiple components via reference counting
  useEffect(() => {
    if (isOpen) {
      // Enable auto-reconnect first
      window.electron.chat.acquireReconnect().catch((err) => {
        console.error('[AIChatDialog] Failed to acquire reconnect:', err)
      })
      // Then ensure connection
      window.electron.chat.connect().catch((err) => {
        console.error('[AIChatDialog] Failed to connect:', err)
      })
    } else {
      // Only release auto-reconnect, keep connection alive
      window.electron.chat.releaseReconnect().catch((err) => {
        console.error('[AIChatDialog] Failed to release reconnect:', err)
      })
    }
  }, [isOpen])

  // ESC key to close
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // If no user messages, clear the session (empty conversation)
        const hasUserMsg = messages.some(m => m.role === 'user')
        if (!hasUserMsg) {
          setMessages([])
          setConversationId(null)
          setLastActivityTime(null)
        }

        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, messages])

  // Track if dialog has ever been opened (to preserve CompactChat state)
  useEffect(() => {
    if (isOpen && !hasEverOpened) {
      setHasEverOpened(true)
    }
  }, [isOpen, hasEverOpened])

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Don't close if clicking on input
        const target = e.target as HTMLElement
        if (target.closest('input[type="text"]')) {
          return
        }

        // If no user messages, clear the session (empty conversation)
        const hasUserMsg = messages.some(m => m.role === 'user')
        if (!hasUserMsg) {
          // Clear session state for empty conversations
          setMessages([])
          setConversationId(null)
          setLastActivityTime(null)
        }

        onClose()
      }
    }
    if (isOpen) {
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside)
      }, 150)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
  }, [isOpen, onClose, messages])

  const handleSend = useCallback((message?: string) => {
    const textToSend = message || inputValue.trim()
    if (!textToSend) return

    // Clear input first
    if (!message) {
      setInputValue('')
    }

    // Send message through CompactChat's sendMessage
    if (chatSendMessageRef.current) {
      chatSendMessageRef.current(textToSend)
    }
  }, [inputValue])

  // Handle suggestion click - fill input and focus
  const handleSuggestionClick = useCallback((suggestion: string) => {
    setInputValue(suggestion)
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // Handle chat state change (messages and conversationId)
  const handleStateChange = useCallback((state: { messages: Array<{ role: string; content: string }>; conversationId: string | null }) => {
    setMessages(state.messages)
    setConversationId(state.conversationId)
    // Update last activity time when messages change
    if (state.messages.length > 0) {
      setLastActivityTime(Date.now())
    }
  }, [])

  // Handle message received (update session state)
  const handleMessageReceived = useCallback((message: { content: string }) => {
    setLastActivityTime(Date.now())
  }, [])

  // Handle loading state change
  const handleLoadingChange = useCallback((loading: boolean) => {
    setIsLoading(loading)
  }, [])

  // Handle close button - clear session completely (aligned with TodoList)
  const handleClose = useCallback(() => {
    onClose()
    // Clear all session state
    setMessages([])
    setConversationId(null)
    setLastActivityTime(null)
  }, [onClose])

  // Handle session pill click
  const handleSessionPillClick = useCallback(() => {
    onOpen?.()
  }, [onOpen])

  // Animation variants for the chat panel
  const panelVariants = {
    hidden: {
      opacity: 0,
      y: 12,
      scale: 0.98,
      x: '-50%',
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      x: '-50%',
      transition: {
        duration: TIMING.panelEnter,
        ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
      }
    },
    exit: {
      opacity: 0,
      y: 8,
      scale: 0.98,
      x: '-50%',
      transition: {
        duration: TIMING.panelExit,
        ease: [0.32, 0, 0.67, 0] as [number, number, number, number],
      }
    }
  }

  const suggestions = [t.ai.suggestion1, t.ai.suggestion2, t.ai.suggestion3]

  const dialog = (
    <>
      {/* Chat Panel - bottom center */}
      <AnimatePresence>
        {hasEverOpened && isOpen && (
          <motion.div
            ref={panelRef}
            className="fixed z-[99999] w-[420px] h-[360px] rounded-2xl shadow-app-elevated overflow-hidden flex flex-col border border-app-border"
            style={{
              bottom: '68px',
              left: '50%',
            }}
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={panelVariants}
          >
          <CompactChat
              adapter={adapter}
              placeholder={t.ai.placeholder}
              autoConnect={false}
              hideHeader={false}
              hideInput={true}
              sendMessageRef={chatSendMessageRef}
              onMessageReceived={handleMessageReceived}
              onLoadingChange={handleLoadingChange}
              onStateChange={handleStateChange}
              isDarkMode={resolvedColorMode === 'dark'}
              headerLeft={
                <div className="flex items-center gap-2">
                  <img
                    src={notesLogo}
                    alt="Notes"
                    className="w-5 h-5"
                  />
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
                  <h3 className="text-base font-medium mb-3 text-app-text">
                    {t.ai.greeting}
                  </h3>
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
      </AnimatePresence>

      {/* AI Button - fixed at bottom-right, Input Bar - centered at bottom */}
      <div className="fixed bottom-14 right-6 z-[99999]">
        <AnimatePresence mode="wait">
          {isOpen ? null : (
            // AI Button
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
                scale: { duration: TIMING.sessionPill, ease: [0.32, 0.72, 0, 1] }
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
                animate={{
                  rotate: (hasActiveSession || isHovered) ? 360 : 0,
                }}
                transition={{
                  duration: 20,
                  ease: 'linear',
                  repeat: (hasActiveSession || isHovered) ? Infinity : 0,
                }}
              />
              {/* Loading indicator */}
              {isLoading && (
                <div className="absolute -bottom-1 -right-1 flex gap-0.5 bg-app-surface rounded-full px-1.5 py-0.5 border border-app-border">
                  <span className="w-1 h-1 bg-app-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 bg-app-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 bg-app-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
              {/* Active session indicator - when not loading */}
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

      {/* Input Bar - bottom center */}
      {isOpen && (
        <div className="fixed z-[100000]" style={{ bottom: '24px', left: '50%', transform: 'translateX(-50%)' }}>
          <div className="w-[420px] bg-app-bg border border-app-border rounded-2xl shadow-app-elevated overflow-hidden relative">
            <div className="relative flex items-center gap-3 px-4 h-10">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder={t.ai.placeholder}
                className="flex-1 bg-transparent text-sm text-app-text placeholder:text-app-muted focus:outline-none min-w-0"
              />
              <button
                onClick={() => handleSend()}
                disabled={!inputValue.trim()}
                className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                  inputValue.trim()
                    ? 'bg-app-accent text-white hover:opacity-80'
                    : 'bg-app-border text-app-muted cursor-not-allowed'
                }`}
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  return createPortal(dialog, document.body)
}
