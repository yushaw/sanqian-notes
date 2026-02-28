export interface AIPopupMarkerAttrs {
  popupId: string
  createdAt?: number | null
}

const COMMENT_JSON_MARKER_RE = /^<!--\s*SQN_AI_POPUP\s+([\s\S]+?)\s*-->$/i
const COMMENT_ATTR_MARKER_RE = /^<!--\s*SQN_AI_POPUP\b([\s\S]*?)-->$/i
const SPAN_MARKER_RE = /^<span\b([^>]*)>/i
const ATTRIBUTE_RE = /([a-zA-Z_:][a-zA-Z0-9_:\-.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g

function normalizePopupId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > 512) return null
  return normalized
}

function normalizeCreatedAt(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    const normalized = Math.trunc(value)
    return normalized >= 0 ? normalized : undefined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const parsed = Number.parseInt(trimmed, 10)
    if (!Number.isFinite(parsed)) return undefined
    return parsed >= 0 ? parsed : undefined
  }
  return undefined
}

function parseAttributes(input: string): Map<string, string> {
  const map = new Map<string, string>()
  let match: RegExpExecArray | null
  ATTRIBUTE_RE.lastIndex = 0
  while ((match = ATTRIBUTE_RE.exec(input)) !== null) {
    const key = match[1].toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    map.set(key, value)
  }
  return map
}

function parseFromCommentPayload(payload: string): AIPopupMarkerAttrs | null {
  const trimmed = payload.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as {
      popupId?: unknown
      popup_id?: unknown
      createdAt?: unknown
      created_at?: unknown
    }
    const popupId = normalizePopupId(parsed.popupId ?? parsed.popup_id)
    if (!popupId) return null
    const createdAt = normalizeCreatedAt(parsed.createdAt ?? parsed.created_at)
    return createdAt === undefined ? { popupId } : { popupId, createdAt }
  } catch {
    // Fallback to key-value style markers for compatibility.
  }

  const attrs = parseAttributes(trimmed)
  const popupId = normalizePopupId(
    attrs.get('popup-id')
    ?? attrs.get('popup_id')
    ?? attrs.get('data-popup-id')
    ?? attrs.get('popupid')
  )
  if (!popupId) return null
  const createdAt = normalizeCreatedAt(
    attrs.get('created-at')
    ?? attrs.get('created_at')
    ?? attrs.get('data-created-at')
    ?? attrs.get('createdat')
  )
  return createdAt === undefined ? { popupId } : { popupId, createdAt }
}

export function parseAIPopupMarkerFromHtml(rawHtml: string | null | undefined): AIPopupMarkerAttrs | null {
  if (typeof rawHtml !== 'string') return null
  const html = rawHtml.trim()
  if (!html) return null

  const commentJsonMatch = html.match(COMMENT_JSON_MARKER_RE)
  if (commentJsonMatch) {
    return parseFromCommentPayload(commentJsonMatch[1])
  }

  const commentAttrMatch = html.match(COMMENT_ATTR_MARKER_RE)
  if (commentAttrMatch) {
    return parseFromCommentPayload(commentAttrMatch[1])
  }

  const spanMatch = html.match(SPAN_MARKER_RE)
  if (!spanMatch) return null
  const spanAttrsRaw = spanMatch[1] || ''
  if (!/\bdata-ai-popup-mark\b/i.test(spanAttrsRaw)) return null

  const attrs = parseAttributes(spanAttrsRaw)
  const popupId = normalizePopupId(attrs.get('data-popup-id') ?? attrs.get('popup-id') ?? attrs.get('popup_id'))
  if (!popupId) return null
  const createdAt = normalizeCreatedAt(attrs.get('data-created-at') ?? attrs.get('created-at') ?? attrs.get('created_at'))
  return createdAt === undefined ? { popupId } : { popupId, createdAt }
}

export function formatAIPopupMarkerComment(input: AIPopupMarkerAttrs): string {
  const popupId = normalizePopupId(input.popupId)
  if (!popupId) return ''

  const payload: { popupId: string; createdAt?: number } = { popupId }
  const createdAt = normalizeCreatedAt(input.createdAt)
  if (createdAt !== undefined) {
    payload.createdAt = createdAt
  }

  return `<!-- SQN_AI_POPUP ${JSON.stringify(payload)} -->`
}
