import { describe, expect, it } from 'vitest'
import { parseNoteSearchFilterInput, parseSmartViewIdInput } from '../ipc/note-search-filter-input'

describe('note-search-filter-input', () => {
  it('parses supported smart view ids only', () => {
    expect(parseSmartViewIdInput('all')).toBe('all')
    expect(parseSmartViewIdInput('daily')).toBe('daily')
    expect(parseSmartViewIdInput('recent')).toBe('recent')
    expect(parseSmartViewIdInput('favorites')).toBe('favorites')
    expect(parseSmartViewIdInput('trash')).toBe('trash')
    expect(parseSmartViewIdInput('archived')).toBeUndefined()
    expect(parseSmartViewIdInput(null)).toBeUndefined()
  })

  it('parses valid note search filter inputs', () => {
    expect(parseNoteSearchFilterInput(undefined)).toBeUndefined()
    expect(parseNoteSearchFilterInput({})).toEqual({})
    expect(parseNoteSearchFilterInput({ notebookId: 'nb-1', viewType: 'all' })).toEqual({
      notebookId: 'nb-1',
      viewType: 'all',
    })
  })

  it('preserves explicit undefined notebookId as own property', () => {
    const parsed = parseNoteSearchFilterInput({ notebookId: undefined })
    expect(parsed).toEqual({ notebookId: undefined })
    expect(parsed).not.toBeNull()
    expect(parsed).not.toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(parsed, 'notebookId')).toBe(true)
  })

  it('rejects invalid note search filter inputs', () => {
    const tooLongNotebookId = 'x'.repeat(1025)
    expect(parseNoteSearchFilterInput(null)).toBeNull()
    expect(parseNoteSearchFilterInput([])).toBeNull()
    expect(parseNoteSearchFilterInput({ notebookId: '' })).toBeNull()
    expect(parseNoteSearchFilterInput({ notebookId: '   ' })).toBeNull()
    expect(parseNoteSearchFilterInput({ notebookId: 'nb-1\0x' })).toBeNull()
    expect(parseNoteSearchFilterInput({ notebookId: tooLongNotebookId })).toBeNull()
    expect(parseNoteSearchFilterInput({ notebookId: 7 })).toBeNull()
    expect(parseNoteSearchFilterInput({ viewType: 'archived' })).toBeNull()
  })
})
