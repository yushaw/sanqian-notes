import { describe, expect, it } from 'vitest'
import type { Note } from '../../types/note'
import { applySummaryUpdateToNotes, getPendingSummaryPatch } from '../summaryEvents'

function createNote(id: string, summary: string | null): Note {
  const now = '2026-02-26T00:00:00.000Z'
  return {
    id,
    title: id,
    content: '{"type":"doc","content":[]}',
    notebook_id: 'nb-1',
    folder_path: null,
    is_daily: false,
    daily_date: null,
    is_favorite: false,
    is_pinned: false,
    revision: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ai_summary: summary,
    tags: [],
  }
}

describe('summaryEvents', () => {
  it('applies update when event ID matches existing note ID', () => {
    const notes = [createNote('note-1', null)]
    const merged = createNote('note-1', 'updated')

    const next = applySummaryUpdateToNotes(notes, 'note-1', merged)
    expect(next[0].ai_summary).toBe('updated')
  })

  it('applies update when canonical note ID matches even if event ID is alias', () => {
    const notes = [createNote('local:nb-1:path:docs%2Fplan.md', null)]
    const merged = createNote('local:nb-1:path:docs%2Fplan.md', 'updated')

    const next = applySummaryUpdateToNotes(notes, 'local:uid:nb-1:uid-123', merged)
    expect(next[0].ai_summary).toBe('updated')
  })

  it('prefers canonical pending patch and falls back to event ID patch', () => {
    const pending = new Map<string, { title?: string; content?: string }>()
    pending.set('local:uid:nb-1:uid-123', { title: 'from-event' })
    pending.set('local:nb-1:path:docs%2Fplan.md', { title: 'from-canonical' })

    const preferred = getPendingSummaryPatch(
      pending,
      'local:uid:nb-1:uid-123',
      'local:nb-1:path:docs%2Fplan.md'
    )
    expect(preferred).toEqual({ title: 'from-canonical' })

    pending.delete('local:nb-1:path:docs%2Fplan.md')
    const fallback = getPendingSummaryPatch(
      pending,
      'local:uid:nb-1:uid-123',
      'local:nb-1:path:docs%2Fplan.md'
    )
    expect(fallback).toEqual({ title: 'from-event' })
  })
})
