/**
 * Chat Window Preload - uses sanqian-chat preload API
 *
 * This preload is used by the FloatingWindow for chat.
 * It exposes the sanqian-chat API via contextBridge.
 *
 * API spec: @yushaw/sanqian-chat/preload
 */

import { contextBridge, ipcRenderer } from 'electron'

export interface HitlResponse {
  approved?: boolean
  input?: string
  rememberChoice?: boolean
}

export interface SanqianChatAPI {
  // Connection
  connect(): Promise<{ success: boolean; error?: string }>
  isConnected(): Promise<boolean>

  // Chat
  stream(params: {
    streamId: string
    messages: Array<{ role: string; content: string }>
    conversationId?: string
    agentId?: string | null
  }): Promise<void>
  cancelStream(params: { streamId: string }): Promise<{ success: boolean }>
  onStreamEvent(callback: (streamId: string, event: unknown) => void): () => void

  // HITL (Human-in-the-loop)
  sendHitlResponse(params: { response: HitlResponse; runId?: string }): Promise<{ success: boolean }>

  // Conversations
  listConversations(params?: { limit?: number; offset?: number }): Promise<{ success: boolean; data?: unknown; error?: string }>
  getConversation(params: { conversationId: string; messageLimit?: number }): Promise<{ success: boolean; data?: unknown; error?: string }>
  deleteConversation(params: { conversationId: string }): Promise<{ success: boolean; error?: string }>

  // Window
  hide(): Promise<{ success: boolean }>
  setAlwaysOnTop(params: { alwaysOnTop: boolean }): Promise<{ success: boolean; error?: string }>
  getAlwaysOnTop(): Promise<{ success: boolean; data?: boolean; error?: string }>

  // Theme (synced from main window)
  getThemeSettings(): Promise<{ colorMode: 'light' | 'dark'; accentColor: string; locale: 'en' | 'zh'; fontSize?: 'small' | 'normal' | 'large' | 'extra-large' }>
  onThemeUpdated(callback: (settings: { colorMode: 'light' | 'dark'; accentColor: string; locale: 'en' | 'zh'; fontSize?: 'small' | 'normal' | 'large' | 'extra-large' }) => void): () => void
}

const api: SanqianChatAPI = {
  connect: () => ipcRenderer.invoke('sanqian-chat:connect'),
  isConnected: () => ipcRenderer.invoke('sanqian-chat:isConnected'),

  stream: (params) => ipcRenderer.invoke('sanqian-chat:stream', params),
  cancelStream: (params) => ipcRenderer.invoke('sanqian-chat:cancelStream', params),
  onStreamEvent: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, data: { streamId: string; event: unknown }) => {
      callback(data.streamId, data.event)
    }
    ipcRenderer.on('sanqian-chat:streamEvent', handler)
    return () => ipcRenderer.removeListener('sanqian-chat:streamEvent', handler)
  },

  sendHitlResponse: (params) => ipcRenderer.invoke('sanqian-chat:sendHitlResponse', params),

  listConversations: (params) => ipcRenderer.invoke('sanqian-chat:listConversations', params),
  getConversation: (params) => ipcRenderer.invoke('sanqian-chat:getConversation', params),
  deleteConversation: (params) => ipcRenderer.invoke('sanqian-chat:deleteConversation', params),

  hide: () => ipcRenderer.invoke('sanqian-chat:hide'),
  setAlwaysOnTop: (params) => ipcRenderer.invoke('sanqian-chat:setAlwaysOnTop', params),
  getAlwaysOnTop: () => ipcRenderer.invoke('sanqian-chat:getAlwaysOnTop'),

  getThemeSettings: () => ipcRenderer.invoke('theme:getSettings'),
  onThemeUpdated: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, settings: { colorMode: 'light' | 'dark'; accentColor: string; locale: 'en' | 'zh'; fontSize?: 'small' | 'normal' | 'large' | 'extra-large' }) =>
      callback(settings)
    ipcRenderer.on('theme:updated', handler)
    return () => ipcRenderer.removeListener('theme:updated', handler)
  },
}

// Expose to renderer
contextBridge.exposeInMainWorld('sanqianChat', api)

// Also expose basic window control for setContext
contextBridge.exposeInMainWorld('chatWindow', {
  onSetContext: (callback: (context: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, context: string) => callback(context)
    ipcRenderer.on('chatWindow:setContext', handler)
    return () => ipcRenderer.removeListener('chatWindow:setContext', handler)
  },
})

// Type augmentation for window
declare global {
  interface Window {
    sanqianChat: SanqianChatAPI
    chatWindow: {
      onSetContext: (callback: (context: string) => void) => () => void
    }
  }
}

