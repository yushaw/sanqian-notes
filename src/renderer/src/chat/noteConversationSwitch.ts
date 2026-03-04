export interface ConversationSwitchOptionsLike {
  cancelActiveStream?: boolean
  detachContext?: unknown
}

export interface ConversationSwitchCapabilitiesLike {
  conversationSwitch?: {
    supportsCancelActiveStream?: boolean
    supportsDetachContext?: boolean
  }
}

export function supportsStreamPreservingSwitch(
  capabilities?: ConversationSwitchCapabilitiesLike
): boolean {
  const conversationSwitch = capabilities?.conversationSwitch
  return (
    conversationSwitch?.supportsCancelActiveStream === true
    && conversationSwitch?.supportsDetachContext === true
  )
}

export interface NoteConversationSwitchPlanInput {
  targetConversationId: string | null
  allowQueue: boolean
  currentConversationId: string | null
  currentMessageCount: number
  isStreaming: boolean
  supportsStreamPreservingSwitch: boolean
  detachNoteId: string | null
}

export type NoteConversationSwitchPlan =
  | { kind: 'noop' }
  | { kind: 'queue'; targetConversationId: string | null }
  | {
      kind: 'load'
      conversationId: string
      stopStreamingFirst: boolean
      options?: ConversationSwitchOptionsLike
    }
  | {
      kind: 'new'
      stopStreamingFirst: boolean
      options?: ConversationSwitchOptionsLike
    }

export function planNoteConversationSwitch(
  input: NoteConversationSwitchPlanInput
): NoteConversationSwitchPlan {
  const {
    targetConversationId,
    allowQueue,
    currentConversationId,
    currentMessageCount,
    isStreaming,
    supportsStreamPreservingSwitch,
    detachNoteId,
  } = input

  const shouldOpenTargetConversation =
    !!targetConversationId && currentConversationId !== targetConversationId
  const shouldOpenEmptyConversation =
    !targetConversationId && (currentConversationId || currentMessageCount > 0)

  if (!shouldOpenTargetConversation && !shouldOpenEmptyConversation) {
    return { kind: 'noop' }
  }

  if (isStreaming && !supportsStreamPreservingSwitch && allowQueue) {
    return { kind: 'queue', targetConversationId }
  }

  const preserveStreamOptions: ConversationSwitchOptionsLike = {
    cancelActiveStream: false,
    detachContext: { noteId: detachNoteId },
  }

  if (shouldOpenTargetConversation && targetConversationId) {
    if (isStreaming && supportsStreamPreservingSwitch) {
      return {
        kind: 'load',
        conversationId: targetConversationId,
        stopStreamingFirst: false,
        options: preserveStreamOptions,
      }
    }
    return {
      kind: 'load',
      conversationId: targetConversationId,
      stopStreamingFirst: isStreaming,
    }
  }

  if (isStreaming && supportsStreamPreservingSwitch) {
    return {
      kind: 'new',
      stopStreamingFirst: false,
      options: preserveStreamOptions,
    }
  }
  return {
    kind: 'new',
    stopStreamingFirst: isStreaming,
  }
}
