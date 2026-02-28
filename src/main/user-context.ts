import type { AgentExecutionContext } from '../shared/types'
import { isLocalResourceUidRef, parseLocalResourceId } from '../shared/local-resource-id'
import {
  getLocalNoteIdentityByPath,
  getLocalNoteIdentityByUid,
} from './database'

export interface CursorContext {
  nearestHeading: string | null
  currentParagraph: string | null
}

export interface UserContext {
  currentNotebookId: string | null
  currentNotebookName: string | null
  currentNoteId: string | null
  currentNoteTitle: string | null
  /** Block ID where cursor is located */
  currentBlockId: string | null
  /** Selected text (if any) */
  selectedText: string | null
  /** Cursor context with heading and paragraph info */
  cursorContext: CursorContext | null
}

let userContext: UserContext = {
  currentNotebookId: null,
  currentNotebookName: null,
  currentNoteId: null,
  currentNoteTitle: null,
  currentBlockId: null,
  selectedText: null,
  cursorContext: null,
}

/**
 * Get user context formatted for LLM (always in English, concise but with IDs)
 */
export function getUserContext(): { context: string } {
  const { currentNotebookId, currentNotebookName, currentNoteId, currentNoteTitle, cursorContext } = userContext
  const parts: string[] = []

  if (currentNotebookId && currentNotebookName) {
    parts.push(`In notebook "${currentNotebookName}" (ID: ${currentNotebookId})`)
  } else {
    parts.push('Viewing all notes')
  }

  if (currentNoteId && currentNoteTitle) {
    parts.push(`editing "${currentNoteTitle}" (ID: ${currentNoteId})`)
  }

  // Add cursor context if available
  if (cursorContext) {
    if (cursorContext.nearestHeading) {
      parts.push(`under section "${cursorContext.nearestHeading}"`)
    }
    if (cursorContext.currentParagraph) {
      // Truncate long paragraphs
      const para = cursorContext.currentParagraph.length > 100
        ? cursorContext.currentParagraph.slice(0, 100) + '...'
        : cursorContext.currentParagraph
      parts.push(`at paragraph: "${para}"`)
    }
  }

  return { context: parts.join(', ') + '.' }
}

/**
 * Build execution context for agent tasks (concise, structured).
 */
export function buildAgentExecutionContext(context?: AgentExecutionContext | null): string | null {
  const fallback: AgentExecutionContext = {
    sourceApp: 'sanqian-notes',
    noteId: userContext.currentNoteId,
    noteTitle: userContext.currentNoteTitle,
    notebookId: userContext.currentNotebookId,
    notebookName: userContext.currentNotebookName,
    heading: userContext.cursorContext?.nearestHeading ?? null,
  }
  const resolved = context ?? fallback
  const inferredLocalRef = resolved.localResourceId
    ? parseLocalResourceId(resolved.localResourceId)
    : (resolved.noteId ? parseLocalResourceId(resolved.noteId) : null)
  const inferredLocalIdentityByUid = (!inferredLocalRef && resolved.noteId)
    ? getLocalNoteIdentityByUid({ note_uid: resolved.noteId })
    : null
  const inferredLocalRelativePath = inferredLocalRef
    ? (
      isLocalResourceUidRef(inferredLocalRef) && inferredLocalRef.noteUid
        ? (getLocalNoteIdentityByUid({
          note_uid: inferredLocalRef.noteUid,
          notebook_id: inferredLocalRef.notebookId,
        })?.relative_path || null)
        : (inferredLocalRef.relativePath || null)
    )
    : (inferredLocalIdentityByUid?.relative_path || null)
  const resolvedSourceType = resolved.sourceType
    ?? (resolved.noteId
      ? (inferredLocalRef || inferredLocalIdentityByUid ? 'local-folder' : 'internal')
      : undefined)
  const inferredCanonicalLocalResourceId = (() => {
    if (resolved.localResourceId) {
      const parsedLocalResourceId = parseLocalResourceId(resolved.localResourceId)
      if (!parsedLocalResourceId) {
        return resolved.localResourceId
      }
      if (isLocalResourceUidRef(parsedLocalResourceId) && parsedLocalResourceId.noteUid) {
        return parsedLocalResourceId.noteUid
      }
      const resolvedPath = parsedLocalResourceId.relativePath || null
      if (!resolvedPath) {
        return resolved.localResourceId
      }
      const identity = getLocalNoteIdentityByPath({
        notebook_id: parsedLocalResourceId.notebookId,
        relative_path: resolvedPath,
      })
      return identity?.note_uid || resolved.localResourceId
    }
    if (!resolved.noteId) return null
    if (inferredLocalIdentityByUid) return inferredLocalIdentityByUid.note_uid
    if (!inferredLocalRef) return null
    if (isLocalResourceUidRef(inferredLocalRef) && inferredLocalRef.noteUid) {
      return inferredLocalRef.noteUid
    }
    const inferredPath = inferredLocalRelativePath
    if (!inferredPath) return resolved.noteId
    const identity = getLocalNoteIdentityByPath({
      notebook_id: inferredLocalRef.notebookId,
      relative_path: inferredPath,
    })
    return identity?.note_uid || resolved.noteId
  })()
  const resolvedLocalResourceId = inferredCanonicalLocalResourceId
  const resolvedLocalRelativePath = resolved.localRelativePath
    ?? inferredLocalRelativePath
    ?? null
  const noteIdForDisplay = resolvedSourceType === 'local-folder'
    ? (resolvedLocalResourceId || resolved.noteId || null)
    : (resolved.noteId || null)
  const parts: string[] = []

  const sourceApp = resolved.sourceApp || 'sanqian-notes'
  parts.push(`source_app: ${sourceApp}`)

  if (resolved.noteTitle) {
    const noteIdSuffix = noteIdForDisplay ? ` (ID: ${noteIdForDisplay})` : ''
    parts.push(`note: "${resolved.noteTitle}"${noteIdSuffix}`)
  }

  if (resolved.notebookName) {
    const notebookIdSuffix = resolved.notebookId ? ` (ID: ${resolved.notebookId})` : ''
    parts.push(`notebook: "${resolved.notebookName}"${notebookIdSuffix}`)
  }

  if (resolvedSourceType) {
    parts.push(`note_source_type: ${resolvedSourceType}`)
  }

  if (resolvedLocalResourceId) {
    parts.push(`local_resource_id: ${resolvedLocalResourceId}`)
  }

  if (resolvedLocalRelativePath) {
    parts.push(`local_relative_path: ${resolvedLocalRelativePath}`)
  }

  if (resolved.heading) {
    parts.push(`heading: "${resolved.heading}"`)
  }

  parts.push('This context is for your awareness. Do not mention it unless directly relevant to the user\'s request.')

  return parts.join('\n')
}

/**
 * Set user context from renderer
 */
export function setUserContext(context: Partial<UserContext>): void {
  userContext = { ...userContext, ...context }
}

/**
 * Get raw user context (for context provider)
 */
export function getRawUserContext(): UserContext {
  return { ...userContext }
}
