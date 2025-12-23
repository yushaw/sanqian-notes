import type {
  AttachmentResult,
  AttachmentSelectOptions,
  AttachmentAPI,
  ChatAPI,
  ChatMessage,
  ChatStreamEvent,
  ConversationInfo,
  ConversationDetail
} from '../shared/types'

export {
  AttachmentResult,
  AttachmentSelectOptions,
  AttachmentAPI,
  ChatAPI,
  ChatMessage,
  ChatStreamEvent,
  ConversationInfo,
  ConversationDetail
}

declare global {
  interface Window {
    electron: {
      app: {
        getVersion: () => Promise<string>
      }
      updater: {
        check: () => Promise<{ status: string; version?: string | null; error?: string }>
        download: () => Promise<{ success: boolean; error?: string }>
        install: () => Promise<{ success: boolean; error?: string }>
        getStatus: () => Promise<{ status: string; version: string | null; progress: number; error: string | null }>
        onStatus: (callback: (status: { status: string; version: string | null; progress: number; error: string | null }) => void) => () => void
      }
      note: {
        getAll: () => Promise<unknown[]>
        getById: (id: string) => Promise<unknown | null>
        add: (note: unknown) => Promise<unknown>
        update: (id: string, updates: unknown) => Promise<unknown | null>
        delete: (id: string) => Promise<boolean>
        search: (query: string) => Promise<unknown[]>
        createDemo: () => Promise<void>
        onDataChanged: (callback: () => void) => () => void
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
        get: () => Promise<NodeJS.Platform>
      }
      attachment: AttachmentAPI
      chat: ChatAPI
    }
    api: unknown
  }
}
