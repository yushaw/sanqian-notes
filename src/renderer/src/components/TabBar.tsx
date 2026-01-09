/**
 * TabBar - 顶部标签栏组件
 *
 * 显示打开的 Tab 列表，支持：
 * - 切换 Tab
 * - 关闭 Tab
 * - 新建 Tab
 * - 固定 Tab
 * - 右键菜单
 * - 拖拽排序
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import { useTabs, type Tab } from '../contexts/TabContext'
import { useTranslations } from '../i18n'

// ============================================================================
// Icons
// ============================================================================

const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2 2L10 10M10 2L2 10" />
  </svg>
)

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const PinIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
    <path d="M12 2L9.5 9.5L2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2z" />
  </svg>
)

// ============================================================================
// Context Menu
// ============================================================================

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  tabId: string | null
  isPinned: boolean
}

interface ContextMenuProps {
  state: ContextMenuState
  onClose: () => void
  onCloseTab: (tabId: string) => void
  onCloseOthers: (tabId: string) => void
  onCloseAll: () => void
  onPin: (tabId: string) => void
  onUnpin: (tabId: string) => void
}

function ContextMenu({
  state,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onPin,
  onUnpin,
}: ContextMenuProps) {
  const t = useTranslations()

  useEffect(() => {
    const handleClick = () => onClose()
    if (state.visible) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [state.visible, onClose])

  if (!state.visible || !state.tabId) return null

  return (
    <div
      className="fixed z-[100] py-1 bg-[var(--color-card)] rounded-lg shadow-lg border border-black/5 dark:border-white/10 min-w-[140px]"
      style={{ left: state.x, top: state.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {state.isPinned ? (
        <button
          onClick={() => { onUnpin(state.tabId!); onClose() }}
          className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text)]/80 hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-2"
        >
          <PinIcon />
          {t.tabBar?.unpin || 'Unpin'}
        </button>
      ) : (
        <button
          onClick={() => { onPin(state.tabId!); onClose() }}
          className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text)]/80 hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-2"
        >
          <PinIcon />
          {t.tabBar?.pin || 'Pin'}
        </button>
      )}

      <div className="h-px bg-black/5 dark:bg-white/10 my-1" />

      <button
        onClick={() => { onCloseTab(state.tabId!); onClose() }}
        className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text)]/80 hover:bg-black/5 dark:hover:bg-white/10"
      >
        {t.tabBar?.close || 'Close'}
      </button>
      <button
        onClick={() => { onCloseOthers(state.tabId!); onClose() }}
        className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text)]/80 hover:bg-black/5 dark:hover:bg-white/10"
      >
        {t.tabBar?.closeOthers || 'Close Others'}
      </button>
      <button
        onClick={() => { onCloseAll(); onClose() }}
        className="w-full px-3 py-1.5 text-left text-sm text-[var(--color-text)]/80 hover:bg-black/5 dark:hover:bg-white/10"
      >
        {t.tabBar?.closeAll || 'Close All'}
      </button>
    </div>
  )
}

// ============================================================================
// Sortable Tab Item
// ============================================================================

interface SortableTabItemProps {
  tab: Tab
  isActive: boolean
  title: string
  onSelect: () => void
  onClose: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onMiddleClick: () => void
}

function SortableTabItem({
  tab,
  isActive,
  title,
  onSelect,
  onClose,
  onContextMenu,
  onMiddleClick,
}: SortableTabItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id })

  // 只使用 translate，忽略 scale（避免宽度被缩放）
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition: transition ? 'transform 200ms ease' : undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : undefined,
  }

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 中键点击关闭
    if (e.button === 1) {
      e.preventDefault()
      onMiddleClick()
    }
  }, [onMiddleClick])

  const handleCloseClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onClose()
  }, [onClose])

  return (
    <div
      ref={setSortableRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`
        group relative flex items-center h-full max-w-[200px] pl-3 pr-2 cursor-grab select-none
        border-r border-black/5 dark:border-white/5
        transition-colors duration-100
        ${isDragging ? 'cursor-grabbing' : ''}
        ${isActive
          ? 'bg-[var(--color-card-solid)] text-[var(--color-text)]'
          : 'bg-transparent text-[var(--color-text)]/60 hover:text-[var(--color-text)]/80 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]'
        }
      `}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onMouseDown={handleMouseDown}
    >
      {/* Pin indicator */}
      {tab.isPinned && (
        <span className="text-[var(--color-text)]/40 mr-1.5 flex-shrink-0">
          <PinIcon filled />
        </span>
      )}

      {/* Title */}
      <span className="truncate text-[13px]">{title}</span>

      {/* Close button with gradient mask - hover 时显示并遮盖标题尾部 */}
      {!tab.isPinned && (
        <div
          className={`
            absolute right-0 top-0 bottom-0 flex items-center pr-1.5 pl-4
            opacity-0 group-hover:opacity-100 transition-opacity
            ${isActive
              ? 'bg-gradient-to-l from-[var(--color-card-solid)] via-[var(--color-card-solid)] to-transparent'
              : 'bg-gradient-to-l from-[var(--color-bg)] via-[var(--color-bg)] to-transparent group-hover:from-[color-mix(in_srgb,var(--color-bg),black_2%)] group-hover:via-[color-mix(in_srgb,var(--color-bg),black_2%)] dark:group-hover:from-[color-mix(in_srgb,var(--color-bg),white_2%)] dark:group-hover:via-[color-mix(in_srgb,var(--color-bg),white_2%)]'
            }
          `}
        >
          <button
            onClick={handleCloseClick}
            className="p-0.5 rounded opacity-60 hover:!opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Active indicator */}
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-px bg-[var(--color-accent)] opacity-30" />
      )}
    </div>
  )
}

