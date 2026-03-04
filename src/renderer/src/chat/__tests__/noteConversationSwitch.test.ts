import { describe, expect, it } from 'vitest'
import {
  planNoteConversationSwitch,
  supportsStreamPreservingSwitch,
} from '../noteConversationSwitch'

describe('noteConversationSwitch', () => {
  it('requires detach context capability for stream preserving switch', () => {
    expect(supportsStreamPreservingSwitch({
      conversationSwitch: {
        supportsCancelActiveStream: true,
        supportsDetachContext: false,
      },
    })).toBe(false)
  })

  it('supports stream preserving switch when both capability flags are true', () => {
    expect(supportsStreamPreservingSwitch({
      conversationSwitch: {
        supportsCancelActiveStream: true,
        supportsDetachContext: true,
      },
    })).toBe(true)
  })

  it('returns noop when target is already active conversation', () => {
    const plan = planNoteConversationSwitch({
      targetConversationId: 'conv-1',
      allowQueue: true,
      currentConversationId: 'conv-1',
      currentMessageCount: 5,
      isStreaming: false,
      supportsStreamPreservingSwitch: true,
      detachNoteId: 'note-a',
    })
    expect(plan).toEqual({ kind: 'noop' })
  })

  it('queues when streaming without preserve capability and queue allowed', () => {
    const plan = planNoteConversationSwitch({
      targetConversationId: 'conv-2',
      allowQueue: true,
      currentConversationId: 'conv-1',
      currentMessageCount: 3,
      isStreaming: true,
      supportsStreamPreservingSwitch: false,
      detachNoteId: 'note-a',
    })
    expect(plan).toEqual({ kind: 'queue', targetConversationId: 'conv-2' })
  })

  it('loads target with detach options when preserve capability is available', () => {
    const plan = planNoteConversationSwitch({
      targetConversationId: 'conv-2',
      allowQueue: true,
      currentConversationId: 'conv-1',
      currentMessageCount: 3,
      isStreaming: true,
      supportsStreamPreservingSwitch: true,
      detachNoteId: 'note-a',
    })
    expect(plan).toEqual({
      kind: 'load',
      conversationId: 'conv-2',
      stopStreamingFirst: false,
      options: {
        cancelActiveStream: false,
        detachContext: { noteId: 'note-a' },
      },
    })
  })

  it('loads target with hard stop when preserve capability is unavailable and not queued', () => {
    const plan = planNoteConversationSwitch({
      targetConversationId: 'conv-2',
      allowQueue: false,
      currentConversationId: 'conv-1',
      currentMessageCount: 3,
      isStreaming: true,
      supportsStreamPreservingSwitch: false,
      detachNoteId: 'note-a',
    })
    expect(plan).toEqual({
      kind: 'load',
      conversationId: 'conv-2',
      stopStreamingFirst: true,
    })
  })

  it('starts empty conversation with detach options when preserve capability is available', () => {
    const plan = planNoteConversationSwitch({
      targetConversationId: null,
      allowQueue: true,
      currentConversationId: 'conv-1',
      currentMessageCount: 3,
      isStreaming: true,
      supportsStreamPreservingSwitch: true,
      detachNoteId: 'note-a',
    })
    expect(plan).toEqual({
      kind: 'new',
      stopStreamingFirst: false,
      options: {
        cancelActiveStream: false,
        detachContext: { noteId: 'note-a' },
      },
    })
  })

  it('starts empty conversation with hard stop when preserve capability is unavailable', () => {
    const plan = planNoteConversationSwitch({
      targetConversationId: null,
      allowQueue: false,
      currentConversationId: 'conv-1',
      currentMessageCount: 3,
      isStreaming: true,
      supportsStreamPreservingSwitch: false,
      detachNoteId: 'note-a',
    })
    expect(plan).toEqual({
      kind: 'new',
      stopStreamingFirst: true,
    })
  })
})
