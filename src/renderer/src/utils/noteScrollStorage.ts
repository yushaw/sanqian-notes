const NOTE_SCROLL_STORAGE_KEY = 'sanqian-notes-note-scroll-positions'
const NOTE_SCROLL_MAX_ENTRIES = 200
const NOTE_SCROLL_KEY_SEPARATOR = '::'

let noteScrollPositionCache: Map<string, number> | null = null

function isPaneScopedKey(key: string): boolean {
  return key.includes(NOTE_SCROLL_KEY_SEPARATOR)
}

function getPaneScopedNoteId(key: string): string | null {
  const separatorIndex = key.indexOf(NOTE_SCROLL_KEY_SEPARATOR)
  if (separatorIndex <= 0) return null
  return key.slice(0, separatorIndex)
}

function trimCacheToLimit(cache: Map<string, number>): boolean {
  let trimmed = false
  while (cache.size > NOTE_SCROLL_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) break
    cache.delete(oldestKey)
    trimmed = true
  }
  return trimmed
}

function serializeCache(cache: Map<string, number>): Record<string, number> {
  const serialized: Record<string, number> = {}
  cache.forEach((scrollTop, key) => {
    if (scrollTop > 0) {
      serialized[key] = scrollTop
    }
  })
  return serialized
}

function persistCache(cache: Map<string, number>): void {
  localStorage.setItem(NOTE_SCROLL_STORAGE_KEY, JSON.stringify(serializeCache(cache)))
}

function getCache(): Map<string, number> {
  if (noteScrollPositionCache) return noteScrollPositionCache

  const cache = new Map<string, number>()
  let shouldRewriteStorage = false
  try {
    const raw = localStorage.getItem(NOTE_SCROLL_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const validEntries: Array<[string, number]> = []
        const notesWithPaneScopedEntries = new Set<string>()

        Object.entries(parsed as Record<string, unknown>).forEach(([key, scrollTop]) => {
          if (!key || typeof scrollTop !== 'number' || !Number.isFinite(scrollTop) || scrollTop <= 0) {
            shouldRewriteStorage = true
            return
          }

          const normalizedScrollTop = Math.floor(scrollTop)
          if (normalizedScrollTop !== scrollTop) {
            shouldRewriteStorage = true
          }

          const paneScopedNoteId = getPaneScopedNoteId(key)
          if (paneScopedNoteId) {
            notesWithPaneScopedEntries.add(paneScopedNoteId)
          }
          validEntries.push([key, normalizedScrollTop])
        })

        validEntries.forEach(([key, scrollTop]) => {
          // If pane-scoped entries exist, drop legacy key to avoid stale fallback.
          if (!isPaneScopedKey(key) && notesWithPaneScopedEntries.has(key)) {
            shouldRewriteStorage = true
            return
          }
          cache.set(key, scrollTop)
        })

        if (trimCacheToLimit(cache)) {
          shouldRewriteStorage = true
        }
      } else {
        shouldRewriteStorage = true
      }
    }
  } catch {
    // Rewrite invalid local cache.
    shouldRewriteStorage = true
  }

  if (shouldRewriteStorage) {
    try {
      persistCache(cache)
    } catch {
      // ignore storage errors
    }
  }

  noteScrollPositionCache = cache
  return cache
}

export function persistNoteScrollPositions(): void {
  try {
    persistCache(getCache())
  } catch {
    // ignore storage errors
  }
}

export function getNoteScrollPositionKey(noteId: string, paneId?: string | null): string {
  return paneId ? `${noteId}${NOTE_SCROLL_KEY_SEPARATOR}${paneId}` : noteId
}

export function getSavedNoteScrollPosition(noteId: string, paneId?: string | null): number {
  const cache = getCache()

  // Pane-scoped value first, then legacy note-scoped value for backward compatibility.
  if (paneId) {
    const paneScoped = cache.get(getNoteScrollPositionKey(noteId, paneId))
    if (typeof paneScoped === 'number') return paneScoped
  }
  return cache.get(noteId) ?? 0
}

export function updateNoteScrollPosition(noteId: string, scrollTop: number, paneId?: string | null): void {
  const cache = getCache()
  const normalizedScrollTop = Math.max(0, Math.floor(scrollTop))
  const key = getNoteScrollPositionKey(noteId, paneId)

  // Once pane-scoped storage is active, drop stale legacy note-level value.
  if (paneId && key !== noteId) {
    cache.delete(noteId)
  }

  if (cache.has(key)) {
    cache.delete(key)
  }
  if (normalizedScrollTop > 0) {
    cache.set(key, normalizedScrollTop)
    trimCacheToLimit(cache)
  }
}

export function setAndPersistNoteScrollPosition(noteId: string, scrollTop: number, paneId?: string | null): void {
  updateNoteScrollPosition(noteId, scrollTop, paneId)
  persistNoteScrollPositions()
}
