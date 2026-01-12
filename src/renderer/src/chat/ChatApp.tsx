/**
 * ChatApp - Main chat application component
 *
 * Uses sanqian-chat's CompactChat with IPC adapter.
 * Supports dynamic theme and locale via ChatUiConfig.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { CompactChat, createIpcAdapter, type ChatAdapter, type ChatUiConfig, type LinkClickEvent, type LinkHandlerConfig } from '@yushaw/sanqian-chat/renderer'
import '@yushaw/sanqian-chat/renderer/styles/variables.css'
import notesLogo from '../assets/notes-logo.png'
import type { ThemeSettings, ThemeAPI } from '../../../shared/types'

// Cast window.sanqianChat to ThemeAPI (only theme methods are needed here)
const getThemeApi = () => window.sanqianChat as unknown as ThemeAPI | undefined

function useThemeSettings() {
  const [settings, setSettings] = useState<ThemeSettings>({
    colorMode: 'light',
    accentColor: '#2563EB',
    locale: 'en',
    fontSize: 'normal'
  })

  useEffect(() => {
    const api = getThemeApi()

    // Get initial settings from main process
    api?.getThemeSettings?.().then((s: ThemeSettings) => {
      if (s) setSettings(s)
    }).catch((err: Error) => {
      console.error('[ChatApp] Failed to get theme settings:', err)
    })

    // Listen for updates
    const cleanup = api?.onThemeUpdated?.((s: ThemeSettings) => {
      setSettings(s)
    })

    return () => cleanup?.()
  }, [])

  return settings
}

export default function ChatApp() {
  const themeSettings = useThemeSettings()
  const isDarkMode = themeSettings.colorMode === 'dark'
  const [isPinned, setIsPinned] = useState(true) // Default pinned (alwaysOnTop)

  // Create adapter once
  const adapter = useMemo<ChatAdapter | null>(() => {
    try {
      return createIpcAdapter()
    } catch (e) {
      console.error('[ChatApp] Failed to create adapter:', e)
      return null
    }
  }, [])

  // Refs for CompactChat control
  const chatFocusInputRef = useRef<(() => void) | null>(null)
  const chatSetTextRef = useRef<((text: string) => void) | null>(null)

  // Handle setContext from main window
  useEffect(() => {
    const chatWindow = (window as { chatWindow?: { onSetContext: (cb: (context: string) => void) => () => void } }).chatWindow
    if (!chatWindow) return

    let retryTimeout: ReturnType<typeof setTimeout> | null = null

    const cleanup = chatWindow.onSetContext((context: string) => {
      if (!context) return

      // Clear any pending retry
      if (retryTimeout) {
        clearTimeout(retryTimeout)
        retryTimeout = null
      }

      const trySetContext = (retriesLeft: number): void => {
        if (chatSetTextRef.current) {
          chatSetTextRef.current(context)
          chatFocusInputRef.current?.()
        } else if (retriesLeft > 0) {
          // Retry with exponential backoff (50ms, 100ms, 200ms)
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

  // Handle close button
  const handleClose = useCallback(() => {
    window.sanqianChat?.hide()
  }, [])

  // Handle pin toggle
  const handlePin = useCallback(async (pinned: boolean) => {
    if (window.sanqianChat) {
      try {
        await window.sanqianChat.setAlwaysOnTop({ alwaysOnTop: pinned })
        setIsPinned(pinned)
      } catch (err) {
        console.error('[ChatApp] Failed to set always on top:', err)
      }
    }
  }, [])

  // Build ChatUiConfig - uses settings synced from main window
  const chatConfig = useMemo<ChatUiConfig>(() => ({
    theme: themeSettings.colorMode,
    locale: themeSettings.locale,
    accentColor: themeSettings.accentColor,
    fontSize: themeSettings.fontSize,
    onClose: handleClose,
    onPin: handlePin,
    alwaysOnTop: isPinned,
  }), [themeSettings, handleClose, handlePin, isPinned])

  // Handle sanqian-notes:// links in chat messages
  const handleLinkClick = useCallback((event: LinkClickEvent): boolean => {
    const { href, url } = event

    // Only handle sanqian-notes:// protocol
    if (!href.startsWith('sanqian-notes://')) {
      return false // Let default behavior handle it
    }

    try {
      // Parse: sanqian-notes://note/{noteId}?heading=xxx&block=xxx
      // For custom protocols: hostname = 'note', pathname = '/{noteId}'
      const action = url?.hostname // 'note'
      const noteId = url?.pathname?.slice(1) // Remove leading '/'

      if (action === 'note' && noteId) {
        const heading = url?.searchParams.get('heading') || undefined
        const block = url?.searchParams.get('block') || undefined

        // Send navigation request to main window
        window.chatWindow?.navigateToNote({
          noteId,
          target: heading
            ? { type: 'heading' as const, value: heading }
            : block
            ? { type: 'block' as const, value: block }
            : undefined,
        })
      }

      return true // Handled
    } catch (err) {
      console.error('[ChatApp] Failed to handle note link:', href, err)
      return true // Still handled (prevent opening invalid URL)
    }
  }, [])

  // Link handler configuration for custom protocols
  const linkHandler = useMemo<LinkHandlerConfig>(() => ({
    allowedProtocols: ['sanqian-notes:'],
    onLinkClick: handleLinkClick,
  }), [handleLinkClick])

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
    <div className={`h-full ${isDarkMode ? 'dark' : ''}`}>
      <CompactChat
        adapter={adapter}
        config={chatConfig}
        autoConnect={true}
        hideHeader={false}
        floating={true}
        focusInputRef={chatFocusInputRef}
        setTextRef={chatSetTextRef}
        linkHandler={linkHandler}
        headerLeft={
          <img src={notesLogo} alt="Notes" className="chat-header-logo" draggable={false} />
        }
      />
    </div>
  )
}
