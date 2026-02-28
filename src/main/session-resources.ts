import { getAppSetting } from './database'
import { getClient } from './sanqian-sdk'
import { type CursorContext, getRawUserContext } from './user-context'
import { t } from './i18n'

interface SessionResourcesDeps {
  getChatPanel: () => { isVisible: () => boolean } | null
}

let chatPanelGetter: (() => { isVisible: () => boolean } | null) | null = null

/** Current selection resource ID (null if no selection pushed) */
let currentSelectionResourceId: string | null = null

/** Debounce timer for selection changes */
let selectionDebounceTimer: ReturnType<typeof setTimeout> | null = null

/** Previous selected text (for change detection) */
let previousSelectedText: string | null = null

/** Timestamp when pinned selection was last pushed (to prevent duplicate auto-push) */
let lastPinnedSelectionTime: number = 0

/** Cooldown period after pinned selection push to prevent duplicate auto-push (ms) */
const PINNED_SELECTION_COOLDOWN_MS = 1000

/** Throttle interval for repeated "SDK not connected" session-resource logs (ms) */
const SESSION_RESOURCE_SKIP_LOG_THROTTLE_MS = 10_000

/** Timestamp of last session-resource skip log */
let lastSessionResourceSkipLogAt = 0

/** Max content size for session resources (100KB) */
const MAX_RESOURCE_SIZE = 100 * 1024

/**
 * Truncate text to fit within byte size limit using binary search.
 * Uses Buffer.byteLength (zero-allocation) instead of TextEncoder.encode.
 */
function truncateText(text: string, maxSize: number = MAX_RESOURCE_SIZE): string {
  if (Buffer.byteLength(text, 'utf8') <= maxSize) return text

  // Binary search to find the right character length that fits within byte limit
  let low = 0
  let high = text.length
  const targetSize = Math.floor(maxSize * 0.9)

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= targetSize) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return text.slice(0, low) + '\n\n' + t().common.contentTruncated
}

/**
 * Setup SDK event listeners for session resources
 * Called after SDK is initialized
 */
export function setupSessionResourceListeners(): void {
  const client = getClient()
  if (!client) return

  // Listen for resourceRemoved events (e.g., when Chat clears resources after sending)
  client.on('resourceRemoved', (resourceId: string) => {
    console.log('[SessionResource] Resource removed by external:', resourceId)
    // Clear local state if our selection resource was removed
    if (currentSelectionResourceId === resourceId) {
      currentSelectionResourceId = null
      // Also reset previousSelectedText so next selection change will push again
      previousSelectedText = null
    }
  })

  // Listen for disconnected events to clean up state (resources may be lost on reconnect)
  client.on('disconnected', () => {
    console.log('[SessionResource] SDK disconnected, clearing resource state')
    currentSelectionResourceId = null
    previousSelectedText = null
  })
}

/**
 * Escape special characters for XML attribute values
 */
function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Format selection content for Session Resource
 */
function formatSelectionContent(
  selectedText: string,
  noteTitle: string | null,
  cursorContext: CursorContext | null
): string {
  const parts: string[] = []

  // Add note context
  if (noteTitle) {
    parts.push(`<note title="${escapeXmlAttr(noteTitle)}">`)
  }

  // Add section context if available
  if (cursorContext?.nearestHeading) {
    parts.push(`<section heading="${escapeXmlAttr(cursorContext.nearestHeading)}">`)
  }

  // Add selected text (escape XML special chars to prevent structure breakage)
  // Using CDATA would be cleaner but some LLMs handle escaped content better
  const escapedText = selectedText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  parts.push(`<selected_text>`)
  parts.push(escapedText)
  parts.push(`</selected_text>`)

  // Close tags
  if (cursorContext?.nearestHeading) {
    parts.push(`</section>`)
  }
  if (noteTitle) {
    parts.push(`</note>`)
  }

  return parts.join('\n')
}

function canUseSessionResourceClient(
  client: ReturnType<typeof getClient>,
  action: 'push selection' | 'remove selection' | 'push pinned selection'
): client is NonNullable<ReturnType<typeof getClient>> {
  if (client && client.isConnected()) return true

  const now = Date.now()
  if (now - lastSessionResourceSkipLogAt >= SESSION_RESOURCE_SKIP_LOG_THROTTLE_MS) {
    lastSessionResourceSkipLogAt = now
    console.log(`[SessionResource] Skip ${action}: Sanqian client not connected`)
  }
  return false
}

/**
 * Push or update selection as Session Resource
 */
export async function pushSelectionResource(): Promise<void> {
  const client = getClient()
  if (!canUseSessionResourceClient(client, 'push selection')) return

  // Skip if a pinned selection was just pushed (within cooldown period)
  // This prevents duplicate push when Ask AI triggers before Editor's debounce completes
  if (Date.now() - lastPinnedSelectionTime < PINNED_SELECTION_COOLDOWN_MS) {
    return
  }

  const ctx = getRawUserContext()
  const { selectedText, currentNoteTitle, cursorContext } = ctx
  if (!selectedText) return

  try {
    // Truncate if needed (100KB limit)
    const truncatedText = truncateText(selectedText)
    const content = formatSelectionContent(truncatedText, currentNoteTitle, cursorContext)

    // Show first 30 chars of selected text as title (replace newlines with spaces)
    const titlePreview = (selectedText.length > 30 ? selectedText.slice(0, 30) + '...' : selectedText)
      .replace(/[\r\n]+/g, ' ')
    const resource = await client.pushResource({
      id: 'editor-selection', // Fixed ID for single selection resource
      title: titlePreview,
      content,
      summary: currentNoteTitle || undefined, // Note title as tooltip
      icon: '\u{1F4DD}',
      type: 'selection',
    })

    currentSelectionResourceId = resource.fullId
    console.log('[SessionResource] Pushed selection:', currentSelectionResourceId)
  } catch (error) {
    console.warn('[SessionResource] Failed to push selection:', error)
  }
}

