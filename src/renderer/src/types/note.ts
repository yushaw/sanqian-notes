export interface Note {
  id: string
  title: string
  content: string // JSON string from BlockNote
  notebook_id: string | null
  is_daily: boolean
  daily_date: string | null // YYYY-MM-DD format
  is_favorite: boolean
  is_pinned: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null // Soft delete timestamp (trash)
  ai_summary: string | null // AI-generated summary
  tags: TagWithSource[] // Tags with source (user/ai)
}

export interface NoteInput {
  title: string
  content: string
  notebook_id?: string | null
  is_daily?: boolean
  daily_date?: string | null
  is_favorite?: boolean
  is_pinned?: boolean
}

export interface Notebook {
  id: string
  name: string
  icon?: string  // logo:notes, logo:todolist, logo:sanqian, logo:yinian, or emoji
  order_index: number
  created_at: string
}

export interface NotebookInput {
  name: string
  icon?: string
}

export interface Tag {
  id: string
  name: string
}

export interface TagWithSource extends Tag {
  source: 'user' | 'ai'
}

export interface NoteTag {
  note_id: string
  tag_id: string
}

export type SmartViewId = 'all' | 'daily' | 'recent' | 'favorites' | 'trash'

export interface NoteLink {
  source_note_id: string
  target_note_id: string
}
