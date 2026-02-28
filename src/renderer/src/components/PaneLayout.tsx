/**
 * PaneLayout - 分屏布局容器
 *
 * 参考 sanqian 的 WindowLayoutView 和 Obsidian 的架构实现
 * - 使用 react-mosaic-component 处理拖拽调整大小
 * - 使用绝对定位渲染各个 pane
 * - 支持拖拽交换 pane 位置
 * - 使用 paneId 作为布局标识，通过 getPaneNoteId 获取对应的 noteId
 */

import { useCallback, useState, useMemo } from 'react'
import { Mosaic, MosaicNode, getLeaves } from 'react-mosaic-component'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core'
import { useTabs } from '../contexts/TabContext'
import { EditorColumnShell } from './EditorColumnShell'

// ============================================================================
// Icons
// ============================================================================

const DragIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="9" cy="6" r="1.5" />
    <circle cx="15" cy="6" r="1.5" />
    <circle cx="9" cy="12" r="1.5" />
    <circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="18" r="1.5" />
    <circle cx="15" cy="18" r="1.5" />
  </svg>
)

// ============================================================================
// Draggable/Droppable Pane Wrapper
// ============================================================================

interface DraggablePaneWrapperProps {
  paneId: string
  isVisible: boolean
  isFocused: boolean
  position: { top: number; left: number; width: number; height: number } | undefined
  panelCount: number
  isDragging: boolean
  onFocus: () => void
  children: React.ReactNode
}

