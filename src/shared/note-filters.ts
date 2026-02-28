import { RECENT_DAYS } from './types'
import type { Note, NoteGetAllOptions } from './types'

export function resolveRecentThresholdMs(recentDays?: number): number {
  const normalizedDays = typeof recentDays === 'number' && Number.isFinite(recentDays) && recentDays > 0
    ? Math.floor(recentDays)
    : RECENT_DAYS
  return Date.now() - normalizedDays * 24 * 60 * 60 * 1000
}

export function applyViewTypeFilter(notes: Note[], options?: NoteGetAllOptions): Note[] {
  const viewType = options?.viewType
  if (!viewType) return notes

  switch (viewType) {
    case 'all':
      return notes.filter((note) => !note.is_daily)
    case 'recent': {
      const thresholdMs = resolveRecentThresholdMs(options?.recentDays)
      return notes.filter((note) => !note.is_daily && new Date(note.updated_at).getTime() > thresholdMs)
    }
    case 'favorites':
      return notes.filter((note) => note.is_favorite)
    case 'daily':
      return notes
        .filter((note) => note.is_daily)
        .sort((left, right) => (right.daily_date || '').localeCompare(left.daily_date || ''))
    case 'trash':
      return []
    default:
      return notes
  }
}
