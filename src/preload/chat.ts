/**
 * Chat Window Preload - uses sanqian-chat preload API
 *
 * This preload is used by ChatPanel for chat.
 * It uses the SDK's factory function and extends with custom methods.
 *
 * API spec: @yushaw/sanqian-chat/preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  createSanqianChatApi,
  createChatPanelApi,
  type SanqianChatAPI,
} from '@yushaw/sanqian-chat/preload'
import type { ThemeSettings, ThemeAPI } from '../shared/types'

// Extended API: SanqianChatAPI + ThemeAPI (sanqian-notes specific)
interface ExtendedSanqianChatAPI extends SanqianChatAPI, ThemeAPI {}

// Use SDK's factory function and extend with theme methods
const api: ExtendedSanqianChatAPI = {
  ...createSanqianChatApi(),

  // Theme settings (sanqian-notes specific)
  getThemeSettings: () => ipcRenderer.invoke('theme:getSettings'),
  onThemeUpdated: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, settings: ThemeSettings) => callback(settings)
    ipcRenderer.on('theme:updated', handler)
    return () => ipcRenderer.removeListener('theme:updated', handler)
  },
}

// Expose to renderer
contextBridge.exposeInMainWorld('sanqianChat', api)

/** Payload for navigating to a note from chat */
interface NavigateToNotePayload {
  noteId: string
  target?: { type: 'heading' | 'block'; value: string }
}

// Also expose basic window control for setContext and navigation
contextBridge.exposeInMainWorld('chatWindow', {
  onSetContext: (callback: (context: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, context: string) => callback(context)
    ipcRenderer.on('chatWindow:setContext', handler)
    return () => ipcRenderer.removeListener('chatWindow:setContext', handler)
  },

  /**
   * Navigate to a note in the main window.
   * Triggered when user clicks a sanqian-notes:// link in chat.
   */
  navigateToNote: (payload: NavigateToNotePayload) => {
    ipcRenderer.send('chat:navigate-to-note', payload)
  },
})

// ============ ChatPanel API ============
// Use SDK's factory function
contextBridge.exposeInMainWorld('chatPanel', createChatPanelApi())

// Type augmentation for window
// Note: sanqianChat and chatPanel types are declared in @yushaw/sanqian-chat/preload
// We only need to declare our custom chatWindow here
declare global {
  interface Window {
    chatWindow: {
      onSetContext: (callback: (context: string) => void) => () => void
      navigateToNote: (payload: NavigateToNotePayload) => void
    }
  }
}

