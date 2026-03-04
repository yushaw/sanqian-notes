import type { NoteConversationScope } from './noteConversationScope'

interface DetachedNoteContext {
  noteId?: string | null
}

type BindingResult = 'bound' | 'touched' | 'skipped'

export interface ConversationChangeMetaLike {
  source?: 'active' | 'background'
  streamToken?: string
  detached?: boolean
  detachContext?: unknown
}

export function resolveDetachNoteIdForSwitch(
  previousNoteId: string | null | undefined,
  currentNoteId: string | null
): string | null {
  if (previousNoteId !== undefined) {
    return previousNoteId
  }
  return currentNoteId
}

function getDetachedNoteId(meta?: ConversationChangeMetaLike): string | null | undefined {
  if (meta?.source !== 'background') return undefined
  const detachContext = meta.detachContext
  if (!detachContext || typeof detachContext !== 'object') return undefined
  const candidate = (detachContext as DetachedNoteContext).noteId
  if (typeof candidate === 'string') return candidate
  if (candidate === null) return null
  return undefined
}

export function resolveNoteIdForConversationBinding(
  currentNoteId: string | null,
  meta?: ConversationChangeMetaLike,
  activeStreamOwnerNoteId?: string | null
): string | null {
  if (meta?.source !== 'background' && activeStreamOwnerNoteId !== undefined) {
    return activeStreamOwnerNoteId
  }
  const detachedNoteId = getDetachedNoteId(meta)
  if (detachedNoteId !== undefined) {
    return detachedNoteId
  }
  return currentNoteId
}

export function applyNoteConversationBinding(params: {
  scope: NoteConversationScope
  conversationId: string
  currentNoteId: string | null
  activeStreamOwnerNoteId?: string | null
  timestampMs: number
  meta?: ConversationChangeMetaLike
}): BindingResult {
  const { scope, conversationId, currentNoteId, activeStreamOwnerNoteId, timestampMs, meta } = params
  if (!conversationId) return 'skipped'

  const existing = scope.getBinding(conversationId)
  if (existing) {
    scope.touchConversation(conversationId, timestampMs)
    return 'touched'
  }

  const targetNoteId = resolveNoteIdForConversationBinding(currentNoteId, meta, activeStreamOwnerNoteId)
  if (!targetNoteId) return 'skipped'

  scope.bindConversationToNote(conversationId, targetNoteId, timestampMs)
  return 'bound'
}
