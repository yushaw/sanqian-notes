import { useState, useCallback } from 'react'
import type { CursorContext } from '../utils/cursor'

export function useEditorContextState() {
  const [currentBlockId, setCurrentBlockId] = useState<string | null>(null)
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [cursorContext, setCursorContext] = useState<CursorContext | null>(null)

  const handleSelectionChange = useCallback((blockId: string | null, text: string | null, ctx: CursorContext | null) => {
    setCurrentBlockId(blockId)
    setSelectedText(text)
    setCursorContext(ctx)
  }, [])

  return {
    currentBlockId,
    selectedText,
    cursorContext,
    handleSelectionChange,
  }
}