// ============================================================================
// TabBar
// ============================================================================

interface TabBarProps {
  getNoteTitle: (noteId: string) => string
}

export function TabBar({ getNoteTitle }: TabBarProps) {
  const {
    tabs,
    activeTabId,
    createTab,
    closeTab,
    closeTabs,
    selectTab,
    pinTab,
    unpinTab,
    getTabDisplayTitle,
    reorderTabs,
  } = useTabs()

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    tabId: null,
    isPinned: false,
  })

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 拖动 8px 后才开始
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // 不再自动排序固定的 tab 在前，让用户自己控制顺序
  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs])

  // 处理拖拽结束
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex((t) => t.id === active.id)
      const newIndex = tabs.findIndex((t) => t.id === over.id)
      reorderTabs(oldIndex, newIndex)
    }
  }, [tabs, reorderTabs])

  const handleContextMenu = useCallback((e: React.MouseEvent, tab: Tab) => {
    e.preventDefault()
    e.stopPropagation()

    const menuWidth = 150
    const menuHeight = 150
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10)
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10)

    setContextMenu({
      visible: true,
      x,
      y,
      tabId: tab.id,
      isPinned: !!tab.isPinned,
    })
  }, [])

  // 批量关闭其他 tabs（一次性更新，避免多次 setTabs）
  const handleCloseOthers = useCallback((tabId: string) => {
    const tabsToClose = tabs
      .filter((tab) => tab.id !== tabId && !tab.isPinned)
      .map((tab) => tab.id)
    closeTabs(tabsToClose)
  }, [tabs, closeTabs])

  // 批量关闭所有 tabs（一次性更新）
  const handleCloseAll = useCallback(() => {
    const tabsToClose = tabs
      .filter((tab) => !tab.isPinned)
      .map((tab) => tab.id)
    closeTabs(tabsToClose)
  }, [tabs, closeTabs])

  const handleNewTab = useCallback(() => {
    createTab()
  }, [createTab])

  // 只有一个或没有 tab 时不显示 TabBar
  if (tabs.length <= 1) {
    return null
  }

  return (
    <>
      <div
        className="flex items-center h-[42px] bg-[var(--color-bg)] border-b border-black/5 dark:border-white/5 overflow-y-hidden tabbar-scroll"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Tabs with DnD */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
            <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              {tabs.map((tab) => (
                <SortableTabItem
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  title={getTabDisplayTitle(tab, getNoteTitle)}
                  onSelect={() => selectTab(tab.id)}
                  onClose={() => closeTab(tab.id)}
                  onContextMenu={(e) => handleContextMenu(e, tab)}
                  onMiddleClick={() => closeTab(tab.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* New Tab Button */}
        <button
          onClick={handleNewTab}
          className="flex-shrink-0 p-2 text-[var(--color-text)]/40 hover:text-[var(--color-text)]/70 hover:bg-black/5 dark:hover:bg-white/5 rounded transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="New Tab"
        >
          <PlusIcon />
        </button>
      </div>

      {/* Context Menu */}
      <ContextMenu
        state={contextMenu}
        onClose={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
        onCloseTab={closeTab}
        onCloseOthers={handleCloseOthers}
        onCloseAll={handleCloseAll}
        onPin={pinTab}
        onUnpin={unpinTab}
      />
    </>
  )
}

export default TabBar
