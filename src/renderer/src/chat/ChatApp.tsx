/**
 * ChatApp - Main chat application component
 *
 * Uses sanqian-chat's CompactChat with IPC adapter.
 * Supports dynamic theme and locale via ChatUiConfig.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { CompactChat, createIpcAdapter, type ChatAdapter, type ChatUiConfig } from '@yushaw/sanqian-chat/renderer'
import '@yushaw/sanqian-chat/renderer/styles/variables.css'
import notesLogo from '../assets/notes-logo.png'

// Font size options matching sanqian-chat ChatUiConfig
type FontSize = 'small' | 'normal' | 'large' | 'extra-large'

// Theme settings synced from main window
interface ThemeSettings {
  colorMode: 'light' | 'dark'
  accentColor: string
  locale: 'en' | 'zh'
  fontSize?: FontSize
}

function useThemeSettings() {
  const [settings, setSettings] = useState<ThemeSettings>({
    colorMode: 'light',
    accentColor: '#2563EB',
    locale: 'en',
    fontSize: 'normal'
  })

  useEffect(() => {
    // Get initial settings from main process
    window.sanqianChat?.getThemeSettings?.().then((s) => {
      if (s) setSettings(s)
    }).catch((err) => {
      console.error('[ChatApp] Failed to get theme settings:', err)
    })

    // Listen for updates
    const cleanup = window.sanqianChat?.onThemeUpdated?.((s) => {
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

    const cleanup = chatWindow.onSetContext((context: string) => {
      if (context && chatSetTextRef.current) {
        chatSetTextRef.current(context)
        chatFocusInputRef.current?.()
      }
    })

    return cleanup
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
        headerLeft={
          <img src={notesLogo} alt="Notes" className="chat-header-logo" draggable={false} />
        }
      />
    </div>
  )
}
