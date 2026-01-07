/**
 * AgentTaskPanel - Zen-style panel for agent tasks
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from '../i18n'
import {
  getTaskAsync,
  createTask,
  updateTask,
  deleteTask,
} from '../utils/agentTaskStorage'
import type { AgentTaskRecord, AgentTaskStatus } from '../../../shared/types'

interface AgentTaskPanelProps {
  isOpen: boolean
  onClose: () => void
  blockId: string
  taskId: string | null
  blockContent: string
  pageId: string
  notebookId: string | null
  onTaskCreated?: (taskId: string) => void
  onTaskRemoved?: () => void
  onTaskUpdated?: () => void
  onInsertResult?: (content: string) => void
}

// Agent step for display
interface ExecutionStep {
  type: 'thinking' | 'tool_call' | 'tool_result'
  content?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  result?: unknown
}

// Simple icon components
const Icons = {
  close: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  play: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
    </svg>
  ),
}

export function AgentTaskPanel({
  isOpen,
  onClose,
  blockId,
  taskId,
  blockContent,
  pageId,
  notebookId,
  onTaskCreated,
  onTaskRemoved,
  onTaskUpdated,
  onInsertResult,
}: AgentTaskPanelProps) {
  const t = useTranslations()

  const [task, setTask] = useState<AgentTaskRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [additionalPrompt, setAdditionalPrompt] = useState('')

  // Agent selection
  const [agents, setAgents] = useState<AgentCapability[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [agentsLoading, setAgentsLoading] = useState(false)

  // Streaming execution state
  const [streamingOutput, setStreamingOutput] = useState('')
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([])
  const unsubscribeRef = useRef<(() => void) | null>(null)

  // UI state
  const [showConfig, setShowConfig] = useState(false)

  // Load agents list
  useEffect(() => {
    if (!isOpen) return

    setAgentsLoading(true)
    window.electron.agent
      .list()
      .then((list) => {
        setAgents(list)
        // Auto-select first agent if none selected (using functional update to avoid stale closure)
        if (list.length > 0) {
          setSelectedAgentId((prev) => prev ?? list[0].id)
        }
      })
      .catch((error) => {
        console.error('Failed to load agents:', error)
      })
      .finally(() => setAgentsLoading(false))
  }, [isOpen])

  // Load task data when panel opens
  useEffect(() => {
    if (!isOpen) return

    // Always reset streaming state when panel opens
    // (previous streaming data is stale if panel was closed during execution)
    setStreamingOutput('')
    setExecutionSteps([])

    if (taskId) {
      setLoading(true)
      getTaskAsync(taskId)
        .then(async (data) => {
          // If task is stuck in 'running' status (from interrupted execution), reset to 'failed'
          if (data?.status === 'running') {
            const updatedData = await updateTask(data.id, {
              status: 'failed',
              error: t.agentTask?.interrupted ?? 'Task was interrupted',
            })
            setTask(updatedData ?? data)
            onTaskUpdated?.()
          } else {
            setTask(data)
          }
          setAdditionalPrompt(data?.additionalPrompt ?? '')
          // Restore agent selection if task has one
          if (data?.agentId) {
            setSelectedAgentId(data.agentId)
          }
        })
        .finally(() => setLoading(false))
    } else {
      setTask(null)
      setAdditionalPrompt('')
    }
  }, [isOpen, taskId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [])

  // ESC to close
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleExecute = useCallback(async () => {
    if (!selectedAgentId) {
      console.error('No agent selected')
      return
    }

    const selectedAgent = agents.find((a) => a.id === selectedAgentId)
    if (!selectedAgent) {
      console.error('Selected agent not found')
      return
    }

    try {
      setLoading(true)
      setStreamingOutput('')
      setExecutionSteps([])

      let currentTask = task

      // Create or update task
      if (!currentTask) {
        currentTask = await createTask({
          blockId,
          pageId,
          notebookId,
          content: blockContent,
          additionalPrompt: additionalPrompt || undefined,
          agentMode: 'specified',
          agentId: selectedAgentId,
          agentName: selectedAgent.name,
        })
        setTask(currentTask)
        onTaskCreated?.(currentTask.id)
      } else {
        // Update task with new prompt/agent if changed
        const updates: Partial<AgentTaskRecord> = {}
        if (additionalPrompt !== currentTask.additionalPrompt) {
          updates.additionalPrompt = additionalPrompt || null
        }
        if (selectedAgentId !== currentTask.agentId) {
          updates.agentId = selectedAgentId
          updates.agentName = selectedAgent.name
        }
        if (Object.keys(updates).length > 0) {
          currentTask = await updateTask(currentTask.id, updates)
          if (currentTask) setTask(currentTask)
        }
      }

      if (!currentTask) {
        throw new Error('Failed to create task')
      }

      // Clean up previous event listener if exists
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }

      // Set up event listener
      const taskIdForListener = currentTask.id
      unsubscribeRef.current = window.electron.agent.onEvent((eventTaskId, event) => {
        if (eventTaskId !== taskIdForListener) return

        switch (event.type) {
          case 'start':
            // Task started
            break

          case 'text':
            setStreamingOutput((prev) => prev + (event.content || ''))
            break

          case 'thinking':
            setExecutionSteps((prev) => [
              ...prev,
              { type: 'thinking', content: event.content },
            ])
            break

          case 'tool_call':
            setExecutionSteps((prev) => [
              ...prev,
              { type: 'tool_call', toolName: event.toolName, toolArgs: event.toolArgs },
            ])
            break

          case 'tool_result':
            setExecutionSteps((prev) => [
              ...prev,
              { type: 'tool_result', result: event.result },
            ])
            break

          case 'done':
            // Reload task to get final state from database
            getTaskAsync(taskIdForListener).then((updatedTask) => {
              if (updatedTask) {
                setTask(updatedTask)
                onTaskUpdated?.()
              }
            })
            setLoading(false)
            break

          case 'error':
            // Reload task to get error state
            getTaskAsync(taskIdForListener).then((updatedTask) => {
              if (updatedTask) {
                setTask(updatedTask)
                onTaskUpdated?.()
              }
            })
            setLoading(false)
            break
        }
      })

      // Start execution
      await window.electron.agent.run(
        currentTask.id,
        selectedAgentId,
        selectedAgent.name,
        blockContent,
        additionalPrompt || undefined
      )

      // Update local state to running
      setTask((prev) =>
        prev ? { ...prev, status: 'running' as AgentTaskStatus } : prev
      )
      onTaskUpdated?.()
    } catch (error) {
      console.error('Failed to execute agent task:', error)
      setLoading(false)
    }
  }, [
    task,
    blockId,
    pageId,
    notebookId,
    blockContent,
    additionalPrompt,
    selectedAgentId,
    agents,
    onTaskCreated,
    onTaskUpdated,
  ])

  const handleCancel = useCallback(async () => {
    if (task?.id) {
      await window.electron.agent.cancel(task.id)
    }
  }, [task])

  const handleRemove = useCallback(async () => {
    if (task) {
      await deleteTask(task.id)
    }
    onTaskRemoved?.()
    onClose()
  }, [task, onTaskRemoved, onClose])

  const handleCopyResult = useCallback(() => {
    if (task?.result) {
      navigator.clipboard.writeText(task.result)
    }
  }, [task])

  const handleInsertResult = useCallback(() => {
    if (task?.result) {
      onInsertResult?.(task.result)
      onClose()
    }
  }, [task, onInsertResult, onClose])

  if (!isOpen) return null

  const status = task?.status ?? 'idle'

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-[1000]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[var(--color-card)] rounded-2xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] overflow-hidden z-[1001]">
        {/* Header - minimal */}
        <div className="flex items-center justify-end px-4 py-3">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-all"
          >
            {Icons.close}
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && !task ? (
            <div className="flex items-center justify-center py-16 gap-3 text-[var(--color-muted)]">
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* ===== COMPLETED STATE ===== */}
              {status === 'completed' && task?.result && (
                <div className="p-6">
                  {/* Result as main content */}
                  <div className="text-[0.9375rem] leading-relaxed text-[var(--color-text)] whitespace-pre-wrap">
                    {task.result}
                  </div>

                  {/* Meta info */}
                  <div className="mt-4 flex items-center gap-3 text-xs text-[var(--color-muted)]">
                    {task.agentName && <span>{task.agentName}</span>}
                    {task.agentName && task.durationMs && <span>·</span>}
                    {task.durationMs && <span>{(task.durationMs / 1000).toFixed(1)}s</span>}
                    <button
                      onClick={() => setShowConfig(!showConfig)}
                      className="ml-auto hover:text-[var(--color-text)] transition-colors"
                    >
                      {showConfig ? (t.agentTask?.collapse ?? 'Collapse') : (t.agentTask?.configure ?? 'Configure')}
                    </button>
                  </div>

                  {/* Collapsible config */}
                  {showConfig && (
                    <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5 space-y-4">
                      {/* Input preview */}
                      <div className="text-xs text-[var(--color-muted)] line-clamp-2">
                        {blockContent}
                      </div>

                      {/* Agent + Instructions in one row */}
                      <div className="flex gap-3">
                        <select
                          className="flex-1 text-sm bg-black/[0.02] dark:bg-white/[0.02] border-none rounded-lg h-9 px-3 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20"
                          value={selectedAgentId || ''}
                          onChange={(e) => setSelectedAgentId(e.target.value)}
                        >
                          {agents.map((agent) => (
                            <option key={agent.id} value={agent.id}>{agent.name}</option>
                          ))}
                        </select>
                      </div>

                      <textarea
                        className="w-full text-sm bg-black/[0.02] dark:bg-white/[0.02] border-none rounded-lg p-3 text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 resize-none"
                        placeholder={t.agentTask?.additionalPromptPlaceholder ?? 'Optional instructions...'}
                        value={additionalPrompt}
                        onChange={(e) => setAdditionalPrompt(e.target.value)}
                        rows={2}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ===== FAILED STATE ===== */}
              {status === 'failed' && (
                <div className="p-6">
                  <div className="text-sm text-red-600 dark:text-red-400">
                    {task?.error || (t.agentTask?.unknownError ?? 'Unknown error')}
                  </div>

                  <div className="mt-4 flex items-center gap-3 text-xs text-[var(--color-muted)]">
                    {task?.agentName && <span>{task.agentName}</span>}
                    <button
                      onClick={() => setShowConfig(!showConfig)}
                      className="ml-auto hover:text-[var(--color-text)] transition-colors"
                    >
                      {showConfig ? (t.agentTask?.collapse ?? 'Collapse') : (t.agentTask?.reconfigure ?? 'Reconfigure')}
                    </button>
                  </div>

                  {showConfig && (
                    <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5 space-y-4">
                      <div className="text-xs text-[var(--color-muted)] line-clamp-2">{blockContent}</div>
                      <select
                        className="w-full text-sm bg-black/[0.02] dark:bg-white/[0.02] border-none rounded-lg h-9 px-3"
                        value={selectedAgentId || ''}
                        onChange={(e) => setSelectedAgentId(e.target.value)}
                      >
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                      </select>
                      <textarea
                        className="w-full text-sm bg-black/[0.02] dark:bg-white/[0.02] border-none rounded-lg p-3 resize-none"
                        placeholder={t.agentTask?.additionalPromptPlaceholder ?? 'Optional instructions...'}
                        value={additionalPrompt}
                        onChange={(e) => setAdditionalPrompt(e.target.value)}
                        rows={2}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* ===== RUNNING STATE ===== */}
              {status === 'running' && (
                <div className="p-6">
                  {/* Streaming output or placeholder */}
                  {streamingOutput ? (
                    <div className="text-[0.9375rem] leading-relaxed text-[var(--color-text)] whitespace-pre-wrap">
                      {streamingOutput}
                      <span className="inline-block w-2 h-4 ml-0.5 bg-[var(--color-accent)] animate-pulse" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-[var(--color-muted)]">
                      <div className="w-4 h-4 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm">{t.agentTask?.executingMessage ?? 'Processing...'}</span>
                    </div>
                  )}

                  {/* Steps indicator */}
                  {executionSteps.length > 0 && (
                    <div className="mt-4 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                      {executionSteps.slice(-1).map((step, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {step.type === 'tool_call' && <>→ {step.toolName}</>}
                          {step.type === 'thinking' && <>💭 {t.agentTask?.thinking ?? 'Thinking'}...</>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ===== IDLE STATE ===== */}
              {status === 'idle' && (
                <div className="p-6">
                  {/* Context block */}
                  <div className="pl-3 border-l-2 border-[var(--color-accent)]/30 text-sm leading-relaxed text-[var(--color-text)] line-clamp-3 mb-6">
                    {blockContent || (
                      <span className="text-[var(--color-muted)] italic">
                        {t.agentTask?.emptyContent ?? '(empty)'}
                      </span>
                    )}
                  </div>

                  {/* Agent selector - inline style */}
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-sm text-[var(--color-muted)]">{t.agentTask?.useAgent ?? 'Use'}</span>
                    {agentsLoading ? (
                      <div className="w-3 h-3 border border-[var(--color-muted)] border-t-transparent rounded-full animate-spin" />
                    ) : agents.length === 0 ? (
                      <span className="text-sm text-[var(--color-muted)] italic">{t.agentTask?.noAgents ?? 'No agents'}</span>
                    ) : (
                      <select
                        className="text-sm font-medium bg-transparent border-none text-[var(--color-text)] focus:outline-none cursor-pointer pr-1 -ml-1"
                        value={selectedAgentId || ''}
                        onChange={(e) => setSelectedAgentId(e.target.value)}
                      >
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <span className="text-sm text-[var(--color-muted)]">{t.agentTask?.processContent ?? 'to process'}</span>
                  </div>

                  {/* Instructions - simple input */}
                  <input
                    type="text"
                    className="w-full text-sm bg-black/[0.02] dark:bg-white/[0.02] border-none rounded-lg h-10 px-3 text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20"
                    placeholder={t.agentTask?.additionalPromptPlaceholder ?? 'Instructions (optional)...'}
                    value={additionalPrompt}
                    onChange={(e) => setAdditionalPrompt(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer - context-aware */}
        <div className="px-6 py-4">
          {/* Idle: just run button */}
          {status === 'idle' && (
            <div className="flex justify-end">
              <button
                onClick={handleExecute}
                disabled={loading || !selectedAgentId || agents.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[var(--color-accent)] hover:opacity-90 rounded-xl transition-all disabled:opacity-50 select-none"
              >
                {Icons.play}
                <span>{t.agentTask?.execute ?? 'Run'}</span>
              </button>
            </div>
          )}

          {/* Running: cancel button */}
          {status === 'running' && (
            <div className="flex justify-end">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-sm text-[var(--color-muted)] hover:text-red-500 transition-colors select-none"
              >
                {t.agentTask?.cancel ?? 'Cancel'}
              </button>
            </div>
          )}

          {/* Completed: actions */}
          {status === 'completed' && (
            <div className="flex items-center justify-between">
              <button
                onClick={handleRemove}
                className="text-xs text-[var(--color-muted)] hover:text-red-500 transition-colors select-none"
              >
                {t.agentTask?.remove ?? 'Remove'}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyResult}
                  className="px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors select-none"
                >
                  {t.agentTask?.copy ?? 'Copy'}
                </button>
                {showConfig && (
                  <button
                    onClick={handleExecute}
                    disabled={loading || !selectedAgentId}
                    className="px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors select-none disabled:opacity-50"
                  >
                    {t.agentTask?.reExecute ?? 'Retry'}
                  </button>
                )}
                <button
                  onClick={handleInsertResult}
                  className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-accent)] hover:opacity-90 rounded-xl transition-all select-none"
                >
                  {t.agentTask?.insertBelow ?? 'Insert'}
                </button>
              </div>
            </div>
          )}

          {/* Failed: retry */}
          {status === 'failed' && (
            <div className="flex items-center justify-between">
              <button
                onClick={handleRemove}
                className="text-xs text-[var(--color-muted)] hover:text-red-500 transition-colors select-none"
              >
                {t.agentTask?.remove ?? 'Remove'}
              </button>
              <button
                onClick={handleExecute}
                disabled={loading}
                className="px-5 py-2.5 text-sm font-medium text-white bg-[var(--color-accent)] hover:opacity-90 rounded-xl transition-all disabled:opacity-50 select-none"
              >
                {t.agentTask?.retry ?? 'Retry'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}

export default AgentTaskPanel
