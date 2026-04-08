import { describe, expect, it } from 'vitest'
import {
  parseNotebookIdArrayInput,
  parseNotebookIdArrayInputOrUndefined,
  parseRequiredNotebookIdInput,
} from '../notebook-id'

describe('notebook-id helpers', () => {
  it('treats notebook id as opaque value and preserves surrounding spaces', () => {
    expect(parseRequiredNotebookIdInput('  nb-1  ')).toBe('  nb-1  ')
  })

  it('rejects blank notebook id values', () => {
    expect(parseRequiredNotebookIdInput('')).toBeNull()
    expect(parseRequiredNotebookIdInput('   ')).toBeNull()
    expect(parseRequiredNotebookIdInput('nb-\0-1')).toBeNull()
    expect(parseRequiredNotebookIdInput('n'.repeat(1025))).toBeNull()
    expect(parseRequiredNotebookIdInput(null)).toBeNull()
    expect(parseRequiredNotebookIdInput(undefined)).toBeNull()
    expect(parseRequiredNotebookIdInput(123)).toBeNull()
  })

  it('parses notebook id arrays and drops invalid values only', () => {
    expect(parseNotebookIdArrayInput(['  nb-1  ', 'nb-2', '', '   ', null, 7])).toEqual([
      '  nb-1  ',
      'nb-2',
    ])
  })

  it('returns undefined for non-array optional notebook id input', () => {
    expect(parseNotebookIdArrayInputOrUndefined(undefined)).toBeUndefined()
    expect(parseNotebookIdArrayInputOrUndefined(null)).toBeUndefined()
    expect(parseNotebookIdArrayInputOrUndefined('nb-1')).toBeUndefined()
    expect(parseNotebookIdArrayInputOrUndefined(['  nb-1  ', ''])).toEqual(['  nb-1  '])
  })

  it('fails closed for oversized notebook id arrays', () => {
    const oversized = Array.from({ length: 10001 }, (_, index) => `nb-${index}`)
    expect(parseNotebookIdArrayInput(oversized)).toEqual([])
    expect(parseNotebookIdArrayInputOrUndefined(oversized)).toEqual([])
  })
})
