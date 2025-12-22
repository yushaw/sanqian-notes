/**
 * Text Utility Functions
 */

/**
 * Safely truncate text without breaking multi-byte characters (emoji, CJK, etc.)
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @returns Truncated text with '...' if needed
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text

  // Truncate to max length first
  let truncated = text.slice(0, maxLength)

  // Check if we cut in the middle of a surrogate pair (emoji, some CJK characters)
  const lastCharCode = truncated.charCodeAt(truncated.length - 1)

  // High surrogate (0xD800-0xDBFF) - first part of emoji or rare CJK
  if (lastCharCode >= 0xD800 && lastCharCode <= 0xDBFF) {
    // Remove the orphaned high surrogate
    truncated = truncated.slice(0, -1)
  }

  return truncated + (text.length > maxLength ? '...' : '')
}
