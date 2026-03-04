import { describe, expect, it } from 'vitest'
import { createNoteConversationScope } from '../noteConversationScope'

class MemoryStorage {
  private readonly map = new Map<string, string>()

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

describe('noteConversationScope', () => {
  it('returns latest conversation for note within 24h window', () => {
    const storage = new MemoryStorage()
    const nowMs = 1_700_000_000_000
    const scope = createNoteConversationScope({
      storage,
      now: () => nowMs,
    })

    scope.bindConversationToNote('conv-1', 'note-a', nowMs - 2_000)
    scope.bindConversationToNote('conv-2', 'note-a', nowMs - 1_000)
    scope.bindConversationToNote('conv-3', 'note-b', nowMs - 500)

    expect(scope.getLatestConversationForNote('note-a')).toBe('conv-2')
    expect(scope.getLatestConversationForNote('note-b')).toBe('conv-3')
  })

  it('ignores conversations older than 24h when selecting latest', () => {
    const storage = new MemoryStorage()
    const nowMs = 1_700_000_000_000
    const scope = createNoteConversationScope({
      storage,
      now: () => nowMs,
    })

    scope.bindConversationToNote('conv-old', 'note-a', nowMs - (25 * 60 * 60 * 1000))

    expect(scope.getLatestConversationForNote('note-a')).toBeNull()
  })

  it('keeps original note binding once conversation is bound', () => {
    const storage = new MemoryStorage()
    const nowMs = 1_700_000_000_000
    const scope = createNoteConversationScope({
      storage,
      now: () => nowMs,
    })

    scope.bindConversationToNote('conv-1', 'note-a', nowMs - 1000)
    scope.bindConversationToNote('conv-1', 'note-b', nowMs)

    expect(scope.getBinding('conv-1')?.noteId).toBe('note-a')
  })

  it('touch updates conversation recency', () => {
    const storage = new MemoryStorage()
    let nowMs = 1_700_000_000_000
    const scope = createNoteConversationScope({
      storage,
      now: () => nowMs,
    })

    scope.bindConversationToNote('conv-1', 'note-a', nowMs - 10_000)
    expect(scope.getLatestConversationForNote('note-a')).toBe('conv-1')

    nowMs += 2_000
    scope.touchConversation('conv-1', nowMs)
    expect(scope.getBinding('conv-1')?.lastUsedAtMs).toBe(nowMs)
  })

  it('removes conversation binding when deleted', () => {
    const storage = new MemoryStorage()
    const nowMs = 1_700_000_000_000
    const scope = createNoteConversationScope({
      storage,
      now: () => nowMs,
    })

    scope.bindConversationToNote('conv-1', 'note-a', nowMs)
    scope.removeConversation('conv-1')

    expect(scope.getBinding('conv-1')).toBeNull()
    expect(scope.getRelatedConversationIds('note-a')).toEqual([])
  })
})
