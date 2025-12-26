/// <reference types="vite/client" />

// 从 shared/types 导入类型
type AttachmentResult = import('../../shared/types').AttachmentResult
type AttachmentSelectOptions = import('../../shared/types').AttachmentSelectOptions
type AttachmentAPI = import('../../shared/types').AttachmentAPI
type ChatAPI = import('../../shared/types').ChatAPI
type AIAction = import('../../shared/types').AIAction
type AIActionInput = import('../../shared/types').AIActionInput
type AIActionAPI = import('../../shared/types').AIActionAPI

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
      getAll: () => Promise<Note[]>
      getById: (id: string) => Promise<Note | null>
      add: (note: NoteInput) => Promise<Note>
      update: (id: string, updates: Partial<NoteInput>) => Promise<Note | null>
      delete: (id: string) => Promise<boolean>
      search: (query: string) => Promise<Note[]>
      onDataChanged: (callback: () => void) => () => void
    }
    trash: {
      getAll: () => Promise<Note[]>
      restore: (id: string) => Promise<boolean>
      permanentDelete: (id: string) => Promise<boolean>
      empty: () => Promise<number>
      cleanup: () => Promise<number>
    }
    notebook: {
      getAll: () => Promise<Notebook[]>
      add: (notebook: NotebookInput) => Promise<Notebook>
      update: (id: string, updates: Partial<NotebookInput>) => Promise<Notebook | null>
      delete: (id: string) => Promise<boolean>
    }
    tag: {
      getAll: () => Promise<Tag[]>
      getByNote: (noteId: string) => Promise<Tag[]>
    }
    aiAction: {
      getAll: () => Promise<AIAction[]>
      getAllIncludingDisabled: () => Promise<AIAction[]>
      getById: (id: string) => Promise<AIAction | null>
      create: (input: AIActionInput) => Promise<AIAction>
      update: (id: string, updates: Partial<AIActionInput> & { enabled?: boolean }) => Promise<AIAction | null>
      delete: (id: string) => Promise<boolean>
      reorder: (orderedIds: string[]) => Promise<void>
      reset: () => Promise<void>
    }
    theme: {
      get: () => Promise<'light' | 'dark'>
      onChange?: (callback: (theme: 'light' | 'dark') => void) => void
    }
    window: {
      setTitleBarOverlay?: (options: { color: string; symbolColor: string }) => void
      setFullScreen: (isFullScreen: boolean) => Promise<boolean>
      isFullScreen: () => Promise<boolean>
    }
    platform: {
      get: () => Promise<NodeJS.Platform>
    }
    attachment: AttachmentAPI
    chat: ChatAPI
  }
}

interface Note {
  id: string
  title: string
  content: string
  notebook_id: string | null
  is_daily: boolean
  daily_date: string | null
  is_favorite: boolean
  is_pinned: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface NoteInput {
  title: string
  content: string
  notebook_id?: string | null
  is_daily?: boolean
  daily_date?: string | null
  is_favorite?: boolean
  is_pinned?: boolean
}

interface Notebook {
  id: string
  name: string
  icon?: string
  order_index: number
  created_at: string
}

interface NotebookInput {
  name: string
  icon?: string
}

interface Tag {
  id: string
  name: string
}

// AIAction and AIActionInput types are imported from shared/types
