/**
 * Content mutation logic for SDK update_note tool.
 *
 * Handles content/append/prepend/before/after/edit modes with
 * normalized fuzzy matching for Chinese/English punctuation.
 */

import { jsonToMarkdown, markdownToTiptapString, mergeDocumentsJson } from '../../markdown'

// --- String matching helpers ---

/**
 * Normalize quotes and punctuation for fuzzy matching.
 * Converts Chinese quotes to English quotes, etc.
 */
export function normalizeForMatching(str: string): string {
  return str
    .replace(/[\u201C\u201D]/g, '"')  // Chinese double quotes
    .replace(/[\u2018\u2019]/g, "'")  // Chinese single quotes
    .replace(/\uFF1A/g, ':')          // Chinese colon
    .replace(/\uFF1B/g, ';')          // Chinese semicolon
    .replace(/\uFF0C/g, ',')          // Chinese comma
}

function findOriginalMatch(content: string, normalizedContent: string, normalizedSearch: string): string {
  const index = normalizedContent.indexOf(normalizedSearch)
  if (index === -1) return ''
  // Since normalization is char-to-char (same length), index maps directly
  return content.slice(index, index + normalizedSearch.length)
}

/**
 * Multi-layer string matching for edit operations.
 * Layer 1: Exact match
 * Layer 2: Normalized match (quotes, punctuation)
 */
export function findWithNormalization(
  content: string,
  search: string
): {
  found: boolean
  matchedString: string
  normalizedMatch: boolean
  occurrences: number
} {
  // Layer 1: Exact match
  if (content.includes(search)) {
    const occurrences = content.split(search).length - 1
    return { found: true, matchedString: search, normalizedMatch: false, occurrences }
  }

  // Layer 2: Normalized match
  const normalizedContent = normalizeForMatching(content)
  const normalizedSearch = normalizeForMatching(search)

  if (normalizedContent.includes(normalizedSearch)) {
    const occurrences = normalizedContent.split(normalizedSearch).length - 1
    const matchedString = findOriginalMatch(content, normalizedContent, normalizedSearch)
    return { found: true, matchedString, normalizedMatch: true, occurrences }
  }

  return { found: false, matchedString: '', normalizedMatch: false, occurrences: 0 }
}

export function findSimilarContent(content: string, search: string, maxLength: number = 80): string | null {
  const searchStart = normalizeForMatching(search.slice(0, 30))
  const lines = content.split('\n')

  for (const line of lines) {
    if (normalizeForMatching(line).includes(searchStart)) {
      return line.length > maxLength ? line.slice(0, maxLength) + '...' : line
    }
  }

  const shortPrefix = normalizeForMatching(search.slice(0, 15))
  for (const line of lines) {
    if (normalizeForMatching(line).includes(shortPrefix)) {
      return line.length > maxLength ? line.slice(0, maxLength) + '...' : line
    }
  }

  return null
}

// --- Types ---

export interface NoteContentMutationArgs {
  content?: string
  append?: string
  prepend?: string
  after?: string
  before?: string
  edit?: {
    old_string: string
    new_string: string
    replace_all?: boolean
  }
}

export interface NoteContentMutationMessages {
  anchorNotFound: string
  editNotFound: string
  editSimilarFound: string
  editEmptyString: string
  editMultipleFound: string
}

// --- Main mutation function ---

