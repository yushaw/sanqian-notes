import type { AttachmentResult, AttachmentSelectOptions, AttachmentAPI } from '../shared/types'

export { AttachmentResult, AttachmentSelectOptions, AttachmentAPI }

declare global {
  interface Window {
    electron: {
      note: {
        getAll: () => Promise<unknown[]>
        getById: (id: string) => Promise<unknown | null>
        add: (note: unknown) => Promise<unknown>
        update: (id: string, updates: unknown) => Promise<unknown | null>
        delete: (id: string) => Promise<boolean>
        search: (query: string) => Promise<unknown[]>
        createDemo: () => Promise<void>
      }
      trash: {
        getAll: () => Promise<unknown[]>
        restore: (id: string) => Promise<boolean>
        permanentDelete: (id: string) => Promise<boolean>
        empty: () => Promise<number>
        cleanup: () => Promise<number>
      }
      notebook: {
        getAll: () => Promise<unknown[]>
        add: (notebook: unknown) => Promise<unknown>
        update: (id: string, updates: unknown) => Promise<unknown | null>
        delete: (id: string) => Promise<boolean>
      }
      tag: {
        getAll: () => Promise<unknown[]>
        getByNote: (noteId: string) => Promise<unknown[]>
      }
      theme: {
        get: () => Promise<'light' | 'dark'>
        onChange?: (callback: (theme: 'light' | 'dark') => void) => void
      }
      window: {
        setTitleBarOverlay: (options: { color: string; symbolColor: string }) => Promise<void>
        setFullScreen: (isFullScreen: boolean) => Promise<boolean>
        isFullScreen: () => Promise<boolean>
      }
      platform: {
        get: () => Promise<string>
      }
      attachment: AttachmentAPI
      chat: {
        connect: () => Promise<{ success: boolean; error?: string }>
        disconnect: () => Promise<{ success: boolean; error?: string }>
        stream: (params: {
          streamId: string
          messages: unknown[]
          conversationId?: string
          agentId?: string
        }) => Promise<{ success: boolean; error?: string }>
        cancelStream: (params: { streamId: string }) => Promise<{ success: boolean; error?: string }>
        listConversations: (params: {
          limit?: number
          offset?: number
          agentId?: string
        }) => Promise<{ success: boolean; data?: unknown; error?: string }>
        getConversation: (params: {
          conversationId: string
          messageLimit?: number
        }) => Promise<{ success: boolean; data?: unknown; error?: string }>
        deleteConversation: (params: {
          conversationId: string
        }) => Promise<{ success: boolean; error?: string }>
        sendHitlResponse: (params: { response: unknown; runId?: string }) => void
        onStatusChange: (callback: (status: string, error?: string, errorCode?: string) => void) => void
        onStreamEvent: (callback: (streamId: string, event: unknown) => void) => void
      }
    }
    api: unknown
  }
}
