export interface Note {
  id: string
  title: string
  content: string // JSON string from BlockNote
  notebook_id: string | null
  is_daily: boolean
  daily_date: string | null // YYYY-MM-DD format
  is_favorite: boolean
  created_at: string
  updated_at: string
}

export interface NoteInput {
  title: string
  content: string
  notebook_id?: string | null
  is_daily?: boolean
  daily_date?: string | null
  is_favorite?: boolean
}

export interface Notebook {
  id: string
  name: string
  color: string
  order_index: number
  created_at: string
}

export interface NotebookInput {
  name: string
  color?: string
}

export interface Tag {
  id: string
  name: string
}

export interface NoteTag {
  note_id: string
  tag_id: string
}

export type SmartViewId = 'all' | 'daily' | 'recent' | 'favorites'

export interface NoteLink {
  source_note_id: string
  target_note_id: string
}