/**
 * Remove selection Session Resource
 */
export async function removeSelectionResource(): Promise<void> {
  if (!currentSelectionResourceId) return

  const client = getClient()
  if (!canUseSessionResourceClient(client, 'remove selection')) {
    // If disconnected, remote state is not trustworthy anymore.
    // Clear local tracking to avoid repeated remove attempts.
    currentSelectionResourceId = null
    return
  }

  try {
    await client.removeResource(currentSelectionResourceId)
    console.log('[SessionResource] Removed selection:', currentSelectionResourceId)
    currentSelectionResourceId = null
  } catch (error) {
    console.warn('[SessionResource] Failed to remove selection:', error)
  }
}

/**
 * Push pinned selection as Session Resource (for Ask AI action)
 * Uses unique ID so it accumulates and won't be auto-cleared
 */
export async function pushPinnedSelectionResource(): Promise<string | null> {
  const client = getClient()
  if (!canUseSessionResourceClient(client, 'push pinned selection')) return null

  // Clear pending selection debounce FIRST to prevent duplicate push after Ask AI
  // Must be before any early return!
  if (selectionDebounceTimer) {
    clearTimeout(selectionDebounceTimer)
    selectionDebounceTimer = null
  }

  const ctx2 = getRawUserContext()
  const { selectedText, currentNoteTitle, cursorContext } = ctx2
  if (!selectedText) return null

  try {
    // If there's an existing editor-selection with the same content, remove it first
    // to avoid duplicating the same selection
    if (currentSelectionResourceId) {
      await removeSelectionResource()
    }

    // Truncate if needed (100KB limit)
    const truncatedText = truncateText(selectedText)
    const content = formatSelectionContent(truncatedText, currentNoteTitle, cursorContext)

    // Use unique ID with timestamp so resources accumulate
    const uniqueId = `pinned-selection-${Date.now()}`
    // Show first 30 chars of selected text as title (replace newlines with spaces)
    const titlePreview = (selectedText.length > 30 ? selectedText.slice(0, 30) + '...' : selectedText)
      .replace(/[\r\n]+/g, ' ')
    const resource = await client.pushResource({
      id: uniqueId,
      title: titlePreview,
      content,
      summary: currentNoteTitle || undefined, // Note title as tooltip
      icon: '\u{1F4CC}', // Pin icon to distinguish from auto-tracked selection
      type: 'selection',
    })

    // Record timestamp to prevent duplicate auto-push
    lastPinnedSelectionTime = Date.now()
    console.log('[SessionResource] Pushed pinned selection:', resource.fullId)
    return resource.fullId
  } catch (error) {
    console.warn('[SessionResource] Failed to push pinned selection:', error)
    return null
  }
}

/**
 * Handle selection change with debounce
 * Only pushes when Chat is visible and setting is enabled
 */
export function handleSelectionChange(newSelectedText: string | null): void {
  // Skip if selection hasn't changed
  if (newSelectedText === previousSelectedText) return
  previousSelectedText = newSelectedText

  // Clear pending debounce
  if (selectionDebounceTimer) {
    clearTimeout(selectionDebounceTimer)
    selectionDebounceTimer = null
  }

  // Check if sync selection setting is enabled (default: true)
  const syncEnabled = getAppSetting('syncSelectionToChat') !== 'false'
  if (!syncEnabled) {
    // Setting disabled, just clear local state
    if (!newSelectedText) {
      currentSelectionResourceId = null
    }
    return
  }

  // Check if Chat is visible
  const isChatVisible = chatPanelGetter?.()?.isVisible() ?? false
  if (!isChatVisible) {
    // Chat not visible, just clear local state (don't call SDK as it may be disconnected)
    if (!newSelectedText) {
      currentSelectionResourceId = null
    }
    return
  }

  // If Sanqian SDK is currently disconnected, skip session-resource sync
  // and avoid timeout warnings on each selection update.
  const client = getClient()
  if (!client?.isConnected()) {
    if (!newSelectedText) {
      currentSelectionResourceId = null
    }
    return
  }

  // Debounce the push/remove
  selectionDebounceTimer = setTimeout(async () => {
    if (newSelectedText) {
      await pushSelectionResource()
    } else {
      await removeSelectionResource()
    }
  }, 300) // 300ms debounce
}

export function clearSessionResourceTimers(): void {
  if (selectionDebounceTimer) {
    clearTimeout(selectionDebounceTimer)
    selectionDebounceTimer = null
  }
}

export function initSessionResources(deps: SessionResourcesDeps): void {
  chatPanelGetter = deps.getChatPanel
}
