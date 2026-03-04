import { describe, expect, it } from 'vitest'
import { createNoteConversationScope } from '../noteConversationScope'
import {
  applyNoteConversationBinding,
  resolveNoteIdForConversationBinding,
  resolveDetachNoteIdForSwitch,
} from '../noteConversationBinding'

class MemoryStorage {
  private readonly map = new Map<string, string>()

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

describe('noteConversationBinding', () => {
  it('binds active conversation to current note', () => {
    const scope = createNoteConversationScope({ storage: new MemoryStorage() })
    const result = applyNoteConversationBinding({
      scope,
      conversationId: 'conv-1',
      currentNoteId: 'note-a',
      timestampMs: 1_700_000_000_000,
    })

    expect(result).toBe('bound')
    expect(scope.getBinding('conv-1')?.noteId).toBe('note-a')
  })

  it('uses detached note context for background conversation completion', () => {
    const scope = createNoteConversationScope({ storage: new MemoryStorage() })
    const result = applyNoteConversationBinding({
      scope,
      conversationId: 'conv-2',
      currentNoteId: 'note-b',
      timestampMs: 1_700_000_000_000,
      meta: {
        source: 'background',
        detached: true,
        detachContext: { noteId: 'note-a' },
      },
    })

    expect(result).toBe('bound')
    expect(scope.getBinding('conv-2')?.noteId).toBe('note-a')
  })

  it('skips binding when detached context explicitly has no note', () => {
    const scope = createNoteConversationScope({ storage: new MemoryStorage() })
    const result = applyNoteConversationBinding({
      scope,
      conversationId: 'conv-3',
      currentNoteId: 'note-b',
      timestampMs: 1_700_000_000_000,
      meta: {
        source: 'background',
        detached: true,
        detachContext: { noteId: null },
      },
    })

    expect(result).toBe('skipped')
    expect(scope.getBinding('conv-3')).toBeNull()
  })

  it('touches existing binding regardless of current note', () => {
    const storage = new MemoryStorage()
    const scope = createNoteConversationScope({
      storage,
      now: () => 1_700_000_000_000,
    })
    scope.bindConversationToNote('conv-4', 'note-a', 1_700_000_000_000 - 10_000)

    const result = applyNoteConversationBinding({
      scope,
      conversationId: 'conv-4',
      currentNoteId: 'note-b',
      timestampMs: 1_700_000_000_000,
      meta: {
        source: 'background',
        detached: true,
        detachContext: { noteId: 'note-c' },
      },
    })

    expect(result).toBe('touched')
    expect(scope.getBinding('conv-4')?.noteId).toBe('note-a')
    expect(scope.getBinding('conv-4')?.lastUsedAtMs).toBe(1_700_000_000_000)
  })

  it('falls back to current note when background meta has no detached note', () => {
    const resolved = resolveNoteIdForConversationBinding('note-current', {
      source: 'background',
      detached: true,
      detachContext: { unrelated: true },
    })
    expect(resolved).toBe('note-current')
  })

  it('uses active stream owner note for active completion', () => {
    const resolved = resolveNoteIdForConversationBinding(
      'note-current',
      { source: 'active' },
      'note-owner'
    )
    expect(resolved).toBe('note-owner')
  })

  it('uses active stream owner note when meta is absent (old sdk path)', () => {
    const resolved = resolveNoteIdForConversationBinding(
      'note-current',
      undefined,
      'note-owner'
    )
    expect(resolved).toBe('note-owner')
  })

  it('uses previous note as detach owner when switching notes', () => {
    expect(resolveDetachNoteIdForSwitch('note-a', 'note-b')).toBe('note-a')
  })

  it('falls back to current note when no previous note exists', () => {
    expect(resolveDetachNoteIdForSwitch(undefined, 'note-a')).toBe('note-a')
  })

  it('apply binding uses active stream owner note when note already switched', () => {
    const scope = createNoteConversationScope({ storage: new MemoryStorage() })
    const result = applyNoteConversationBinding({
      scope,
      conversationId: 'conv-owner',
      currentNoteId: 'note-b',
      activeStreamOwnerNoteId: 'note-a',
      timestampMs: 1_700_000_000_000,
      meta: { source: 'active' },
    })

    expect(result).toBe('bound')
    expect(scope.getBinding('conv-owner')?.noteId).toBe('note-a')
  })
})
