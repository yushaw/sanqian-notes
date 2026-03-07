import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface TextSelectionRange {
  from: number
  to: number
}

type MaybeSelection = Pick<TextSelectionRange, 'from' | 'to'> | null | undefined

export function toTextSelectionRange(selection: MaybeSelection): TextSelectionRange | null {
  if (!selection || selection.from === selection.to) {
    return null
  }

  return { from: selection.from, to: selection.to }
}

export function resolveTextSelectionRange(
  currentSelection: MaybeSelection,
  preservedSelection: MaybeSelection
): TextSelectionRange | null {
  return toTextSelectionRange(currentSelection) ?? toTextSelectionRange(preservedSelection)
}

export function selectionHasNonCodeText(
  doc: ProseMirrorNode,
  selection: MaybeSelection
): boolean {
  const range = toTextSelectionRange(selection)

  if (!range) return false

  let hasNonCodeText = false

  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (hasNonCodeText || !node.isText) return

    const segmentFrom = Math.max(range.from, pos)
    const segmentTo = Math.min(range.to, pos + node.nodeSize)

    if (segmentFrom >= segmentTo) return

    if (!node.marks.some(mark => mark.type.name === 'code')) {
      hasNonCodeText = true
    }
  })

  return hasNonCodeText
}
