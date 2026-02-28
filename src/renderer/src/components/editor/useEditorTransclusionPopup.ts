/**
 * Custom hook encapsulating the transclusion popup state and logic.
 *
 * Owns: showTransclusionPopup, transclusionSearchMode, selectedTransclusionNote,
 *       transclusionHeadings, transclusionBlocks, transclusionQuery, transclusionEditCallback
 *
 * Manages: transclusion:select and transclusion:edit window event listeners.
 */

import { useState, useCallback, useEffect } from 'react'
import type { useEditor } from '@tiptap/react'
import type { Note } from '../../types/note'
import type { SearchMode, HeadingInfo, BlockInfo } from '../NoteLinkPopup'
import { extractHeadingsFromJSON, extractBlocksFromJSON } from './editor-doc-utils'

export function useEditorTransclusionPopup({
  editor,
  untitledLabel,
}: {
  editor: ReturnType<typeof useEditor>
  untitledLabel: string
}) {
  const [showTransclusionPopup, setShowTransclusionPopup] = useState(false)
  const [transclusionSearchMode, setTransclusionSearchMode] = useState<SearchMode>('note')
  const [selectedTransclusionNote, setSelectedTransclusionNote] = useState<Note | null>(null)
  const [transclusionHeadings, setTransclusionHeadings] = useState<HeadingInfo[]>([])
  const [transclusionBlocks, setTransclusionBlocks] = useState<BlockInfo[]>([])
  const [transclusionQuery, setTransclusionQuery] = useState('')
  const [transclusionEditCallback, setTransclusionEditCallback] = useState<((attrs: Record<string, unknown>) => void) | null>(null)

  // Listen for transclusion:select event from SlashCommand
  useEffect(() => {
    const handleTransclusionSelect = () => {
      setShowTransclusionPopup(true)
      setTransclusionSearchMode('note')
      setSelectedTransclusionNote(null)
      setTransclusionQuery('')
      setTransclusionEditCallback(null) // 新建模式
    }

    window.addEventListener('transclusion:select', handleTransclusionSelect)
    return () => {
      window.removeEventListener('transclusion:select', handleTransclusionSelect)
    }
  }, [])

  // Listen for transclusion:edit event from TransclusionView
  useEffect(() => {
    const handleTransclusionEdit = (e: CustomEvent<{ updateAttributes: (attrs: Record<string, unknown>) => void }>) => {
      setShowTransclusionPopup(true)
      setTransclusionSearchMode('note')
      setSelectedTransclusionNote(null)
      setTransclusionQuery('')
      setTransclusionEditCallback(() => e.detail.updateAttributes) // 编辑模式
    }

    window.addEventListener('transclusion:edit', handleTransclusionEdit as EventListener)
    return () => {
      window.removeEventListener('transclusion:edit', handleTransclusionEdit as EventListener)
    }
  }, [])

  const handleSelectTransclusion = useCallback((
    selectedNote: Note,
    target?: { type: 'heading' | 'block'; value: string; displayText: string }
  ) => {
    const attrs = {
      noteId: selectedNote.id,
      noteName: selectedNote.title || untitledLabel,
      targetType: (target?.type || 'note') as 'note' | 'heading' | 'block',
      targetValue: target?.value,
    }

    if (transclusionEditCallback) {
      // 编辑模式：更新现有 block
      transclusionEditCallback(attrs)
    } else if (editor) {
      // 新建模式：插入新 block
      editor.chain().focus().setTransclusion(attrs).run()
    }

    setShowTransclusionPopup(false)
    setTransclusionQuery('')
    setTransclusionSearchMode('note')
    setSelectedTransclusionNote(null)
    setTransclusionEditCallback(null)
  }, [editor, untitledLabel, transclusionEditCallback])

  const handleSelectNoteForSubSearch = useCallback((selectedNote: Note) => {
    setSelectedTransclusionNote(selectedNote)
    setTransclusionSearchMode('heading')
    setTransclusionQuery('')

    try {
      const content = selectedNote.content
      if (content) {
        const parsed = JSON.parse(content)
        const headings = extractHeadingsFromJSON(parsed)
        setTransclusionHeadings(headings)
        const blocks = extractBlocksFromJSON(parsed)
        setTransclusionBlocks(blocks)
      }
    } catch {
      setTransclusionHeadings([])
      setTransclusionBlocks([])
    }
  }, [])

  const handleCloseTransclusionPopup = useCallback(() => {
    setShowTransclusionPopup(false)
    setTransclusionQuery('')
    setTransclusionSearchMode('note')
    setSelectedTransclusionNote(null)
    setTransclusionHeadings([])
    setTransclusionBlocks([])
    setTransclusionEditCallback(null)
  }, [])

  const handleBackToNoteSearch = useCallback(() => {
    setTransclusionSearchMode('note')
    setSelectedTransclusionNote(null)
    setTransclusionQuery('')
    setTransclusionHeadings([])
    setTransclusionBlocks([])
  }, [])

  return {
    showTransclusionPopup,
    transclusionSearchMode,
    selectedTransclusionNote,
    transclusionHeadings,
    transclusionBlocks,
    transclusionQuery,
    setTransclusionQuery,
    handleSelectTransclusion,
    handleSelectNoteForSubSearch,
    handleCloseTransclusionPopup,
    handleBackToNoteSearch,
  }
}
