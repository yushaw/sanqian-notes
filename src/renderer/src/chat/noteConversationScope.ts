export interface NoteConversationBinding {
  conversationId: string
  noteId: string
  boundAtMs: number
  lastUsedAtMs: number
}

interface ScopeState {
  version: 1
  records: Record<string, NoteConversationBinding>
}

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export interface NoteConversationScopeOptions {
  storage?: StorageLike | null
  storageKey?: string
  maxAgeMs?: number
  maxRecords?: number
  now?: () => number
}

export interface GetLatestConversationOptions {
  nowMs?: number
  withinMs?: number
}

export interface NoteConversationScope {
  bindConversationToNote: (conversationId: string, noteId: string, timestampMs?: number) => void
  touchConversation: (conversationId: string, timestampMs?: number) => void
  removeConversation: (conversationId: string) => void
  getLatestConversationForNote: (noteId: string, options?: GetLatestConversationOptions) => string | null
  getRelatedConversationIds: (noteId: string) => string[]
  isConversationRelatedToNote: (conversationId: string, noteId: string) => boolean
  getBinding: (conversationId: string) => NoteConversationBinding | null
}

const DEFAULT_STORAGE_KEY = 'chat.noteConversationScope.v1'
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_RECORDS = 2000
const DEFAULT_SCOPE_WINDOW_MS = 24 * 60 * 60 * 1000

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function createDefaultState(): ScopeState {
  return { version: 1, records: {} }
}

function safeParseState(raw: string | null): ScopeState {
  if (!raw) return createDefaultState()
  try {
    const parsed = JSON.parse(raw) as Partial<ScopeState>
    if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== 'object') {
      return createDefaultState()
    }
    const sanitizedRecords: Record<string, NoteConversationBinding> = {}
    for (const [conversationId, value] of Object.entries(parsed.records)) {
      if (!value || typeof value !== 'object') continue
      const noteId = (value as Partial<NoteConversationBinding>).noteId
      const boundAtMs = Number((value as Partial<NoteConversationBinding>).boundAtMs)
      const lastUsedAtMs = Number((value as Partial<NoteConversationBinding>).lastUsedAtMs)
      if (!conversationId || !noteId) continue
      if (!Number.isFinite(boundAtMs) || !Number.isFinite(lastUsedAtMs)) continue
      sanitizedRecords[conversationId] = {
        conversationId,
        noteId,
        boundAtMs,
        lastUsedAtMs,
      }
    }
    return { version: 1, records: sanitizedRecords }
  } catch {
    return createDefaultState()
  }
}

export function createNoteConversationScope(
  options: NoteConversationScopeOptions = {}
): NoteConversationScope {
  const storage = options.storage ?? getDefaultStorage()
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  const now = options.now ?? (() => Date.now())

  let state = safeParseState(storage?.getItem(storageKey) ?? null)

  const persist = (): void => {
    if (!storage) return
    try {
      storage.setItem(storageKey, JSON.stringify(state))
    } catch {
      // Ignore localStorage quota/private mode errors.
    }
  }

  const prune = (timestampMs: number): void => {
    const threshold = timestampMs - maxAgeMs
    const filtered: Record<string, NoteConversationBinding> = {}
    for (const [conversationId, record] of Object.entries(state.records)) {
      if (record.lastUsedAtMs >= threshold) {
        filtered[conversationId] = record
      }
    }

    const records = Object.values(filtered)
    if (records.length > maxRecords) {
      records.sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs)
      const limited = records.slice(0, maxRecords)
      const limitedMap: Record<string, NoteConversationBinding> = {}
      for (const record of limited) {
        limitedMap[record.conversationId] = record
      }
      state = { version: 1, records: limitedMap }
      return
    }

    state = { version: 1, records: filtered }
  }

  const mutate = (timestampMs: number, mutator: () => void): void => {
    mutator()
    prune(timestampMs)
    persist()
  }

  return {
    bindConversationToNote: (conversationId, noteId, timestampMs) => {
      if (!conversationId || !noteId) return
      const ts = timestampMs ?? now()
      mutate(ts, () => {
        const existing = state.records[conversationId]
        if (!existing) {
          state.records[conversationId] = {
            conversationId,
            noteId,
            boundAtMs: ts,
            lastUsedAtMs: ts,
          }
          return
        }
        // Keep the original note binding once established.
        state.records[conversationId] = {
          ...existing,
          lastUsedAtMs: Math.max(existing.lastUsedAtMs, ts),
        }
      })
    },

    touchConversation: (conversationId, timestampMs) => {
      if (!conversationId) return
      const existing = state.records[conversationId]
      if (!existing) return
      const ts = timestampMs ?? now()
      mutate(ts, () => {
        const current = state.records[conversationId]
        if (!current) return
        state.records[conversationId] = {
          ...current,
          lastUsedAtMs: Math.max(current.lastUsedAtMs, ts),
        }
      })
    },

    removeConversation: (conversationId) => {
      if (!conversationId) return
      const existing = state.records[conversationId]
      if (!existing) return
      const ts = now()
      mutate(ts, () => {
        delete state.records[conversationId]
      })
    },

    getLatestConversationForNote: (noteId, optionsArg) => {
      if (!noteId) return null
      const nowMs = optionsArg?.nowMs ?? now()
      const withinMs = optionsArg?.withinMs ?? DEFAULT_SCOPE_WINDOW_MS
      const threshold = nowMs - withinMs
      let latest: NoteConversationBinding | null = null
      for (const record of Object.values(state.records)) {
        if (record.noteId !== noteId) continue
        if (record.lastUsedAtMs < threshold) continue
        if (!latest || record.lastUsedAtMs > latest.lastUsedAtMs) {
          latest = record
        }
      }
      return latest?.conversationId ?? null
    },

    getRelatedConversationIds: (noteId) => {
      if (!noteId) return []
      return Object.values(state.records)
        .filter((record) => record.noteId === noteId)
        .sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs)
        .map((record) => record.conversationId)
    },

    isConversationRelatedToNote: (conversationId, noteId) => {
      if (!conversationId || !noteId) return false
      return state.records[conversationId]?.noteId === noteId
    },

    getBinding: (conversationId) => {
      if (!conversationId) return null
      return state.records[conversationId] ?? null
    },
  }
}
