import type { Editor as TiptapEditor } from '@tiptap/react'

interface JsonLikeNode {
  toJSON(): Record<string, unknown>
}

export interface ExternalSyncResult {
  changed: boolean
  synced: boolean
  usedFallback: boolean
}

/** Recursively strip blockId attrs from a toJSON() representation. */
function stripBlockIds(obj: Record<string, unknown>): void {
  const attrs = obj.attrs as Record<string, unknown> | undefined
  if (attrs) {
    delete attrs.blockId
    if (Object.keys(attrs).length === 0) delete obj.attrs
  }
  const content = obj.content
  if (Array.isArray(content)) {
    for (const child of content) stripBlockIds(child as Record<string, unknown>)
  }
}

/** Compare two ProseMirror nodes ignoring blockId differences. */
function blockContentEqual(a: JsonLikeNode, b: JsonLikeNode): boolean {
  const aj = a.toJSON()
  const bj = b.toJSON()
  stripBlockIds(aj)
  stripBlockIds(bj)
  return JSON.stringify(aj) === JSON.stringify(bj)
}

/**
 * Dispatch an external document update using a minimal ProseMirror transaction.
 *
 * Uses head-tail block matching to find the smallest contiguous changed region,
 * then replaces only that region with addToHistory:false.
 *
 * @returns true if a transaction was dispatched, false if no changes detected.
 */
export function dispatchMinimalExternalUpdate(
  editor: TiptapEditor,
  externalContent: unknown
): boolean {
  const newDoc = editor.schema.nodeFromJSON(externalContent)
  const oldDoc = editor.state.doc
  const oldCount = oldDoc.childCount
  const newCount = newDoc.childCount

  // Head matching -- find identical blocks from the start
  let headMatch = 0
  while (headMatch < oldCount && headMatch < newCount) {
    if (blockContentEqual(oldDoc.child(headMatch), newDoc.child(headMatch))) {
      headMatch++
    } else {
      break
    }
  }

  // Tail matching -- find identical blocks from the end
  let tailMatch = 0
  const maxTail = Math.min(oldCount - headMatch, newCount - headMatch)
  while (tailMatch < maxTail) {
    if (blockContentEqual(
      oldDoc.child(oldCount - 1 - tailMatch),
      newDoc.child(newCount - 1 - tailMatch)
    )) {
      tailMatch++
    } else {
      break
    }
  }

  // Documents are equivalent (ignoring blockId) -- nothing to do
  if (headMatch + tailMatch >= oldCount && headMatch + tailMatch >= newCount) {
    return false
  }

  // Compute position range in old doc for the changed middle region
  let from = 0
  for (let i = 0; i < headMatch; i++) from += oldDoc.child(i).nodeSize
  let to = from
  for (let i = headMatch; i < oldCount - tailMatch; i++) to += oldDoc.child(i).nodeSize

  // Collect replacement nodes from the new doc's middle region
  const replacementNodes: ReturnType<typeof newDoc.child>[] = []
  for (let i = headMatch; i < newCount - tailMatch; i++) {
    replacementNodes.push(newDoc.child(i))
  }

  const { tr } = editor.state
  if (replacementNodes.length > 0) {
    tr.replaceWith(from, to, replacementNodes)
  } else {
    tr.delete(from, to)
  }
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
  return true
}

/**
 * Apply external content with minimal-diff first, then safe fallback.
 *
 * Fallback path uses setContent(emitUpdate:false) to avoid crashing the editor
 * when malformed JSON or schema mismatch causes minimal diff to throw.
 */
export function syncExternalContent(
  editor: TiptapEditor,
  externalContent: unknown
): ExternalSyncResult {
  try {
    const changed = dispatchMinimalExternalUpdate(editor, externalContent)
    return {
      changed,
      synced: true,
      usedFallback: false,
    }
  } catch (minimalError) {
    console.error('[Editor] Minimal external sync failed, falling back to setContent:', minimalError)
    try {
      const applied = editor.commands.setContent(externalContent as Record<string, unknown>, { emitUpdate: false })
      if (!applied) {
        console.error('[Editor] External sync fallback returned false (setContent not applied).')
        return {
          changed: false,
          synced: false,
          usedFallback: true,
        }
      }
      return {
        changed: true,
        synced: true,
        usedFallback: true,
      }
    } catch (fallbackError) {
      console.error('[Editor] External sync fallback failed:', fallbackError)
      return {
        changed: false,
        synced: false,
        usedFallback: true,
      }
    }
  }
}
