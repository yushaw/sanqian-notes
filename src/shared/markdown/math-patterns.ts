/**
 * Shared inline math regex patterns.
 *
 * Following KaTeX/Obsidian convention:
 * - Opening $ must be followed by a non-whitespace character
 * - Closing $ must be preceded by a non-whitespace character
 * - Content cannot span multiple lines
 * - Single-character math like $x$ is supported
 *
 * This prevents "$50 and $E=mc^2$" from incorrectly treating "$50 and $" as math.
 */

/**
 * Core capture pattern for the content between $ delimiters (without the $ themselves).
 * Use inside a regex with surrounding \$ anchors.
 *
 * Matches: E=mc^2, x, a + b, \int_0^1 f(x) dx
 * Rejects: (space)text, text(space), empty
 */
export const INLINE_MATH_CONTENT = String.raw`[^\s$](?:[^$\n]*[^\s$])?`

/**
 * Full inline math pattern: $content$
 * Global flag for use with replace/matchAll.
 */
export const INLINE_MATH_RE = new RegExp(
  String.raw`\$(${INLINE_MATH_CONTENT})\$`,
  'g'
)

/**
 * Full inline math pattern with $$ lookaround guards (for paste handling).
 * Prevents matching $$ block math delimiters.
 */
export const INLINE_MATH_GUARDED_RE = new RegExp(
  String.raw`(?<!\$)\$(?!\$)(${INLINE_MATH_CONTENT})\$(?!\$)`,
  'g'
)

/**
 * Detection-only pattern (no capture group, no global flag).
 * For use in "does this text contain inline math?" checks.
 */
export const INLINE_MATH_DETECT_RE = new RegExp(
  String.raw`(?<!\$)\$(?!\$)${INLINE_MATH_CONTENT}\$(?!\$)`
)
