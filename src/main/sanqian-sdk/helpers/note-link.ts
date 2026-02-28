/**
 * Note link generation and text utilities for SDK tool responses.
 */

export function generateNoteLink(noteId: string, heading?: string): string {
  const base = `sanqian-notes://note/${noteId}`
  if (heading) {
    return `${base}?heading=${encodeURIComponent(heading)}`
  }
  return base
}

/**
 * Safely truncate text without breaking multi-byte characters (emoji, CJK, etc.)
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text

  let truncated = text.slice(0, maxLength)
  const lastCharCode = truncated.charCodeAt(truncated.length - 1)

  if (lastCharCode >= 0xD800 && lastCharCode <= 0xDBFF) {
    truncated = truncated.slice(0, -1)
  }

  return truncated
}

export function sanitizeContextInlineText(text: string): string {
  return text
    .replace(/\r?\n+/g, ' ')
    .replace(/[<>]/g, (char) => (char === '<' ? '\uFF1C' : '\uFF1E'))
    .replace(/\s+/g, ' ')
    .trim()
}
