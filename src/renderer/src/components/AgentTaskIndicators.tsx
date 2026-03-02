/**
 * AgentTaskIndicators
 *
 * 在编辑器外部渲染所有 agent task 的圆点指示器
 * 通过获取 block DOM 元素的位置来定位圆点，确保所有圆点都在最左边对齐
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { Editor } from '@tiptap/react'
import { getTaskByBlockId, type AgentTaskCache } from '../utils/agentTaskStorage'
import type { AgentTaskStatus } from '../../../shared/types'

interface AgentTaskIndicatorsProps {
  editor: Editor | null
  containerRef: React.RefObject<HTMLElement>
  onOpenPanel: (blockIds: string[], taskId: string | null, blockContent: string) => void
}

interface IndicatorData {
  blockId: string
  taskId: string
  task: AgentTaskCache | null
  top: number
  left: number
  blockContent: string
}

// Status colors
const STATUS_COLORS: Record<AgentTaskStatus, string> = {
  idle: 'var(--color-muted)',
  running: 'var(--color-accent)',
  completed: 'var(--color-success, #22c55e)',
  failed: 'var(--color-error, #ef4444)',
}

export function AgentTaskIndicators({
  editor,
  containerRef,
  onOpenPanel,
}: AgentTaskIndicatorsProps) {
  const [indicators, setIndicators] = useState<IndicatorData[]>([])

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Calculate indicator positions
  const updateIndicators = useCallback(() => {
    if (!editor || !containerRef.current) {
      setIndicators([])
      return
    }

    const container = containerRef.current
    const containerRect = container.getBoundingClientRect()
    const scrollTop = container.scrollTop

    const newIndicators: IndicatorData[] = []

    // Find all blocks with agentTaskId
    editor.state.doc.descendants((node, pos) => {
      const taskId = node.attrs.agentTaskId
      if (!taskId) return

      const blockId = node.attrs.blockId
      if (!blockId) return

      // Get DOM element for this node
      const domNode = editor.view.nodeDOM(pos)
      if (!domNode || !(domNode instanceof HTMLElement)) return

      // Get position relative to container
      const nodeRect = domNode.getBoundingClientRect()
      // Vertically center the dot (6px) with the block
      const top = nodeRect.top - containerRect.top + scrollTop + (nodeRect.height / 2) - 3
      // Position to the left of block content (like H1 indicator)
      const left = nodeRect.left - containerRect.left - 16 // 16px to the left of content

      // Get task from cache
      const task = getTaskByBlockId(blockId)

      // Get block content
      const blockContent = node.textContent || ''

      newIndicators.push({
        blockId,
        taskId,
        task,
        top,
        left,
        blockContent,
      })
    })

    setIndicators(newIndicators)
  }, [editor, containerRef])

  // Debounced update to avoid excessive recalculations
  const debouncedUpdate = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      requestAnimationFrame(updateIndicators)
    }, 16) // ~60fps, minimal delay
  }, [updateIndicators])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Update on editor changes
  useEffect(() => {
    if (!editor) return undefined

    // Initial update (immediate, not debounced)
    updateIndicators()

    // Single transaction listener covers content changes (docChanged),
    // selection moves, and plugin state updates (refreshAgentTaskDecorations).
    // Uses 'transaction' instead of 'update' because note switching calls
    // setContent with emitUpdate:false which suppresses 'update'.
    editor.on('transaction', debouncedUpdate)

    return () => {
      editor.off('transaction', debouncedUpdate)
    }
  }, [editor, updateIndicators, debouncedUpdate])

  // Update on scroll (debounced)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    container.addEventListener('scroll', debouncedUpdate, { passive: true })
    return () => container.removeEventListener('scroll', debouncedUpdate)
  }, [containerRef, debouncedUpdate])

  // Update on window resize (debounced)
  useEffect(() => {
    window.addEventListener('resize', debouncedUpdate)
    return () => window.removeEventListener('resize', debouncedUpdate)
  }, [debouncedUpdate])

  if (indicators.length === 0) return null

  return (
    <div
      className="agent-task-indicators-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {indicators.map(({ blockId, task, top, left, blockContent }) => {
        const status = task?.status ?? 'idle'
        const isRunning = status === 'running'

        return (
          <div
            key={blockId}
            className="agent-task-indicator"
            data-status={status}
            onClick={() => onOpenPanel([blockId], task?.id ?? null, blockContent)}
            style={{
              position: 'absolute',
              // Position relative to block (like H1 indicator)
              left: `${left}px`,
              top: `${top}px`,
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: STATUS_COLORS[status],
              opacity: isRunning ? 1 : 0.2,
              cursor: 'pointer',
              pointerEvents: 'auto',
              transition: 'all 0.15s ease',
              animation: isRunning ? 'agent-task-pulse 1.5s ease-in-out infinite' : undefined,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = isRunning ? '1' : '0.2'
            }}
          />
        )
      })}
    </div>
  )
}

export default AgentTaskIndicators
