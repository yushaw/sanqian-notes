/**
 * Custom hook encapsulating the Agent Task Panel state and handlers.
 *
 * Owns: agentTaskPanelOpen, agentTaskBlockIds, agentTaskId,
 *       agentTaskBlockContent, agentTaskExecutionContext
 */

import { useState, useCallback } from 'react'
import type { useEditor } from '@tiptap/react'
import type { AgentExecutionContext } from '../../../../shared/types'
import { getNearestHeadingForBlock } from '../../utils/aiContext'
import { parseLocalResourceId } from '../../utils/localResourceId'
import { refreshTaskCache } from '../../utils/agentTaskStorage'

export function useEditorAgentTaskPanel({
  editor,
  noteId,
  noteTitle,
  notebookId,
  notebookName,
}: {
  editor: ReturnType<typeof useEditor>
  noteId: string
  noteTitle: string
  notebookId: string | null
  notebookName: string
}) {
  const [agentTaskPanelOpen, setAgentTaskPanelOpen] = useState(false)
  const [agentTaskBlockIds, setAgentTaskBlockIds] = useState<string[]>([])
  const [agentTaskId, setAgentTaskId] = useState<string | null>(null)
  const [agentTaskBlockContent, setAgentTaskBlockContent] = useState<string>('')
  const [agentTaskExecutionContext, setAgentTaskExecutionContext] = useState<AgentExecutionContext | null>(null)

  const handleOpenAgentTask = useCallback((blockIds: string[], taskId: string | null, blockContent: string) => {
    setAgentTaskBlockIds(blockIds)
    setAgentTaskId(taskId)
    setAgentTaskBlockContent(blockContent)
    const primaryBlockId = blockIds[0] || ''
    const localRef = parseLocalResourceId(noteId)
    const heading = editor && primaryBlockId
      ? getNearestHeadingForBlock(editor, primaryBlockId)
      : null
    setAgentTaskExecutionContext({
      sourceApp: 'sanqian-notes',
      noteId,
      noteTitle: noteTitle || null,
      notebookId: notebookId ?? null,
      notebookName: notebookName || null,
      sourceType: localRef ? 'local-folder' : 'internal',
      localResourceId: localRef ? noteId : null,
      localRelativePath: localRef?.relativePath || null,
      heading,
    })
    setAgentTaskPanelOpen(true)
  }, [editor, noteId, notebookId, noteTitle, notebookName])

  const handleCloseAgentTaskPanel = useCallback(() => {
    setAgentTaskPanelOpen(false)
  }, [])

  const primaryBlockId = agentTaskBlockIds[0] || ''

  const handleAgentTaskCreated = useCallback((taskId: string) => {
    if (!editor || !primaryBlockId) return
    editor.commands.setAgentTask(primaryBlockId, taskId)
    setAgentTaskId(taskId)
    refreshTaskCache().then(() => {
      editor.commands.refreshAgentTaskDecorations()
    })
  }, [editor, primaryBlockId])

  const handleAgentTaskRemoved = useCallback(() => {
    if (!editor || !primaryBlockId) return
    editor.commands.deleteManagedBlocks(primaryBlockId)
    editor.commands.removeAgentTask(primaryBlockId)
    setAgentTaskId(null)
    editor.commands.refreshAgentTaskDecorations()
  }, [editor, primaryBlockId])

  const handleAgentTaskUpdated = useCallback(() => {
    if (!editor) return
    refreshTaskCache().then(() => {
      editor.commands.refreshAgentTaskDecorations()
    })
  }, [editor])

  return {
    agentTaskPanelOpen,
    agentTaskBlockIds,
    agentTaskId,
    agentTaskBlockContent,
    agentTaskExecutionContext,
    primaryBlockId,
    handleOpenAgentTask,
    handleCloseAgentTaskPanel,
    handleAgentTaskCreated,
    handleAgentTaskRemoved,
    handleAgentTaskUpdated,
  }
}
