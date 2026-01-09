/**
 * AgentTaskPanel - Zen-style panel for agent tasks
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from '../i18n'
import { AgentSelect } from './AgentSelect'
import { Select } from './Select'
import {
  getTaskAsync,
  createTask,
  updateTask,
  deleteTask,
} from '../utils/agentTaskStorage'
import type { AgentTaskRecord, AgentTaskStatus, AgentTaskOutputFormat } from '../../../shared/types'

interface AgentTaskPanelProps {
  isOpen: boolean
  onClose: () => void
  blockIds: string[]
  taskId: string | null
  blockContent: string
  pageId: string
  notebookId: string | null
  onTaskCreated?: (taskId: string) => void
  onTaskRemoved?: () => void
  onTaskUpdated?: () => void
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
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  play: (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
    </svg>
  ),
}

// Instant tooltip component using Portal to avoid clipping
function Tooltip({ children, text }: { children: React.ReactNode; text: string }) {
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPosition({
        top: rect.top - 6, // 6px gap above trigger
        left: rect.left + rect.width / 2
      })
    }
    setShow(true)
  }

  return (
    <div ref={triggerRef} className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={() => setShow(false)}>
      {children}
      {show && createPortal(
        <div
          className="fixed px-2 py-1 text-[10px] whitespace-nowrap rounded bg-neutral-800 dark:bg-neutral-700 text-white shadow-lg pointer-events-none"
          style={{
            top: position.top,
            left: position.left,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999
          }}
        >
          {text}
        </div>,
        document.body
      )}
    </div>
  )
}

export function AgentTaskPanel({
  isOpen,
  onClose,
  blockIds,
  taskId,
  blockContent,
  pageId,
  notebookId,
  onTaskCreated,
  onTaskRemoved,
  onTaskUpdated,
}: AgentTaskPanelProps) {
  // 第一个 blockId 用于关联任务
  const primaryBlockId = blockIds[0] || ''
  const t = useTranslations()

  const [task, setTask] = useState<AgentTaskRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [additionalPrompt, setAdditionalPrompt] = useState('')

  // Agent selection
  const [agents, setAgents] = useState<AgentCapability[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [agentsLoading, setAgentsLoading] = useState(false)

  // Streaming execution state - separate outputs for each phase
  const [contentOutput, setContentOutput] = useState('')
  const [editorOutput, setEditorOutput] = useState('')
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([])
  const [currentPhase, setCurrentPhase] = useState<'content' | 'editor' | null>(null)
  const [selectedPhase, setSelectedPhase] = useState<'content' | 'editor'>('content') // User-selected tab
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const executingTaskIdRef = useRef<string | null>(null) // Track currently executing task

  // Process mode (append below or replace block)
  const [processMode, setProcessMode] = useState<'append' | 'replace'>('append')

  // Output format type (default 'auto' - let Formatter decide)
  const [outputFormat, setOutputFormat] = useState<AgentTaskOutputFormat>('auto')

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

    // Skip everything if this task is currently being executed by this component
    // This prevents database state from overwriting the running UI state
    if (taskId && executingTaskIdRef.current === taskId) {
      return
    }

    // Reset streaming state when panel opens or taskId changes
    // (previous streaming data is stale if panel was closed during execution)
    setContentOutput('')
    setEditorOutput('')
    setExecutionSteps([])
    setCurrentPhase(null)
    setSelectedPhase('content')

    if (taskId) {
      setLoading(true)
      getTaskAsync(taskId)
        .then(async (data) => {
          // Double-check: if task started executing while we were loading, don't overwrite
          if (executingTaskIdRef.current === taskId) {
            return
          }

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
          // Restore process mode
          if (data?.processMode) {
            setProcessMode(data.processMode)
          }
          // Restore output format
          if (data?.outputFormat) {
            setOutputFormat(data.outputFormat)
          }
        })
        .finally(() => setLoading(false))
    } else {
      setTask(null)
      setAdditionalPrompt('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t change doesn't require refetch; onTaskUpdated is event handler
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
      setContentOutput('')
      setEditorOutput('')
      setExecutionSteps([])
      setCurrentPhase(null)
      setSelectedPhase('content')

      let currentTask = task

      // Create or update task
      if (!currentTask) {
        currentTask = await createTask({
          blockId: primaryBlockId,
          pageId,
          notebookId,
          content: blockContent,
          additionalPrompt: additionalPrompt || undefined,
          agentMode: 'specified',
          agentId: selectedAgentId,
          agentName: selectedAgent.name,
          processMode,
          outputFormat,
        })
        setTask(currentTask)
        onTaskCreated?.(currentTask.id)
      } else {
        // Update task with new prompt/agent/processMode/outputFormat if changed
        const updates: Partial<AgentTaskRecord> = {}
        if (additionalPrompt !== currentTask.additionalPrompt) {
          updates.additionalPrompt = additionalPrompt || null
        }
        if (selectedAgentId !== currentTask.agentId) {
          updates.agentId = selectedAgentId
          updates.agentName = selectedAgent.name
        }
        if (processMode !== currentTask.processMode) {
          updates.processMode = processMode
        }
        if (outputFormat !== currentTask.outputFormat) {
          updates.outputFormat = outputFormat
        }
        if (Object.keys(updates).length > 0) {
          currentTask = await updateTask(currentTask.id, updates)
          if (currentTask) setTask(currentTask)
        }
      }

      if (!currentTask) {
        throw new Error('Failed to create task')
      }

      // Immediately set to running state to avoid showing old failed state
      setTask({ ...currentTask, status: 'running' as AgentTaskStatus })
      executingTaskIdRef.current = currentTask.id

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

          case 'phase':
            // Execution phase changed (content → editor)
            if (event.phase) {
              setCurrentPhase(event.phase)
              setSelectedPhase(event.phase) // Auto-select new phase
            }
            break

          case 'text':
            // Append text to the current phase output
            if (event.content) {
              setCurrentPhase((phase) => {
                const targetPhase = phase || 'content'
                if (targetPhase === 'editor') {
                  setEditorOutput((prev) => prev + event.content)
                } else {
                  setContentOutput((prev) => prev + event.content)
                }
                return phase
              })
            }
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

          case 'editor_content':
            // Formatted content from formatter agent's pending operations
            if (event.content) {
              setEditorOutput(event.content)
            }
            break

          case 'tool_result':
            setExecutionSteps((prev) => [
              ...prev,
              { type: 'tool_result', result: event.result },
            ])
            break

          case 'done':
            // Reload task to get final state from database
            executingTaskIdRef.current = null
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
            executingTaskIdRef.current = null
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

      // Start execution with outputContext for Formatter Agent
      await window.electron.agent.run(
        currentTask.id,
        selectedAgentId,
        selectedAgent.name,
        blockContent,
        additionalPrompt || undefined,
        {
          targetBlockId: primaryBlockId,
          blockIds,
          pageId,
          notebookId,
          processMode,
          outputFormat,
        }
      )

      onTaskUpdated?.()
    } catch (error) {
      console.error('Failed to execute agent task:', error)
      setLoading(false)
    }
  }, [
    task,
    primaryBlockId,
    blockIds,
    pageId,
    notebookId,
    blockContent,
    additionalPrompt,
    selectedAgentId,
    agents,
    processMode,
    outputFormat,
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
    // Prioritize formatted output (editorOutput) over raw content
    const contentToCopy = editorOutput || task?.result
    if (contentToCopy) {
      navigator.clipboard.writeText(contentToCopy)
    }
  }, [task, editorOutput])

  if (!isOpen) return null

  const status = task?.status ?? 'idle'
  const hasOutput = status === 'running' || status === 'completed' || status === 'failed'

  // Config panel (left side) - use JSX variable instead of inline function component to avoid re-mount on state change
  const configPanel = (
    <div className="flex flex-col h-full">
      {/* Top: Block content preview */}
      <div className="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] mb-1.5">
          {t.agentTask?.sourceContent ?? 'Source'}
        </div>
        <div className="pl-2 border-l-[1.5px] border-[var(--color-accent)]/30 text-xs leading-relaxed text-[var(--color-text)] max-h-20 overflow-y-auto">
          {blockContent || (
            <span className="text-[var(--color-muted)] italic">
              {t.agentTask?.emptyContent ?? '(empty)'}
            </span>
          )}
        </div>
      </div>

      {/* Bottom: Config controls + textarea */}
      <div className="flex-1 flex flex-col space-y-3">
        {/* Additional prompt - expands upward */}
        <textarea
          className="w-full text-[13px] bg-black/[0.02] dark:bg-white/[0.02] border-none rounded-md p-2.5 text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/20 resize-none max-h-24"
          placeholder={t.agentTask?.additionalPromptPlaceholder ?? 'Instructions (optional)...'}
          value={additionalPrompt}
          onChange={(e) => setAdditionalPrompt(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          rows={2}
        />

        {/* Agent selector */}
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-[var(--color-muted)]">{t.agentTask?.useAgent ?? 'Use'}</span>
          {agentsLoading ? (
            <div className="w-3 h-3 border border-[var(--color-muted)] border-t-transparent rounded-full animate-spin" />
          ) : agents.length === 0 ? (
            <span className="text-[var(--color-muted)] italic">{t.agentTask?.noAgents ?? 'No agents'}</span>
          ) : (
            <AgentSelect
              agents={agents}
              value={selectedAgentId}
              onChange={setSelectedAgentId}
            />
          )}
        </div>

        {/* Format selector */}
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-[var(--color-muted)]">{t.agentTask?.formatLabel ?? 'Format'}</span>
          <Select
            options={[
              { value: 'auto', label: t.agentTask?.formatAuto ?? 'Auto' },
              { value: 'paragraph', label: t.agentTask?.formatParagraph ?? 'Paragraph' },
              { value: 'list', label: t.agentTask?.formatList ?? 'List' },
              { value: 'table', label: t.agentTask?.formatTable ?? 'Table' },
              { value: 'code', label: t.agentTask?.formatCode ?? 'Code' },
              { value: 'quote', label: t.agentTask?.formatQuote ?? 'Quote' },
            ]}
            value={outputFormat}
            onChange={(v) => setOutputFormat(v as AgentTaskOutputFormat)}
          />
        </div>

        {/* Process mode + Run button row */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded bg-black/[0.03] dark:bg-white/[0.03] text-[12px]">
            <Tooltip text={t.agentTask?.modeAppendTip ?? 'Insert below current block'}>
              <button
                onClick={() => setProcessMode('append')}
                className={`px-1.5 py-0.5 rounded transition-all ${
                  processMode === 'append'
                    ? 'bg-white dark:bg-white/10 text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {t.agentTask?.modeAppend ?? 'Append'}
              </button>
            </Tooltip>
            <Tooltip text={t.agentTask?.modeReplaceTip ?? 'Replace current block'}>
              <button
                onClick={() => setProcessMode('replace')}
                className={`px-1.5 py-0.5 rounded transition-all ${
                  processMode === 'replace'
                    ? 'bg-white dark:bg-white/10 text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {t.agentTask?.modeReplace ?? 'Replace'}
              </button>
            </Tooltip>
          </div>

          {/* Run button */}
          <button
            onClick={handleExecute}
            disabled={loading || !selectedAgentId || agents.length === 0}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[13px] font-medium text-white bg-[var(--color-accent)] hover:opacity-90 rounded-md transition-all disabled:opacity-50 select-none"
          >
            {Icons.play}
            <span>{status === 'idle' ? (t.agentTask?.execute ?? 'Run') : (t.agentTask?.reExecute ?? 'Retry')}</span>
          </button>
        </div>
      </div>
    </div>
  )

  // Output panel (right side) - shows running/completed/failed state
  // Get the output to display based on selected phase
  const displayOutput = selectedPhase === 'editor' ? editorOutput : contentOutput
  const isCurrentPhaseSelected = selectedPhase === currentPhase

  // Use JSX variable instead of inline function component to avoid re-mount on state change
  const outputPanel = (
    <div className="flex flex-col h-full">
      {/* Phase indicator - minimal tabs */}
      <div className="flex items-center gap-2.5 pb-2.5 mb-3 border-b border-black/5 dark:border-white/5">
          <button
            onClick={() => setSelectedPhase('content')}
            className="flex items-center gap-1 hover:opacity-80 transition-opacity"
          >
            <span className={`w-1 h-1 rounded-full transition-colors ${
              currentPhase === 'content' || currentPhase === 'editor' || status === 'completed' ? 'bg-[var(--color-accent)]' : 'bg-black/10 dark:bg-white/10'
            } ${currentPhase === 'content' && status === 'running' ? 'animate-pulse' : ''}`} />
            <span className={`text-[11px] transition-colors ${
              selectedPhase === 'content' ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
            }`}>
              {t.agentTask?.phaseContent ?? 'Generating'}
            </span>
          </button>
          <span className="text-[var(--color-muted)]/30">→</span>
          <button
            onClick={() => setSelectedPhase('editor')}
            className="flex items-center gap-1 hover:opacity-80 transition-opacity"
          >
            <span className={`w-1 h-1 rounded-full transition-colors ${
              currentPhase === 'editor' || status === 'completed' ? 'bg-[var(--color-accent)]' : 'bg-black/10 dark:bg-white/10'
            } ${currentPhase === 'editor' && status === 'running' ? 'animate-pulse' : ''}`} />
            <span className={`text-[11px] transition-colors ${
              selectedPhase === 'editor' ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
            }`}>
              {t.agentTask?.phaseEditor ?? 'Formatting'}
            </span>
          </button>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Running state */}
        {status === 'running' && (
          <>
            {displayOutput ? (
              <div className="text-[13px] leading-relaxed text-[var(--color-text)] whitespace-pre-wrap">
                {displayOutput}
                {isCurrentPhaseSelected && (
                  <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-[var(--color-accent)] animate-pulse" />
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[var(--color-muted)]">
                {isCurrentPhaseSelected ? (
                  <>
                    <div className="w-3 h-3 border-[1.5px] border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs">{t.agentTask?.executingMessage ?? 'Processing...'}</span>
                  </>
                ) : (
                  <span className="text-xs italic">{t.agentTask?.emptyContent ?? '(empty)'}</span>
                )}
              </div>
            )}
            {isCurrentPhaseSelected && executionSteps.length > 0 && (
              <div className="mt-2 text-[10px] text-[var(--color-muted)]">
                {executionSteps.slice(-1).map((step, i) => (
                  <span key={i}>
                    {step.type === 'tool_call' && <>→ {step.toolName}</>}
                    {step.type === 'thinking' && <>{t.agentTask?.thinking ?? 'Thinking'}...</>}
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        {/* Completed state */}
        {status === 'completed' && (
          <div className="text-[13px] leading-relaxed text-[var(--color-text)] whitespace-pre-wrap">
            {selectedPhase === 'content' ? (
              contentOutput || task?.result || ''
            ) : (
              editorOutput || (
                <span className="text-[var(--color-muted)] italic text-xs">
                  {t.agentTask?.formattingDone ?? 'Content formatted and ready to insert'}
                </span>
              )
            )}
          </div>
        )}

        {/* Failed state */}
        {status === 'failed' && (
          <div className="text-xs text-red-600 dark:text-red-400">
            {task?.error || (t.agentTask?.unknownError ?? 'Unknown error')}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="pt-3 mt-auto border-t border-black/5 dark:border-white/5">
        {status === 'running' && (
          <button
            onClick={handleCancel}
            className="text-xs text-[var(--color-muted)] hover:text-red-500 transition-colors select-none"
          >
            {t.agentTask?.cancel ?? 'Cancel'}
          </button>
        )}

        {status === 'completed' && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]">
              {task?.agentName && <span>{task.agentName}</span>}
              {task?.durationMs && <span>· {(task.durationMs / 1000).toFixed(1)}s</span>}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleRemove}
                className="px-2 py-1 text-[11px] text-[var(--color-muted)] hover:text-red-500 transition-colors select-none"
              >
                {t.agentTask?.remove ?? 'Remove'}
              </button>
              <button
                onClick={handleCopyResult}
                className="px-2 py-1 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors select-none"
              >
                {t.agentTask?.copy ?? 'Copy'}
              </button>
            </div>
          </div>
        )}

        {status === 'failed' && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-muted)]">{task?.agentName}</span>
            <button
              onClick={handleRemove}
              className="text-[11px] text-[var(--color-muted)] hover:text-red-500 transition-colors select-none"
            >
              {t.agentTask?.remove ?? 'Remove'}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-[1px] z-[1000]"
        onClick={onClose}
      />

      {/* Panel - dynamic width based on output presence */}
      <div
        className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--color-card)] rounded-xl shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] overflow-hidden z-[1001] transition-all duration-200 ${
          hasOutput ? 'w-[680px] h-[400px]' : 'w-[320px]'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button - absolute positioned */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-all z-10"
        >
          {Icons.close}
        </button>

        {/* Body - split layout when has output */}
        <div className={`flex h-full ${hasOutput ? '' : ''}`}>
          {/* Left: Config */}
          <div className={`p-4 flex flex-col ${hasOutput ? 'w-[240px] flex-shrink-0 h-full border-r border-black/5 dark:border-white/5' : 'w-full'}`}>
            {loading && !task ? (
              <div className="flex items-center justify-center flex-1">
                <div className="w-4 h-4 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              configPanel
            )}
          </div>

          {/* Right: Output (only when running/completed/failed) */}
          {hasOutput && (
            <div className="flex-1 p-4 min-w-0 flex flex-col overflow-hidden">
              {outputPanel}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}

export default AgentTaskPanel