function DraggablePaneWrapper({
  paneId,
  isVisible,
  isFocused,
  position,
  panelCount,
  isDragging,
  onFocus,
  children,
}: DraggablePaneWrapperProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
  } = useDraggable({
    id: `pane-${paneId}`,
    data: { paneId },
  })

  const { setNodeRef: setDropRef } = useDroppable({
    id: `drop-${paneId}`,
    data: { paneId },
  })

  // 合并 ref
  const setNodeRef = useCallback((node: HTMLDivElement | null) => {
    setDragRef(node)
    setDropRef(node)
  }, [setDragRef, setDropRef])

  // 多 pane 时，非焦点 pane 内容使用透明度（背景不受影响）
  const unfocusedOpacity = panelCount > 1 && !isFocused

  return (
    <div
      ref={setNodeRef}
      className={`absolute flex flex-col group/pane ${isFocused ? 'z-10' : 'z-0'} ${isDragging ? 'opacity-50' : ''}`}
      style={isVisible && position ? {
        top: `${position.top}%`,
        left: `${position.left}%`,
        width: `${position.width}%`,
        height: `${position.height}%`,
        padding: 0,
      } : {
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        visibility: 'hidden',
        pointerEvents: 'none',
      }}
      onClick={onFocus}
    >
      {/* Container - 背景不受透明度影响，多 pane 时显示分隔线 */}
      <EditorColumnShell className={`relative bg-[var(--color-card-solid)] ${panelCount > 1 ? `border-[0.5px] ${isFocused ? 'border-black/15 dark:border-white/15' : 'border-black/5 dark:border-white/5'}` : ''}`}>
        {/* Drag handle with icon - 只在多 pane 时显示，与标题栏按钮垂直对齐 */}
        {panelCount > 1 && (
          <div
            {...attributes}
            {...listeners}
            className={`absolute top-[10px] left-3 z-20 opacity-30 hover:opacity-100 transition-opacity cursor-grab ${isDragging ? 'cursor-grabbing' : ''}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <div className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 text-[var(--color-text)]/60">
              <DragIcon />
            </div>
          </div>
        )}
        {/* Content wrapper - 只有内容使用透明度，确保在正确的层级 */}
        <EditorColumnShell className={`relative z-10 transition-opacity duration-150 ${unfocusedOpacity ? 'opacity-80' : ''}`}>
          {children}
        </EditorColumnShell>
      </EditorColumnShell>
    </div>
  )
}

// ============================================================================
// PaneLayout
// ============================================================================

interface PaneLayoutProps {
  /**
   * 渲染 pane 内容
   * @param paneId - pane 的唯一标识
   * @param noteId - pane 对应的笔记 ID（可能为 null 表示空 pane）
   * @param isFocused - 是否是焦点 pane
   * @param panelCount - 当前 tab 中的 pane 数量
   */
  renderPane: (paneId: string, noteId: string | null, isFocused: boolean, panelCount: number) => React.ReactNode
  renderEmpty?: () => React.ReactNode
}

export function PaneLayout({ renderPane, renderEmpty }: PaneLayoutProps) {
  const { activeTab, focusedPaneId, focusPane, updateLayout, swapPanes, getPaneNoteId } = useTabs()

  const [draggingPaneId, setDraggingPaneId] = useState<string | null>(null)

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10, // 拖动 10px 后才开始
      },
    })
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const paneId = event.active.data.current?.paneId as string
    if (paneId) {
      setDraggingPaneId(paneId)
    }
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const sourcePaneId = event.active.data.current?.paneId as string
    const targetPaneId = event.over?.data.current?.paneId as string

    if (sourcePaneId && targetPaneId && sourcePaneId !== targetPaneId) {
      swapPanes(sourcePaneId, targetPaneId)
    }

    setDraggingPaneId(null)
  }, [swapPanes])

  const handleDragCancel = useCallback(() => {
    setDraggingPaneId(null)
  }, [])

  const handleLayoutChange = useCallback((newLayout: MosaicNode<string> | null) => {
    if (newLayout) {
      updateLayout(newLayout)
    }
  }, [updateLayout])

  // 计算每个 pane 的位置
  const calculatePositions = useCallback((
    node: MosaicNode<string> | string,
    bounds = { top: 0, left: 0, width: 100, height: 100 }
  ): Record<string, { top: number; left: number; width: number; height: number }> => {
    if (typeof node === 'string') {
      return { [node]: bounds }
    }

    const split = node.splitPercentage ?? 50
    const isRow = node.direction === 'row'

    let firstBounds, secondBounds
    if (isRow) {
      firstBounds = { ...bounds, width: bounds.width * split / 100 }
      secondBounds = { ...bounds, left: bounds.left + firstBounds.width, width: bounds.width * (100 - split) / 100 }
    } else {
      firstBounds = { ...bounds, height: bounds.height * split / 100 }
      secondBounds = { ...bounds, top: bounds.top + firstBounds.height, height: bounds.height * (100 - split) / 100 }
    }

    return {
      ...calculatePositions(node.first, firstBounds),
      ...calculatePositions(node.second, secondBounds),
    }
  }, [])

  // 提取 layout 相关计算（useMemo 必须在条件返回之前调用）
  const layout = activeTab?.layout
  const hasValidLayout = !!layout && layout !== ''
  const panelCount = useMemo(() => {
    if (!hasValidLayout) return 0
    return typeof layout === 'string' ? 1 : getLeaves(layout).length
  }, [layout, hasValidLayout])
  const positions = useMemo(() => {
    if (!hasValidLayout) return {}
    return calculatePositions(layout)
  }, [layout, hasValidLayout, calculatePositions])
  const paneIds = useMemo(() => {
    if (!hasValidLayout) return []
    return typeof layout === 'string' ? [layout] : getLeaves(layout)
  }, [layout, hasValidLayout])

  // 没有 activeTab 或者空 layout
  if (!activeTab || !hasValidLayout) {
    if (renderEmpty) {
      return <EditorColumnShell>{renderEmpty()}</EditorColumnShell>
    }
    return <div className="flex-1 bg-[var(--color-card-solid)]" />
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <EditorColumnShell className="relative">
        {/* Panes */}
        {paneIds.map((paneId) => {
          const pos = positions[paneId]
          const isVisible = !!pos
          const isFocused = paneId === focusedPaneId
          const isDragging = paneId === draggingPaneId
          const noteId = getPaneNoteId(paneId)

          return (
            <DraggablePaneWrapper
              key={paneId}
              paneId={paneId}
              isVisible={isVisible}
              isFocused={isFocused}
              position={pos}
              panelCount={panelCount}
              isDragging={isDragging}
              onFocus={() => focusPane(paneId)}
            >
              {renderPane(paneId, noteId, isFocused, panelCount)}
            </DraggablePaneWrapper>
          )
        })}

        {/* Mosaic resize layer (invisible, only for drag handles) */}
        {panelCount > 1 && (
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 100 }}>
            <Mosaic<string>
              className="sanqian-notes-mosaic h-full mosaic-resize-only"
              value={layout as MosaicNode<string>}
              onChange={handleLayoutChange}
              renderTile={() => <div className="h-full w-full" style={{ background: 'transparent' }} />}
              resize={{ minimumPaneSizePercentage: 20 }}
            />
          </div>
        )}
      </EditorColumnShell>
    </DndContext>
  )
}

export default PaneLayout
