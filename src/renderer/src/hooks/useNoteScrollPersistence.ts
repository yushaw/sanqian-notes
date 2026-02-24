import { useEffect, useRef, type RefObject } from 'react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import {
  getNoteScrollPositionKey,
  getSavedNoteScrollPosition,
  updateNoteScrollPosition,
  persistNoteScrollPositions,
} from '../utils/noteScrollStorage'

const NOTE_SCROLL_SAVE_DEBOUNCE_MS = 120
const NOTE_SCROLL_RESTORE_MAX_RETRIES = 8

interface NoteScrollTarget {
  type: 'heading' | 'block'
  value: string
}

interface UseNoteScrollPersistenceParams {
  editor: TiptapEditor | null
  noteId: string
  paneId?: string | null
  scrollTarget?: NoteScrollTarget | null
  contentRef: RefObject<HTMLDivElement>
}

/**
 * Persist and restore per-note scroll position for editor content.
 * - Restore on note switch (unless an explicit scroll target exists)
 * - Update in-memory cache on every scroll event
 * - Debounce localStorage persistence to reduce write frequency
 */
export function useNoteScrollPersistence({
  editor,
  noteId,
  paneId,
  scrollTarget,
  contentRef,
}: UseNoteScrollPersistenceParams): void {
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoreHandledNoteIdRef = useRef<string | null>(null)
  const restoreKey = getNoteScrollPositionKey(noteId, paneId)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const container = contentRef.current
    if (!container) return

    if (restoreHandledNoteIdRef.current === restoreKey) return

    // Explicit navigation target takes priority over last scroll position.
    if (scrollTarget) {
      restoreHandledNoteIdRef.current = restoreKey
      return
    }

    const savedScrollTop = getSavedNoteScrollPosition(noteId, paneId)
    if (savedScrollTop <= 0) {
      restoreHandledNoteIdRef.current = restoreKey
      return
    }

    let cancelled = false
    let frameId: number | null = null
    let retryCount = 0

    const restoreScroll = () => {
      if (cancelled) return
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
      const targetScrollTop = Math.min(savedScrollTop, maxScrollTop)
      container.scrollTop = targetScrollTop

      const restored = Math.abs(container.scrollTop - targetScrollTop) <= 1
      const layoutStillGrowing = maxScrollTop + 1 < savedScrollTop
      if ((layoutStillGrowing || !restored) && retryCount < NOTE_SCROLL_RESTORE_MAX_RETRIES) {
        retryCount += 1
        frameId = requestAnimationFrame(restoreScroll)
        return
      }
      restoreHandledNoteIdRef.current = restoreKey
    }

    frameId = requestAnimationFrame(restoreScroll)
    return () => {
      cancelled = true
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [contentRef, editor, noteId, paneId, restoreKey, scrollTarget])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const container = contentRef.current
    if (!container) return
    let hasScrollEvent = false

    const flushScrollPosition = () => {
      persistNoteScrollPositions()
    }

    const handleScroll = () => {
      hasScrollEvent = true
      updateNoteScrollPosition(noteId, container.scrollTop, paneId)
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current)
      }
      scrollSaveTimerRef.current = setTimeout(() => {
        scrollSaveTimerRef.current = null
        flushScrollPosition()
      }, NOTE_SCROLL_SAVE_DEBOUNCE_MS)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current)
        scrollSaveTimerRef.current = null
      }
      if (hasScrollEvent) {
        flushScrollPosition()
      }
    }
  }, [contentRef, editor, noteId, paneId])
}
