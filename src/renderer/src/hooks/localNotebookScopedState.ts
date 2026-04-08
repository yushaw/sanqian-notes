interface PruneNotebookScopedMapOptions<T> {
  resolveNotebookId?: (key: string) => string | null
  onPrune?: (value: T, key: string) => void
}

export type LocalStatusToastKeyType = 'status' | 'search' | 'search_refresh'

interface ParsedLocalStatusToastKey {
  notebookId: string
  type: LocalStatusToastKeyType
}

const LOCAL_STATUS_TOAST_KEY_V1 = 'local_status_toast_v1'

function toStructuredLocalStatusToastKey(parts: readonly string[]): string {
  return JSON.stringify([LOCAL_STATUS_TOAST_KEY_V1, ...parts])
}

export function buildNotebookStatusToastKey(notebookId: string, status: string): string {
  return toStructuredLocalStatusToastKey([notebookId, 'status', status])
}

export function buildLocalSearchStatusToastKey(
  notebookId: string,
  scannedAt: string,
  errorCode: string
): string {
  return toStructuredLocalStatusToastKey([notebookId, 'search', scannedAt, errorCode])
}

export function buildLocalSearchRefreshToastKey(
  notebookId: string,
  errorCode: string
): string {
  return toStructuredLocalStatusToastKey([notebookId, 'search_refresh', errorCode])
}

export function parseLocalStatusToastKey(key: string): ParsedLocalStatusToastKey | null {
  try {
    const parsed = JSON.parse(key)
    if (!Array.isArray(parsed)) {
      return null
    }
    if (parsed[0] !== LOCAL_STATUS_TOAST_KEY_V1) {
      return null
    }
    const notebookId = typeof parsed[1] === 'string' ? parsed[1] : null
    const type = typeof parsed[2] === 'string' ? parsed[2] : null
    if (!notebookId) {
      return null
    }
    if (type !== 'status' && type !== 'search' && type !== 'search_refresh') {
      return null
    }
    return {
      notebookId,
      type,
    }
  } catch {
    // Fall through to legacy parser below.
  }

  const separatorIndex = key.lastIndexOf(':')
  if (separatorIndex <= 0) return null
  const notebookId = key.slice(0, separatorIndex)
  const suffix = key.slice(separatorIndex + 1)
  if (suffix.startsWith('search-refresh-')) {
    return { notebookId, type: 'search_refresh' }
  }
  if (suffix.startsWith('search-')) {
    return { notebookId, type: 'search' }
  }
  return { notebookId, type: 'status' }
}

export function pruneNotebookScopedRecord<T>(
  prev: Record<string, T>,
  localNotebookIds: Set<string>
): Record<string, T> {
  let changed = false
  const next: Record<string, T> = {}
  for (const [notebookId, value] of Object.entries(prev)) {
    if (!localNotebookIds.has(notebookId)) {
      changed = true
      continue
    }
    next[notebookId] = value
  }
  return changed ? next : prev
}

export function removeNotebookScopedRecordKey<T>(
  prev: Record<string, T>,
  notebookId: string
): Record<string, T> {
  if (!(notebookId in prev)) return prev
  const next = { ...prev }
  delete next[notebookId]
  return next
}

export function pruneNotebookScopedMap<T>(
  map: Map<string, T>,
  localNotebookIds: Set<string>,
  options?: PruneNotebookScopedMapOptions<T>
): void {
  const resolveNotebookId = options?.resolveNotebookId
  for (const [key, value] of Array.from(map.entries())) {
    const notebookId = resolveNotebookId ? resolveNotebookId(key) : key
    if (notebookId && localNotebookIds.has(notebookId)) continue
    options?.onPrune?.(value, key)
    map.delete(key)
  }
}

export function resolveNotebookIdFromStatusToastKey(key: string): string | null {
  return parseLocalStatusToastKey(key)?.notebookId ?? null
}

export function clearStatusToastEntriesByNotebookId(
  map: Map<string, number>,
  notebookId: string
): void {
  for (const key of Array.from(map.keys())) {
    if (resolveNotebookIdFromStatusToastKey(key) === notebookId) {
      map.delete(key)
    }
  }
}
