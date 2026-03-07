import { describe, expect, it } from 'vitest'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { resolveTextSelectionRange, selectionHasNonCodeText, toTextSelectionRange } from '../link-selection'

describe('link-selection helpers', () => {
  it('returns null for collapsed selections', () => {
    expect(toTextSelectionRange({ from: 5, to: 5 })).toBeNull()
  })

  it('prefers the current editor selection when it is still available', () => {
    expect(
      resolveTextSelectionRange({ from: 2, to: 7 }, { from: 10, to: 14 })
    ).toEqual({ from: 2, to: 7 })
  })

  it('falls back to the preserved selection when focus loss collapses the current one', () => {
    expect(
      resolveTextSelectionRange({ from: 9, to: 9 }, { from: 3, to: 8 })
    ).toEqual({ from: 3, to: 8 })
  })

  it('detects that pure inline code selections cannot accept inline marks', () => {
    const doc = {
      nodesBetween: (_from: number, _to: number, callback: (node: any, pos: number) => void) => {
        callback({ isText: true, nodeSize: 6, marks: [{ type: { name: 'code' } }] }, 1)
      },
    } as unknown as ProseMirrorNode

    expect(selectionHasNonCodeText(doc, { from: 1, to: 5 })).toBe(false)
  })

  it('allows selections that contain plain text outside inline code', () => {
    const doc = {
      nodesBetween: (_from: number, _to: number, callback: (node: any, pos: number) => void) => {
        callback({ isText: true, nodeSize: 6, marks: [{ type: { name: 'code' } }] }, 1)
        callback({ isText: true, nodeSize: 6, marks: [] }, 7)
      },
    } as unknown as ProseMirrorNode

    expect(selectionHasNonCodeText(doc, { from: 1, to: 10 })).toBe(true)
  })
})
