import { useEffect, useRef, type MutableRefObject } from 'react'
import { isLocalResourceId } from '../utils/localResourceId'
import type { CursorInfo } from '../utils/cursor'
import type { Note, SmartViewId } from '../types/note'

interface UseGlobalKeyboardShortcutsParams {
  // Latest-value refs (updated every render, stable identity)
  isTypewriterMode: boolean
  handleToggleTypewriter: (cursorInfo: CursorInfo) => void
  getCursorInfoFromEditor: () => CursorInfo
  handleCreateNote: () => void
  selectedSmartView: SmartViewId | null
  filteredNotes: Note[]
  tabFocusedNoteId: string | null
  isLocalEditorActive: boolean

  // Caller-owned refs (passed directly to avoid double-ref indirection)
  localOpenFileRef: MutableRefObject<{ notebookId: string; relativePath: string } | null>
  flushLocalFileSaveRef: MutableRefObject<() => Promise<void>>
  flushQueuedEditorUpdatesRef: MutableRefObject<(noteId: string | null, timeoutMs?: number) => Promise<boolean>>

  // Direct deps (used directly in handler, must be in dep array)
  createTab: () => void
  closeTab: (tabId: string) => void
  closePane: (paneId: string) => void
  splitPane: (direction: 'row' | 'column') => void
  focusedPaneId: string | null
  activeTabId: string | null
  tabCount: number
  activePaneCount: number

  // Setters
  setIsTypewriterMode: (value: boolean) => void
  setSelectedNoteIds: (ids: string[]) => void
  setAnchorNoteId: (id: string | null) => void
}

export function useGlobalKeyboardShortcuts(params: UseGlobalKeyboardShortcutsParams): void {
  const isTypewriterModeRef = useRef(params.isTypewriterMode)
  const handleToggleTypewriterRef = useRef(params.handleToggleTypewriter)
  const getCursorInfoFromEditorRef = useRef(params.getCursorInfoFromEditor)
  const handleCreateNoteRef = useRef(params.handleCreateNote)
  const selectedSmartViewRef = useRef(params.selectedSmartView)
  const filteredNotesRef = useRef(params.filteredNotes)
  const tabFocusedNoteIdRef = useRef(params.tabFocusedNoteId)
  const isLocalEditorActiveRef = useRef(params.isLocalEditorActive)

  isTypewriterModeRef.current = params.isTypewriterMode
  handleToggleTypewriterRef.current = params.handleToggleTypewriter
  getCursorInfoFromEditorRef.current = params.getCursorInfoFromEditor
  handleCreateNoteRef.current = params.handleCreateNote
  selectedSmartViewRef.current = params.selectedSmartView
  filteredNotesRef.current = params.filteredNotes
  tabFocusedNoteIdRef.current = params.tabFocusedNoteId
  isLocalEditorActiveRef.current = params.isLocalEditorActive

  const {
    localOpenFileRef, flushLocalFileSaveRef, flushQueuedEditorUpdatesRef,
    createTab, closeTab, closePane, splitPane,
    focusedPaneId, activeTabId, tabCount, activePaneCount,
    setIsTypewriterMode, setSelectedNoteIds, setAnchorNoteId,
  } = params

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Shift + T: Toggle typewriter mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
        e.preventDefault()
        if (!isTypewriterModeRef.current) {
          const cursorInfo = getCursorInfoFromEditorRef.current()
          handleToggleTypewriterRef.current(cursorInfo)
        } else {
          setIsTypewriterMode(false)
        }
      }
      // Cmd/Ctrl + T: New Tab
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 't') {
        e.preventDefault()
        createTab()
      }
      // Cmd/Ctrl + S: Force flush pending saves.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (isLocalEditorActiveRef.current && localOpenFileRef.current) {
          void flushLocalFileSaveRef.current()
          return
        }
        const focusedNoteId = tabFocusedNoteIdRef.current
        if (focusedNoteId) {
          void flushQueuedEditorUpdatesRef.current(focusedNoteId)
        }
        return
      }
      // Cmd/Ctrl + W: Close current pane/tab, or window if last tab with single pane
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'w') {
        e.preventDefault()
        const isLastTab = tabCount === 1
        const isSinglePane = activePaneCount <= 1

        if (isLastTab && isSinglePane) {
          window.electron.window.close()
        } else if (focusedPaneId) {
          closePane(focusedPaneId)
        } else if (activeTabId) {
          closeTab(activeTabId)
        }
      }
      // Cmd/Ctrl + \: Split vertical
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (isLocalEditorActiveRef.current) {
          return
        }
        if (tabFocusedNoteIdRef.current) {
          splitPane('row')
        }
      }
      // Cmd/Ctrl + Shift + \: Split horizontal
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '\\') {
        e.preventDefault()
        if (isLocalEditorActiveRef.current) {
          return
        }
        if (tabFocusedNoteIdRef.current) {
          splitPane('column')
        }
      }
      // Cmd/Ctrl + N: Create new note (not in trash view)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'n') {
        e.preventDefault()
        if (selectedSmartViewRef.current !== 'trash') {
          handleCreateNoteRef.current()
        }
      }
      // Cmd/Ctrl + A: Select all notes in current list (only when not in editor)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'a') {
        const activeEl = document.activeElement
        const isInEditor = activeEl?.closest('.bn-editor, .ProseMirror, [contenteditable="true"], input, textarea')
        if (!isInEditor && selectedSmartViewRef.current !== 'trash') {
          e.preventDefault()
          const allIds = filteredNotesRef.current
            .map((note) => note.id)
            .filter((id) => !isLocalResourceId(id))
          if (allIds.length > 0) {
            setSelectedNoteIds(allIds)
            setAnchorNoteId(allIds[0])
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [createTab, closeTab, closePane, focusedPaneId, activeTabId, tabCount, activePaneCount, splitPane, setIsTypewriterMode, setSelectedNoteIds, setAnchorNoteId])
}
