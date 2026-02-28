/**
 * Custom hook encapsulating the [[ note link popup state and logic.
 *
 * Owns: showLinkPopup, linkQuery, linkPopupPosition, linkStartPos,
 *       searchMode, selectedLinkNote, targetHeadings, targetBlocks
 *
 * Provides detectLinkTrigger() to be called from useEditor's onUpdate,
 * and all handler callbacks for user interactions with the popup.
 */

import { useState, useCallback } from 'react'
import type { useEditor } from '@tiptap/react'
import type { Note } from '../../types/note'
import type { SearchMode, HeadingInfo, BlockInfo } from '../NoteLinkPopup'
import { extractHeadingsFromJSON, extractBlocksFromJSON } from './editor-doc-utils'

export function useEditorLinkPopup({
  editor,
  notes,
  untitledLabel,
  onCreateNote,
}: {
  editor: ReturnType<typeof useEditor>
  notes: Note[]
  untitledLabel: string
  onCreateNote: (title: string) => Promise<Note>
}) {
  const [showLinkPopup, setShowLinkPopup] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const [linkPopupPosition, setLinkPopupPosition] = useState({ top: 0, left: 0 })
  const [linkStartPos, setLinkStartPos] = useState<number | null>(null)

  const [searchMode, setSearchMode] = useState<SearchMode>('note')
  const [selectedLinkNote, setSelectedLinkNote] = useState<Note | null>(null)
  const [targetHeadings, setTargetHeadings] = useState<HeadingInfo[]>([])
  const [targetBlocks, setTargetBlocks] = useState<BlockInfo[]>([])

  const handleHeadingSearch = useCallback((
    noteName: string,
    headingQuery: string,
    from: number,
    _lastOpenBracket: number,
    fullQuery: string
  ) => {
    const matchedNote = notes.find(n =>
      n.title.toLowerCase() === noteName.toLowerCase() ||
      n.title.toLowerCase().includes(noteName.toLowerCase())
    )

    if (matchedNote) {
      setSearchMode('heading')
      setSelectedLinkNote(matchedNote)
      setLinkQuery(headingQuery)
      setLinkStartPos(from - fullQuery.length - 2)

      try {
        const content = matchedNote.content
        if (content) {
          const parsed = JSON.parse(content)
          const headings = extractHeadingsFromJSON(parsed)
          setTargetHeadings(headings)
        }
      } catch {
        setTargetHeadings([])
      }
    } else {
      setSearchMode('note')
      setSelectedLinkNote(null)
      setLinkQuery(noteName)
      setLinkStartPos(from - fullQuery.length - 2)
    }
  }, [notes])

  const handleBlockSearch = useCallback((
    noteName: string,
    blockQuery: string,
    from: number,
    _lastOpenBracket: number,
    fullQuery: string
  ) => {
    const matchedNote = notes.find(n =>
      n.title.toLowerCase() === noteName.toLowerCase() ||
      n.title.toLowerCase().includes(noteName.toLowerCase())
    )

    if (matchedNote) {
      setSearchMode('block')
      setSelectedLinkNote(matchedNote)
      setLinkQuery(blockQuery)
      setLinkStartPos(from - fullQuery.length - 2)

      try {
        const content = matchedNote.content
        if (content) {
          const parsed = JSON.parse(content)
          const blocks = extractBlocksFromJSON(parsed)
          setTargetBlocks(blocks)
        }
      } catch {
        setTargetBlocks([])
      }
    } else {
      setSearchMode('note')
      setSelectedLinkNote(null)
      setLinkQuery(noteName)
      setLinkStartPos(from - fullQuery.length - 2)
    }
  }, [notes])

  /**
   * Called from useEditor's onUpdate to detect [[ trigger and manage popup state.
   */
  const detectLinkTrigger = useCallback((editorInstance: NonNullable<ReturnType<typeof useEditor>>) => {
    const { state } = editorInstance
    const { from } = state.selection
    const textBefore = state.doc.textBetween(Math.max(0, from - 100), from, '')

    const lastOpenBracket = textBefore.lastIndexOf('[[')
    const lastCloseBracket = textBefore.lastIndexOf(']]')

    if (lastOpenBracket > lastCloseBracket) {
      const query = textBefore.slice(lastOpenBracket + 2)

      const hashIndex = query.indexOf('#')
      const caretIndex = query.indexOf('^')

      if (hashIndex !== -1 && caretIndex !== -1 && caretIndex > hashIndex) {
        const noteName = query.slice(0, hashIndex)
        const blockQuery = query.slice(caretIndex + 1)
        handleBlockSearch(noteName, blockQuery, from, lastOpenBracket, query)
      } else if (caretIndex !== -1) {
        const noteName = query.slice(0, caretIndex)
        const blockQuery = query.slice(caretIndex + 1)
        handleBlockSearch(noteName, blockQuery, from, lastOpenBracket, query)
      } else if (hashIndex !== -1) {
        const noteName = query.slice(0, hashIndex)
        const headingQuery = query.slice(hashIndex + 1)
        handleHeadingSearch(noteName, headingQuery, from, lastOpenBracket, query)
      } else {
        setSearchMode('note')
        setSelectedLinkNote(null)
        setLinkQuery(query)
        setLinkStartPos(from - query.length - 2)
      }

      const coords = editorInstance.view.coordsAtPos(from)
      if (coords) {
        setLinkPopupPosition({
          top: coords.bottom + 8,
          left: coords.left,
        })
        setShowLinkPopup(true)
      }
    } else {
      setShowLinkPopup(false)
      setLinkQuery('')
      setLinkStartPos(null)
      setSearchMode('note')
      setSelectedLinkNote(null)
    }
  }, [handleHeadingSearch, handleBlockSearch])

  const handleSelectNoteLink = useCallback((
    selectedNote: Note,
    target?: { type: 'heading' | 'block'; value: string; displayText: string }
  ) => {
    if (!editor || linkStartPos === null) return

    const { from } = editor.state.selection
    const displayText = target?.displayText || selectedNote.title || untitledLabel
    const targetValue = target?.value

    editor
      .chain()
      .focus()
      .deleteRange({ from: linkStartPos, to: from })
      .setNoteLink({
        noteId: selectedNote.id,
        noteTitle: selectedNote.title || untitledLabel,
        targetType: target?.type || 'note',
        targetValue: targetValue,
      })
      .insertContent(displayText)
      .unsetNoteLink()
      .run()

    setShowLinkPopup(false)
    setLinkQuery('')
    setLinkStartPos(null)
    setSearchMode('note')
    setSelectedLinkNote(null)
  }, [editor, linkStartPos, untitledLabel])

  const handleSelectNoteForSubSearch = useCallback((selectedNote: Note) => {
    setSelectedLinkNote(selectedNote)
    setSearchMode('heading')
    setLinkQuery('')

    try {
      const content = selectedNote.content
      if (content) {
        const parsed = JSON.parse(content)
        const headings = extractHeadingsFromJSON(parsed)
        setTargetHeadings(headings)
        const blocks = extractBlocksFromJSON(parsed)
        setTargetBlocks(blocks)
      }
    } catch {
      setTargetHeadings([])
      setTargetBlocks([])
    }
  }, [])

  const handleCreateNoteLink = useCallback(async (title: string) => {
    if (!editor || linkStartPos === null) return

    try {
      const newNote = await onCreateNote(title)
      const { from } = editor.state.selection

      editor
        .chain()
        .focus()
        .deleteRange({ from: linkStartPos, to: from })
        .setNoteLink({ noteId: newNote.id, noteTitle: title })
        .insertContent(title)
        .unsetNoteLink()
        .run()
    } catch (error) {
      console.error('Failed to create note from link:', error)
      editor.commands.focus()
    } finally {
      setShowLinkPopup(false)
      setLinkQuery('')
      setLinkStartPos(null)
      setSearchMode('note')
      setSelectedLinkNote(null)
    }
  }, [editor, linkStartPos, onCreateNote])

  const handleCloseLinkPopup = useCallback(() => {
    setShowLinkPopup(false)
    setLinkQuery('')
    setLinkStartPos(null)
    setSearchMode('note')
    setSelectedLinkNote(null)
  }, [])

  const handleBackToNoteSearch = useCallback(() => {
    setSearchMode('note')
    setSelectedLinkNote(null)
    setLinkQuery('')
    setTargetHeadings([])
    setTargetBlocks([])
  }, [])

  return {
    showLinkPopup,
    linkQuery,
    setLinkQuery,
    linkPopupPosition,
    linkStartPos,
    searchMode,
    selectedLinkNote,
    targetHeadings,
    targetBlocks,
    detectLinkTrigger,
    handleSelectNoteLink,
    handleSelectNoteForSubSearch,
    handleCreateNoteLink,
    handleCloseLinkPopup,
    handleBackToNoteSearch,
  }
}