export function buildUpdatedNoteContent(
  currentTiptapContent: string | null | undefined,
  mutation: NoteContentMutationArgs,
  messages: NoteContentMutationMessages
): {
  changed: boolean
  content?: string
  replacements?: number
  usedNormalizedEditMatch?: boolean
} {
  const defaultDoc = '{"type":"doc","content":[]}'
  const baseContent = currentTiptapContent || defaultDoc
  const { content, append, prepend, after, before, edit } = mutation

  // Helper: find node index containing anchor text
  const findAnchorIndex = (nodes: unknown[], anchor: string): number => {
    const normalizedAnchor = normalizeForMatching(anchor)
    for (let i = 0; i < nodes.length; i++) {
      const nodeMarkdown = jsonToMarkdown(JSON.stringify({ type: 'doc', content: [nodes[i]] }))
      if (normalizeForMatching(nodeMarkdown).includes(normalizedAnchor)) {
        return i
      }
    }
    return -1
  }

  if (content !== undefined) {
    const newDocJson = markdownToTiptapString(content)
    return {
      changed: true,
      content: mergeDocumentsJson(baseContent, newDocJson),
    }
  }

  if (append !== undefined) {
    try {
      const originalDoc = JSON.parse(baseContent)
      const appendDoc = JSON.parse(markdownToTiptapString(append))
      const appendContent = appendDoc.content || []
      const originalContent = originalDoc.content || []

      if (after) {
        const anchorIndex = findAnchorIndex(originalContent, after)
        if (anchorIndex === -1) {
          throw new Error(messages.anchorNotFound)
        }
        const mergedContent = [
          ...originalContent.slice(0, anchorIndex + 1),
          ...appendContent,
          ...originalContent.slice(anchorIndex + 1),
        ]
        return {
          changed: true,
          content: JSON.stringify({ type: 'doc', content: mergedContent }),
        }
      }

      return {
        changed: true,
        content: JSON.stringify({ type: 'doc', content: [...originalContent, ...appendContent] }),
      }
    } catch (error) {
      if (error instanceof Error && error.message === messages.anchorNotFound) {
        throw error
      }
      const currentMarkdown = jsonToMarkdown(baseContent).trim()
      const nextMarkdown = currentMarkdown ? `${currentMarkdown}\n\n${append}` : append
      return {
        changed: true,
        content: markdownToTiptapString(nextMarkdown),
      }
    }
  }

  if (prepend !== undefined) {
    try {
      const originalDoc = JSON.parse(baseContent)
      const prependDoc = JSON.parse(markdownToTiptapString(prepend))
      const prependContent = prependDoc.content || []
      const originalContent = originalDoc.content || []

      if (before) {
        const anchorIndex = findAnchorIndex(originalContent, before)
        if (anchorIndex === -1) {
          throw new Error(messages.anchorNotFound)
        }
        const mergedContent = [
          ...originalContent.slice(0, anchorIndex),
          ...prependContent,
          ...originalContent.slice(anchorIndex),
        ]
        return {
          changed: true,
          content: JSON.stringify({ type: 'doc', content: mergedContent }),
        }
      }

      return {
        changed: true,
        content: JSON.stringify({ type: 'doc', content: [...prependContent, ...originalContent] }),
      }
    } catch (error) {
      if (error instanceof Error && error.message === messages.anchorNotFound) {
        throw error
      }
      const currentMarkdown = jsonToMarkdown(baseContent).trim()
      const nextMarkdown = currentMarkdown ? `${prepend}\n\n${currentMarkdown}` : prepend
      return {
        changed: true,
        content: markdownToTiptapString(nextMarkdown),
      }
    }
  }

  if (edit !== undefined) {
    const currentMarkdown = jsonToMarkdown(baseContent)
    const { old_string, new_string, replace_all } = edit

    if (!old_string) {
      throw new Error(messages.editEmptyString)
    }

    const matchResult = findWithNormalization(currentMarkdown, old_string)
    if (!matchResult.found) {
      const similar = findSimilarContent(currentMarkdown, old_string)
      if (similar) {
        throw new Error(`${messages.editNotFound} ${messages.editSimilarFound}: "${similar}"`)
      }
      throw new Error(messages.editNotFound)
    }

    const { matchedString, normalizedMatch, occurrences } = matchResult
    if (occurrences > 1 && !replace_all) {
      throw new Error(messages.editMultipleFound.replace('{count}', String(occurrences)))
    }

    const nextMarkdown = replace_all
      ? currentMarkdown.split(matchedString).join(new_string)
      : currentMarkdown.replace(matchedString, new_string)
    const nextDocJson = markdownToTiptapString(nextMarkdown)

    return {
      changed: true,
      content: mergeDocumentsJson(baseContent, nextDocJson),
      replacements: replace_all ? occurrences : 1,
      usedNormalizedEditMatch: normalizedMatch,
    }
  }

  return { changed: false }
}
