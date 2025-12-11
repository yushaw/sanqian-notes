/// <reference types="vite/client" />

interface Window {
  electron: {
    note: {
      getAll: () => Promise<Note[]>
      getById: (id: string) => Promise<Note | null>
      add: (note: NoteInput) => Promise<Note>
      update: (id: string, updates: Partial<NoteInput>) => Promise<Note | null>
      delete: (id: string) => Promise<boolean>
      search: (query: string) => Promise<Note[]>
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
      get: () => Promise<string>
    }
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
  created_at: string
  updated_at: string
}

interface NoteInput {
  title: string
  content: string
  notebook_id?: string | null
  is_daily?: boolean
  daily_date?: string | null
  is_favorite?: boolean
}

interface Notebook {
  id: string
  name: string
  color: string
  order_index: number
  created_at: string
}

interface NotebookInput {
  name: string
  color?: string
}

interface Tag {
  id: string
  name: string
}
