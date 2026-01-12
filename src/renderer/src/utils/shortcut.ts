/**
 * Shortcut utilities
 */

import { useState, useEffect } from 'react'

export const DEFAULT_CHAT_SHORTCUT = 'Command+K'

export const CHAT_SHORTCUT_CHANGE_EVENT = 'chatShortcutChange'

/**
 * Format shortcut string for display
 * - macOS: Command → ⌘, Control → ⌃, Alt → ⌥, Shift → ⇧
 * - Windows/Linux: Command → Ctrl
 */
export function formatShortcut(shortcut: string): string {
  const isMac = navigator.platform.toLowerCase().includes('mac')
  if (isMac) {
    return shortcut
      .replace('Command', '⌘')
      .replace('Control', '⌃')
      .replace('Alt', '⌥')
      .replace('Shift', '⇧')
  }
  return shortcut.replace('Command', 'Ctrl').replace('Control', 'Ctrl')
}

/**
 * Hook to get current chat shortcut with live updates
 * Returns empty string when user has cleared the shortcut (disabled)
 */
export function useChatShortcut(): string {
  const [shortcut, setShortcut] = useState<string>(DEFAULT_CHAT_SHORTCUT)

  useEffect(() => {
    window.electron?.appSettings?.get('chatShortcut').then((value) => {
      // 区分 null/undefined（未设置，用默认值）和 ''（已清除，禁用快捷键）
      if (value != null) setShortcut(value)
    })

    const handleChange = (e: Event) => {
      const newShortcut = (e as CustomEvent<string>).detail
      // 保持空字符串，不回退到默认值（空字符串表示用户禁用了快捷键）
      // 防御性检查：如果 detail 未定义，回退到默认值
      setShortcut(newShortcut ?? DEFAULT_CHAT_SHORTCUT)
    }
    window.addEventListener(CHAT_SHORTCUT_CHANGE_EVENT, handleChange)
    return () => window.removeEventListener(CHAT_SHORTCUT_CHANGE_EVENT, handleChange)
  }, [])

  return shortcut
}
