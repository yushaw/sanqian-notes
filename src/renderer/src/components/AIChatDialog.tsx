/**
 * AIChatButton - Floating button to open independent AI chat window
 *
 * Opens a standalone chat window via IPC instead of rendering inline.
 */

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import { useTheme } from '../theme'
import { useTranslations } from '../i18n'
import { TIMING, EASING } from '../constants'
import { Tooltip } from './Tooltip'
import { formatShortcut, useChatShortcut } from '../utils/shortcut'
import notesLogo from '../assets/notes-logo.png'

// Event for opening chat with context
export const OPEN_CHAT_WITH_CONTEXT_EVENT = 'open-chat-with-context'
// Event for opening chat without context
export const OPEN_CHAT_EVENT = 'open-ai-chat'

export interface OpenChatWithContextDetail {
  selectedText: string
  explanation: string
}

export function openChatWithContext(detail: OpenChatWithContextDetail) {
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_WITH_CONTEXT_EVENT, { detail }))
}

export function openAIChat() {
  window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT))
}

export function AIChatDialog() {
  const { resolvedColorMode } = useTheme()
  const t = useTranslations()
  const [isHovered, setIsHovered] = useState(false)
  const chatShortcut = useChatShortcut()

  // Handle button click - open the floating chat window
  const handleClick = useCallback(() => {
    window.electron.chatWindow.show()
  }, [])

  // Listen for "open chat with context" events
  useEffect(() => {
    const handleOpenWithContext = (e: Event) => {
      const detail = (e as CustomEvent<OpenChatWithContextDetail>).detail
      if (detail) {
        // Open the chat window with context
        const contextMessage = t.ai.continueContextTemplate
          .replace('{selectedText}', detail.selectedText)
          .replace('{explanation}', detail.explanation)
        window.electron.chatWindow.showWithContext(contextMessage)
      }
    }

    window.addEventListener(OPEN_CHAT_WITH_CONTEXT_EVENT, handleOpenWithContext)

    // Also listen for simple open chat events
    const handleOpenChat = () => {
      window.electron.chatWindow.show()
    }
    window.addEventListener(OPEN_CHAT_EVENT, handleOpenChat)

    return () => {
      window.removeEventListener(OPEN_CHAT_WITH_CONTEXT_EVENT, handleOpenWithContext)
      window.removeEventListener(OPEN_CHAT_EVENT, handleOpenChat)
    }
  }, [t.ai.continueContextTemplate])

  // Build tooltip content with shortcut
  const tooltipContent = chatShortcut
    ? `${t.settings.openChatTooltip} (${formatShortcut(chatShortcut)})`
    : t.settings.openChatTooltip

  const button = (
    <div className="fixed bottom-14 right-6 z-[99999]">
      <Tooltip content={tooltipContent} placement="left">
        <AnimatePresence mode="wait">
          <motion.button
            key="ai-button"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{
              opacity: isHovered ? 1 : 0.6,
              scale: 1
            }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{
              opacity: { duration: 0.3, ease: 'easeOut' },
              scale: { duration: TIMING.SESSION_PILL_S, ease: EASING.SMOOTH }
            }}
            onClick={handleClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="bg-app-surface border border-app-border rounded-full w-9 h-9 flex items-center justify-center shadow-app-soft hover:shadow-app-elevated cursor-pointer relative"
          >
            <motion.img
              src={notesLogo}
              alt="AI"
              className="w-5 h-5"
              style={resolvedColorMode === 'dark' ? { filter: 'invert(1)' } : {}}
              animate={{ rotate: isHovered ? 360 : 0 }}
              transition={{
                duration: 20,
                ease: 'linear',
                repeat: isHovered ? Infinity : 0,
              }}
            />
          </motion.button>
        </AnimatePresence>
      </Tooltip>
    </div>
  )

  return createPortal(button, document.body)
}
