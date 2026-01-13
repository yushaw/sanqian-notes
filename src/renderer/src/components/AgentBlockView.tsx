/**
 * AgentBlockView - 独立 Agent Block 的块级卡片 UI
 * 极简风格：收起时像纯文本，展开时显示更多选项
 */

import { NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Play, RotateCcw, Loader2, ChevronRight } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { useTranslations } from '../i18n'
import { Select } from './Select'
import { createTask, updateTask, getTaskAsync } from '../utils/agentTaskStorage'
import { toast } from '../utils/toast'
import type { AgentBlockAttrs } from './extensions/AgentBlock'
import type { AgentTaskOutputFormat } from '../../../shared/types'

// Truncate error message to avoid bloating HTML attributes
const truncateError = (msg: string, maxLen = 200) =>
  msg.length > maxLen ? msg.slice(0, maxLen) + '...' : msg

export function AgentBlockView({ node, updateAttributes, selected, editor, deleteNode }: NodeViewProps) {
  const attrs = node.attrs as AgentBlockAttrs
  const {
    blockId,
    agentId,
    additionalPrompt,
    outputFormat,
    processMode,
    status,
    taskId,
    durationMs,
    open,
    shouldFocus,
  } = attrs

  // Check if there's any child content
  const hasContent = node.content.size > 0

  const t = useTranslations()

  // UI state
  const [localPrompt, setLocalPrompt] = useState(additionalPrompt || '')
  const [loading, setLoading] = useState(false)
  const [localOpen, setLocalOpen] = useState(open)

  // Agent list
  const [agents, setAgents] = useState<AgentCapability[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)

  // Streaming state
  const [currentPhase, setCurrentPhase] = useState<'content' | 'editor'>('content')
  const [contentOutput, setContentOutput] = useState('')
  const [editorOutput, setEditorOutput] = useState('')
  const unsubscribeRef = useRef<(() => void) | null>(null)
  // Use ref to track phase for event handler (avoid stale closure and React double-invoke)
  const currentPhaseRef = useRef<'content' | 'editor'>('content')
  const executingTaskIdRef = useRef<string | null>(null)
  const isMountedRef = useRef(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  // Get page context from editor
  const getPageContext = useCallback(() => {
    const editorElement = editor?.view?.dom?.closest('[data-note-id]')
    const pageId = editorElement?.getAttribute('data-note-id') || ''
    const notebookId = editorElement?.getAttribute('data-notebook-id') || null
    return { pageId, notebookId }
  }, [editor])

  // Create event handler for agent events (shared between initial execution and remount)
  const createEventHandler = useCallback(
    (taskIdForListener: string) => {
      return (eventTaskId: string, event: { type: string; content?: string; phase?: string; error?: string }) => {
        if (eventTaskId !== taskIdForListener) return
        // Skip if component is unmounted
        if (!isMountedRef.current) return

        switch (event.type) {
          case 'phase':
            if (event.phase) {
              const phase = event.phase as 'content' | 'editor'
              currentPhaseRef.current = phase
              setCurrentPhase(phase)
            }
            break

          case 'text':
            if (event.content) {
              if (currentPhaseRef.current === 'editor') {
                setEditorOutput((prev) => prev + event.content)
              } else {
                setContentOutput((prev) => prev + event.content)
              }
              requestAnimationFrame(() => {
                if (outputRef.current) {
                  outputRef.current.scrollTop = outputRef.current.scrollHeight
                }
              })
            }
            break

          case 'editor_content':
            if (event.content) {
              setEditorOutput(event.content)
              requestAnimationFrame(() => {
                if (outputRef.current) {
                  outputRef.current.scrollTop = outputRef.current.scrollHeight
                }
              })
            }
            break

          case 'done':
            executingTaskIdRef.current = null
            if (unsubscribeRef.current) {
              unsubscribeRef.current()
              unsubscribeRef.current = null
            }
            updateAttributes({
              status: 'completed',
              error: null,
            })
            setLoading(false)
            setContentOutput('')
            setEditorOutput('')
            getTaskAsync(taskIdForListener).then((updatedTask) => {
              if (updatedTask) {
                updateAttributes({
                  executedAt: updatedTask.completedAt,
                  durationMs: updatedTask.durationMs,
                })
              }
            })
            break

          case 'error':
            executingTaskIdRef.current = null
            if (unsubscribeRef.current) {
              unsubscribeRef.current()
              unsubscribeRef.current = null
            }
            updateAttributes({ status: 'failed' })
            setLoading(false)
            toast(truncateError(event.error || t.agentBlock.unknownError || 'Unknown error'), { type: 'error' })
            setContentOutput('')
            setEditorOutput('')
            break
        }
      }
    },
    [updateAttributes, t]
  )

  // Load agents list (only on mount)
  useEffect(() => {
    setAgentsLoading(true)
    window.electron.agent
      .list()
      .then((list) => {
        setAgents(list)
        // 如果没有选择 agent，按优先级选择：本地缓存 > meta agent > 第一个
        if (!agentId && list.length > 0) {
          const cachedAgentId = localStorage.getItem('agent-block-last-agent-id')
          const cachedAgent = cachedAgentId ? list.find((a) => a.id === cachedAgentId) : null
          const metaAgent = list.find((a) => a.id === 'meta' || a.name.toLowerCase() === 'meta')

          const defaultAgent = cachedAgent || metaAgent || list[0]
          updateAttributes({
            agentId: defaultAgent.id,
            agentName: defaultAgent.name,
          })
        }
      })
      .catch((error) => {
        console.error('Failed to load agents:', error)
      })
      .finally(() => setAgentsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时加载一次
  }, [])

  // Sync local prompt with attrs
  useEffect(() => {
    setLocalPrompt(additionalPrompt || '')
  }, [additionalPrompt])

  // Sync local open with attrs
  useEffect(() => {
    setLocalOpen(open)
  }, [open])

  // Track component mount state
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      // Cleanup listener on unmount
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [])

  // Re-establish listener if component re-mounts while task is running
  // This handles the case where NodeView re-mounts due to content change
  useEffect(() => {
    if (status === 'running' && taskId && !unsubscribeRef.current) {
      setLoading(true)
      executingTaskIdRef.current = taskId
      unsubscribeRef.current = window.electron.agent.onEvent(createEventHandler(taskId))

      // 检查任务是否已经完成（防止 done 事件在 useEffect 执行前被丢失）
      getTaskAsync(taskId).then((task) => {
        if (!isMountedRef.current) return
        if (task && task.status !== 'running') {
          // 任务已经完成，清理监听器并更新状态
          executingTaskIdRef.current = null
          if (unsubscribeRef.current) {
            unsubscribeRef.current()
            unsubscribeRef.current = null
          }
          setLoading(false)
          updateAttributes({
            status: task.status as AgentBlockAttrs['status'],
            durationMs: task.durationMs,
            executedAt: task.completedAt,
          })
          if (task.error) {
            toast(truncateError(task.error), { type: 'error' })
          }
        }
      })
    }
  }, [status, taskId, createEventHandler, updateAttributes])

  // Auto-focus input when newly created or when shouldFocus is set
  useEffect(() => {
    if (shouldFocus) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        updateAttributes({ shouldFocus: false })
      })
    }
  }, [shouldFocus, updateAttributes])

  // Auto-focus on mount if no prompt (new empty block)
  useEffect(() => {
    if (!additionalPrompt && inputRef.current) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时检查一次
  }, [])

  // Handle agent selection
  const handleAgentChange = useCallback(
    (newAgentId: string) => {
      const agent = agents.find((a) => a.id === newAgentId)
      updateAttributes({
        agentId: newAgentId,
        agentName: agent?.name || null,
      })
      // 缓存选择，下次创建时使用
      localStorage.setItem('agent-block-last-agent-id', newAgentId)
    },
    [agents, updateAttributes]
  )

  // Handle execute
  const handleExecute = useCallback(async () => {
    if (!agentId || !localPrompt.trim()) {
      return
    }

    // 容错：如果 blockId 为空，自动生成一个
    let currentBlockId = blockId
    if (!currentBlockId) {
      currentBlockId = uuidv4()
      updateAttributes({ blockId: currentBlockId })
    }

    const selectedAgent = agents.find((a) => a.id === agentId)
    if (!selectedAgent) {
      return
    }

    const { pageId, notebookId } = getPageContext()

    try {
      setLoading(true)
      currentPhaseRef.current = 'content'
      setCurrentPhase('content')
      setContentOutput('')
      setEditorOutput('')

      // Save prompt
      if (localPrompt !== additionalPrompt) {
        updateAttributes({ additionalPrompt: localPrompt })
      }

      // Create or get task
      let currentTaskId = taskId
      if (!currentTaskId) {
        const task = await createTask({
          blockId: currentBlockId,
          pageId,
          notebookId,
          content: localPrompt,
          additionalPrompt: localPrompt,
          agentMode: 'specified',
          agentId,
          agentName: selectedAgent.name,
          processMode,
          outputFormat,
        })
        currentTaskId = task.id
        updateAttributes({ taskId: task.id })
      } else {
        await updateTask(currentTaskId, {
          additionalPrompt: localPrompt,
          agentId,
          agentName: selectedAgent.name,
          processMode,
          outputFormat,
        })
      }

      updateAttributes({ status: 'running', error: null })
      executingTaskIdRef.current = currentTaskId

      // Clean up previous event listener if exists
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }

      // Set up event listener for this execution
      unsubscribeRef.current = window.electron.agent.onEvent(createEventHandler(currentTaskId))

      await window.electron.agent.run(
        currentTaskId,
        agentId,
        selectedAgent.name,
        localPrompt,
        undefined,
        {
          targetBlockId: currentBlockId,
          blockIds: [currentBlockId],
          pageId,
          notebookId,
          processMode,
          outputFormat,
        }
      )
    } catch (err) {
      console.error('Failed to execute agent task:', err)
      updateAttributes({ status: 'failed' })
      setLoading(false)
      toast(truncateError(err instanceof Error ? err.message : (t.agentBlock.unknownError || 'Unknown error')), { type: 'error' })
    }
  }, [
    agentId,
    blockId,
    agents,
    localPrompt,
    additionalPrompt,
    taskId,
    processMode,
    outputFormat,
    getPageContext,
    updateAttributes,
    createEventHandler,
    t,
  ])

  // Handle cancel
  const handleCancel = useCallback(async () => {
    const cancelTaskId = executingTaskIdRef.current || taskId
    if (cancelTaskId) {
      try {
        await window.electron.agent.cancel(cancelTaskId)
      } catch (err) {
        console.error('Failed to cancel:', err)
        toast(t.agentBlock.cancelFailed || 'Failed to cancel task', { type: 'error' })
      }
      executingTaskIdRef.current = null
      setLoading(false)
      updateAttributes({ status: 'idle', error: null })
    }
  }, [taskId, updateAttributes, t])

  // Format duration
  const formatDuration = (ms: number | null) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  // Agent options for select
  const agentOptions = useMemo(
    () =>
      agents.map((a) => ({
        value: a.id,
        label: a.name,
        description: a.description,
      })),
    [agents]
  )

  // Output format options
  const formatOptions = useMemo(
    () => [
      { value: 'auto', label: t.agentBlock.formatAuto || 'Auto' },
      { value: 'paragraph', label: t.agentBlock.formatParagraph || 'Paragraph' },
      { value: 'list', label: t.agentBlock.formatList || 'List' },
      { value: 'table', label: t.agentBlock.formatTable || 'Table' },
      { value: 'code', label: t.agentBlock.formatCode || 'Code' },
      { value: 'quote', label: t.agentBlock.formatQuote || 'Quote' },
    ],
    [t]
  )

  const isRunning = loading || status === 'running'
  const hasRun = status === 'completed' || status === 'failed'
  const canExecute = !!agentId && !!localPrompt.trim() && !isRunning

  // Handle key press for single-line input
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    // 忽略 IME 输入法组合状态
    if (e.nativeEvent.isComposing) return

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canExecute) {
        handleExecute()
      }
    }
    // Delete block if input is empty and backspace is pressed
    if (e.key === 'Backspace' && !localPrompt) {
      e.preventDefault()
      // Cancel running task and cleanup listener before deleting
      if (executingTaskIdRef.current) {
        window.electron.agent.cancel(executingTaskIdRef.current)
        executingTaskIdRef.current = null
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
      deleteNode()
      // Focus editor
      requestAnimationFrame(() => {
        editor.commands.focus()
      })
    }
  }

  // Run button icon - show Play if text changed since last run
  const isPromptChanged = localPrompt !== additionalPrompt
  const getRunIcon = () => {
    if (isRunning) return <Loader2 size={14} className="animate-spin" />
    if (hasRun && !isPromptChanged) return <RotateCcw size={12} />
    return <Play size={12} />
  }

  return (
    <NodeViewWrapper className={`agent-block-wrapper ${selected ? 'selected' : ''}`}>
      <div className={`agent-block ${status}`}>
        {/* Main row: expand | input | format | agent | run */}
        <div className="agent-block-main" data-drag-handle>
          {/* Expand/Collapse button - left side, always render but hide when no content */}
          <button
            className={`agent-block-expand ${localOpen ? 'open' : ''} ${!hasContent ? 'hidden' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              const newOpen = !localOpen
              setLocalOpen(newOpen)
              // Defer attribute update to avoid immediate re-render
              requestAnimationFrame(() => {
                updateAttributes({ open: newOpen })
              })
            }}
            title={localOpen ? (t.agentBlock.collapse || 'Collapse') : (t.agentBlock.expand || 'Expand')}
          >
            <ChevronRight size={14} />
          </button>

          {/* Input area */}
          <div className="agent-block-input-wrapper" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              type="text"
              className="agent-block-input"
              placeholder={t.agentBlock.promptPlaceholder || 'Enter task description...'}
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onBlur={() => {
                if (localPrompt !== additionalPrompt) {
                  updateAttributes({ additionalPrompt: localPrompt })
                }
              }}
            />
          </div>

          {/* Right side controls */}
          <div className="agent-block-controls">
            {/* Duration indicator */}
            {hasRun && durationMs && (
              <span className="agent-block-duration">{formatDuration(durationMs)}</span>
            )}

            {/* Format select */}
            <div className="agent-block-format-select" onClick={(e) => e.stopPropagation()}>
              <Select
                options={formatOptions}
                value={outputFormat}
                onChange={(v) => updateAttributes({ outputFormat: v as AgentTaskOutputFormat })}
                compact
                alignRight
              />
            </div>

            {/* Agent select */}
            <div className="agent-block-agent-select" onClick={(e) => e.stopPropagation()}>
              {agentsLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Select
                  options={agentOptions}
                  value={agentId}
                  onChange={handleAgentChange}
                  placeholder={t.agentBlock.selectAgent || 'Agent'}
                  compact
                  alignRight
                  maxWidth={220}
                />
              )}
            </div>

            {/* Run/Cancel button */}
            <button
              className={`agent-block-run ${isRunning ? 'running' : ''} ${!canExecute && !isRunning ? 'disabled' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                if (isRunning) {
                  handleCancel()
                } else if (canExecute) {
                  handleExecute()
                }
              }}
              disabled={!canExecute && !isRunning}
              title={isRunning ? (t.agentBlock.cancel || 'Cancel') : (hasRun ? (t.agentBlock.rerun || 'Re-run') : (t.agentBlock.run || 'Run'))}
            >
              {getRunIcon()}
            </button>
          </div>
        </div>

        {/* Running output */}
        {isRunning && (contentOutput || editorOutput) && (
          <div ref={outputRef} className="agent-block-output">
            <div className="agent-block-output-text">
              {currentPhase === 'editor' ? editorOutput : contentOutput}
            </div>
          </div>
        )}

        {/* Child content (output) - always render, use CSS to hide */}
        <div className={`agent-block-content-wrapper ${!hasContent ? 'empty' : ''} ${!localOpen ? 'collapsed' : ''}`}>
          <NodeViewContent className="agent-block-content-inner" />
        </div>
      </div>
    </NodeViewWrapper>
  )
}

export default AgentBlockView
