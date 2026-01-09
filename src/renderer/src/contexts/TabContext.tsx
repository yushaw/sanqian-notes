/**
 * TabContext - 多标签页 + 分屏系统状态管理
 *
 * 核心概念（参考 Obsidian 架构）：
 * - Tab: 顶部标签栏的一级单元
 * - Pane: Tab 内的分屏容器，有唯一 paneId
 * - Layout: paneId 组成的二叉树布局
 * - 一个 noteId 可以在多个 pane 中打开（同一笔记多视图）
 */

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from 'react'
import { MosaicNode, MosaicDirection, getLeaves } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'

// ============================================================================
// Types
// ============================================================================

export interface PaneState {
  noteId: string | null  // null 表示空 pane
}

export interface Tab {
  id: string
  layout: MosaicNode<string> | string  // paneId 的布局树
  panes: Record<string, PaneState>     // paneId -> { noteId }
  focusedPaneId: string | null         // 当前焦点 pane
  isPinned?: boolean
  createdAt: number
}

export interface TabContextValue {
  // 状态
  tabs: Tab[]
  activeTabId: string | null
  activeTab: Tab | null
  focusedPaneId: string | null   // 当前焦点 pane ID
  focusedNoteId: string | null   // 当前焦点 pane 对应的 noteId（派生）

  // Tab 操作
  createTab: (noteId?: string) => string
  closeTab: (tabId: string) => void
  closeTabs: (tabIds: string[]) => void  // 批量关闭，避免多次状态更新
  selectTab: (tabId: string) => void
  pinTab: (tabId: string) => void
  unpinTab: (tabId: string) => void
  reorderTabs: (oldIndex: number, newIndex: number) => void

  // Pane 操作 (在当前 Tab 内)
  openNoteInPane: (noteId: string) => void
  splitPane: (direction: MosaicDirection, options?: { fromPaneId?: string; noteId?: string }) => void
  closePane: (paneId: string) => void
  swapPanes: (sourcePaneId: string, targetPaneId: string) => void
  focusPane: (paneId: string) => void
  updateLayout: (layout: MosaicNode<string> | string) => void

  // Pane 辅助
  getPaneNoteId: (paneId: string) => string | null

  // 辅助
  isNoteOpenInAnyTab: (noteId: string) => boolean
  getOpenNoteIds: () => string[]
  getTabDisplayTitle: (tab: Tab, getNoteTitle: (id: string) => string) => string
}

const TabContext = createContext<TabContextValue | null>(null)

export function useTabs(): TabContextValue {
  const ctx = useContext(TabContext)
  if (!ctx) {
    throw new Error('useTabs must be used within TabProvider')
  }
  return ctx
}

// ============================================================================
// LocalStorage Keys & Helpers
// ============================================================================

const TABS_STORAGE_KEY = 'sanqian_notes_tabs_v2'  // 新版本 key
const ACTIVE_TAB_KEY = 'sanqian_notes_active_tab'
const LAYOUT_PERCENTAGES_KEY = 'sanqian_notes_layout_percentages'

// 旧版 keys（用于迁移）
const OLD_TABS_KEY = 'sanqian_notes_tabs'
const OLD_NOTE_KEY = 'sanqian-notes-last-note'

function generateTabId(): string {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function generatePaneId(): string {
  return `pane_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

// ============================================================================
// Migration: 旧格式 -> 新格式
// ============================================================================

interface OldTab {
  id: string
  layout: MosaicNode<string> | string  // 旧格式中这里存的是 noteId
  focusedNoteId: string | null
  isPinned?: boolean
  createdAt: number
}

function migrateOldTab(oldTab: OldTab): Tab {
  // 旧格式中 layout 存的是 noteId，需要转换为 paneId
  const panes: Record<string, PaneState> = {}
  const noteIdToPaneId: Record<string, string> = {}

  // 遍历 layout 中的所有 noteId，为每个生成 paneId
  const collectNoteIds = (node: MosaicNode<string> | string): void => {
    if (typeof node === 'string') {
      if (!noteIdToPaneId[node]) {
        const paneId = generatePaneId()
        noteIdToPaneId[node] = paneId
        panes[paneId] = { noteId: node || null }
      }
    } else {
      collectNoteIds(node.first)
      collectNoteIds(node.second)
    }
  }

  if (oldTab.layout) {
    collectNoteIds(oldTab.layout)
  }

  // 转换 layout 中的 noteId 为 paneId
  const convertLayout = (node: MosaicNode<string> | string): MosaicNode<string> | string => {
    if (typeof node === 'string') {
      return noteIdToPaneId[node] || node
    }
    return {
      ...node,
      first: convertLayout(node.first),
      second: convertLayout(node.second),
    }
  }

  const newLayout = oldTab.layout ? convertLayout(oldTab.layout) : ''
  const focusedPaneId = oldTab.focusedNoteId ? noteIdToPaneId[oldTab.focusedNoteId] || null : null

  return {
    id: oldTab.id,
    layout: newLayout,
    panes,
    focusedPaneId,
    isPinned: oldTab.isPinned,
    createdAt: oldTab.createdAt,
  }
}

function loadTabs(): Tab[] {
  try {
    // 先尝试加载新格式
    const saved = localStorage.getItem(TABS_STORAGE_KEY)
    if (saved) {
      const tabs = JSON.parse(saved) as Tab[]
      // 验证格式正确（有 panes 字段）
      if (tabs.length > 0 && tabs[0].panes !== undefined) {
        return tabs
      }
    }

    // 尝试迁移旧格式
    const oldSaved = localStorage.getItem(OLD_TABS_KEY)
    if (oldSaved) {
      const oldTabs = JSON.parse(oldSaved) as OldTab[]
      if (oldTabs.length > 0) {
        const migratedTabs = oldTabs.map(migrateOldTab)
        // 保存新格式并删除旧格式
        localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(migratedTabs))
        localStorage.removeItem(OLD_TABS_KEY)
        console.log('[TabContext] Migrated', oldTabs.length, 'tabs to new format')
        return migratedTabs
      }
    }

    // 尝试迁移更旧的单 note 格式
    const oldNoteId = localStorage.getItem(OLD_NOTE_KEY)
    if (oldNoteId) {
      const paneId = generatePaneId()
      const migratedTab: Tab = {
        id: generateTabId(),
        layout: paneId,
        panes: { [paneId]: { noteId: oldNoteId } },
        focusedPaneId: paneId,
        createdAt: Date.now(),
      }
      localStorage.removeItem(OLD_NOTE_KEY)
      return [migratedTab]
    }
  } catch (e) {
    console.error('Failed to load tabs:', e)
  }
  return []
}

function saveTabs(tabs: Tab[]): void {
  try {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs))
  } catch (e) {
    console.error('Failed to save tabs:', e)
  }
}

function loadActiveTabId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TAB_KEY)
  } catch {
    return null
  }
}

function saveActiveTabId(tabId: string | null): void {
  try {
    if (tabId) {
      localStorage.setItem(ACTIVE_TAB_KEY, tabId)
    } else {
      localStorage.removeItem(ACTIVE_TAB_KEY)
    }
  } catch (e) {
    console.error('Failed to save active tab:', e)
  }
}

// Layout percentage helpers

function saveLayoutPercentages(tabId: string, percentages: Record<string, number>): void {
  try {
    const cached = localStorage.getItem(LAYOUT_PERCENTAGES_KEY)
    const all = cached ? JSON.parse(cached) : {}
    all[tabId] = percentages
    localStorage.setItem(LAYOUT_PERCENTAGES_KEY, JSON.stringify(all))
  } catch (e) {
    console.error('Failed to save layout percentages:', e)
  }
}

function removeLayoutPercentages(tabId: string): void {
  try {
    const cached = localStorage.getItem(LAYOUT_PERCENTAGES_KEY)
    if (cached) {
      const all = JSON.parse(cached)
      delete all[tabId]
      localStorage.setItem(LAYOUT_PERCENTAGES_KEY, JSON.stringify(all))
    }
  } catch (e) {
    console.error('Failed to remove layout percentages:', e)
  }
}

// Generate a stable key for a split node based on its children
function getNodeKey(node: MosaicNode<string>): string {
  if (typeof node === 'string') return node
  const firstKey = typeof node.first === 'string' ? node.first : getNodeKey(node.first)
  const secondKey = typeof node.second === 'string' ? node.second : getNodeKey(node.second)
  return `${firstKey}|${secondKey}`
}

// Strip percentages from layout (for storage - we store percentages separately)
function stripPercentages(layout: MosaicNode<string> | string): MosaicNode<string> | string {
  if (typeof layout === 'string') return layout
  return {
    direction: layout.direction,
    first: stripPercentages(layout.first),
    second: stripPercentages(layout.second),
  }
}

// Extract percentages from layout
function extractPercentages(layout: MosaicNode<string> | string): Record<string, number> {
  const percentages: Record<string, number> = {}
  const extract = (node: MosaicNode<string> | string): void => {
    if (typeof node === 'string') return
    const key = getNodeKey(node)
    if (node.splitPercentage !== undefined) {
      percentages[key] = node.splitPercentage
    }
    extract(node.first)
    extract(node.second)
  }
  extract(layout)
  return percentages
}

// Get all pane IDs from a layout
function getLayoutPaneIds(layout: MosaicNode<string> | string): string[] {
  if (typeof layout === 'string') return [layout]
  return getLeaves(layout)
}

// ============================================================================
// Provider
// ============================================================================

interface TabProviderProps {
  children: ReactNode
}

export function TabProvider({ children }: TabProviderProps): JSX.Element {
  // 使用单次初始化避免重复调用 loadTabs()
  const [{ tabs: initialTabs, activeTabId: initialActiveTabId }] = useState(() => {
    const savedTabs = loadTabs()
    const savedActiveId = loadActiveTabId()
    const activeId = savedActiveId && savedTabs.some((t) => t.id === savedActiveId)
      ? savedActiveId
      : savedTabs[0]?.id || null
    return { tabs: savedTabs, activeTabId: activeId }
  })

  const [tabs, setTabs] = useState<Tab[]>(initialTabs)
  const [activeTabId, setActiveTabId] = useState<string | null>(initialActiveTabId)

  // Layout cache for comparison
  const layoutCacheRef = useRef<{ full: string; structure: string } | null>(null)

  // 派生状态
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) || null, [tabs, activeTabId])

  const focusedPaneId = useMemo(() => {
    if (!activeTab) return null
    return activeTab.focusedPaneId
  }, [activeTab])

  const focusedNoteId = useMemo(() => {
    if (!activeTab || !activeTab.focusedPaneId) return null
    return activeTab.panes[activeTab.focusedPaneId]?.noteId || null
  }, [activeTab])

  // 持久化 tabs
  useEffect(() => {
    saveTabs(tabs)
  }, [tabs])

  // 持久化 activeTabId
  useEffect(() => {
    saveActiveTabId(activeTabId)
  }, [activeTabId])

  // ============================================================================
  // Pane 辅助
  // ============================================================================

  const getPaneNoteId = useCallback(
    (paneId: string): string | null => {
      if (!activeTab) return null
      return activeTab.panes[paneId]?.noteId || null
    },
    [activeTab]
  )

  // ============================================================================
  // Tab 操作
  // ============================================================================

  const createTab = useCallback((noteId?: string): string => {
    const tabId = generateTabId()
    const paneId = generatePaneId()

    const newTab: Tab = {
      id: tabId,
      layout: noteId ? paneId : '',  // 空 tab 用空字符串
      panes: noteId ? { [paneId]: { noteId } } : {},
      focusedPaneId: noteId ? paneId : null,
      createdAt: Date.now(),
    }

    setTabs((prev) => [...prev, newTab])
    setActiveTabId(tabId)

    return tabId
  }, [])

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId)
        if (idx === -1) return prev

        const newTabs = prev.filter((t) => t.id !== tabId)
        removeLayoutPercentages(tabId)

        // 如果关闭的是当前 tab，切换到相邻 tab
        if (tabId === activeTabId && newTabs.length > 0) {
          const newIdx = Math.min(idx, newTabs.length - 1)
          setActiveTabId(newTabs[newIdx].id)
        } else if (newTabs.length === 0) {
          setActiveTabId(null)
        }

        return newTabs
      })
    },
    [activeTabId]
  )

  // 批量关闭 tabs（一次性更新状态，避免多次 setTabs）
  const closeTabs = useCallback(
    (tabIds: string[]) => {
      if (tabIds.length === 0) return

      setTabs((prev) => {
        const tabIdSet = new Set(tabIds)

        // 清理 layout percentages
        tabIds.forEach((tabId) => removeLayoutPercentages(tabId))

        const newTabs = prev.filter((t) => !tabIdSet.has(t.id))

        // 如果关闭的包含当前 tab，切换到相邻 tab
        if (activeTabId && tabIdSet.has(activeTabId) && newTabs.length > 0) {
          // 找到关闭的 tab 中最小的 index
          const closedIndices = prev
            .map((t, i) => (tabIdSet.has(t.id) ? i : -1))
            .filter((i) => i !== -1)
          const minClosedIndex = Math.min(...closedIndices)
          const newIdx = Math.min(minClosedIndex, newTabs.length - 1)
          setActiveTabId(newTabs[newIdx].id)
        } else if (newTabs.length === 0) {
          setActiveTabId(null)
        }

        return newTabs
      })
    },
    [activeTabId]
  )

  const selectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId)
  }, [])

  const pinTab = useCallback((tabId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isPinned: true } : t)))
  }, [])

  const unpinTab = useCallback((tabId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, isPinned: false } : t)))
  }, [])


  const reorderTabs = useCallback((oldIndex: number, newIndex: number) => {
    if (oldIndex === newIndex) return
    setTabs((prev) => {
      const newTabs = [...prev]
      const [removed] = newTabs.splice(oldIndex, 1)
      newTabs.splice(newIndex, 0, removed)
      return newTabs
    })
  }, [])

  // ============================================================================
  // Pane 操作
  // ============================================================================

  const openNoteInPane = useCallback(
    (noteId: string) => {
      if (!activeTabId) {
        createTab(noteId)
        return
      }

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab

          // 如果当前 tab 是空的，创建新 pane
          if (!tab.layout || tab.layout === '') {
            const paneId = generatePaneId()
            return {
              ...tab,
              layout: paneId,
              panes: { [paneId]: { noteId } },
              focusedPaneId: paneId,
            }
          }

          // 如果没有焦点 pane，选择第一个
          const currentFocusedPaneId = tab.focusedPaneId || getLayoutPaneIds(tab.layout)[0]
          if (!currentFocusedPaneId) return tab

          // 更新焦点 pane 的 noteId
          return {
            ...tab,
            panes: {
              ...tab.panes,
              [currentFocusedPaneId]: { noteId },
            },
            focusedPaneId: currentFocusedPaneId,
          }
        })
      )
    },
    [activeTabId, createTab]
  )

  const splitPane = useCallback(
    (direction: MosaicDirection, options?: { fromPaneId?: string; noteId?: string }) => {
      if (!activeTabId || !activeTab) return

      const { fromPaneId, noteId } = options || {}
      const currentLayout = activeTab.layout
      // 如果指定了 fromPaneId，使用它；否则使用当前焦点 pane
      const targetPaneId = fromPaneId || activeTab.focusedPaneId

      if (!currentLayout || currentLayout === '' || !targetPaneId) {
        return
      }

      // 创建新 pane
      const newPaneId = generatePaneId()

      // 在焦点 pane 处分屏
      const splitAtNode = (
        layout: MosaicNode<string> | string,
        targetPaneId: string
      ): MosaicNode<string> | string => {
        if (typeof layout === 'string') {
          if (layout === targetPaneId) {
            return {
              direction,
              first: layout,
              second: newPaneId,
              splitPercentage: 50,
            }
          }
          return layout
        }
        return {
          ...layout,
          first: splitAtNode(layout.first, targetPaneId),
          second: splitAtNode(layout.second, targetPaneId),
        }
      }

      const newLayout = splitAtNode(currentLayout, targetPaneId)

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab
          return {
            ...tab,
            layout: newLayout,
            panes: {
              ...tab.panes,
              [newPaneId]: { noteId: noteId || null },
            },
            focusedPaneId: newPaneId,
          }
        })
      )
    },
    [activeTabId, activeTab]
  )

  const closePane = useCallback(
    (paneId: string) => {
      if (!activeTabId || !activeTab) return

      const currentLayout = activeTab.layout

      // 如果只有一个 pane，关闭整个 tab
      if (typeof currentLayout === 'string') {
        closeTab(activeTabId)
        return
      }

      // 从布局中移除 pane
      const removeFromLayout = (
        layout: MosaicNode<string> | string
      ): MosaicNode<string> | string | null => {
        if (typeof layout === 'string') {
          return layout === paneId ? null : layout
        }

        const first = removeFromLayout(layout.first)
        const second = removeFromLayout(layout.second)

        if (first === null) return second
        if (second === null) return first

        return {
          ...layout,
          first,
          second,
        }
      }

      const newLayout = removeFromLayout(currentLayout)

      if (newLayout === null) {
        closeTab(activeTabId)
        return
      }

      // 确定新的焦点 pane
      const remainingPaneIds = getLayoutPaneIds(newLayout)
      const newFocusedPaneId = remainingPaneIds[0] || null

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab
          // 移除关闭的 pane
          const newPanes = { ...tab.panes }
          delete newPanes[paneId]
          return {
            ...tab,
            layout: newLayout,
            panes: newPanes,
            focusedPaneId: newFocusedPaneId,
          }
        })
      )
    },
    [activeTabId, activeTab, closeTab]
  )

  const swapPanes = useCallback(
    (sourcePaneId: string, targetPaneId: string) => {
      if (!activeTabId || !activeTab || sourcePaneId === targetPaneId) return

      const swapInLayout = (
        layout: MosaicNode<string> | string
      ): MosaicNode<string> | string => {
        if (typeof layout === 'string') {
          if (layout === sourcePaneId) return targetPaneId
          if (layout === targetPaneId) return sourcePaneId
          return layout
        }
        return {
          ...layout,
          first: swapInLayout(layout.first),
          second: swapInLayout(layout.second),
        }
      }

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab
          return {
            ...tab,
            layout: swapInLayout(tab.layout),
          }
        })
      )
    },
    [activeTabId, activeTab]
  )

  const focusPane = useCallback(
    (paneId: string) => {
      if (!activeTabId) return

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab
          return {
            ...tab,
            focusedPaneId: paneId,
          }
        })
      )
    },
    [activeTabId]
  )

  const updateLayout = useCallback(
    (layout: MosaicNode<string> | string) => {
      if (!activeTabId || !activeTab) return

      const newLayoutStr = JSON.stringify(layout)

      // Skip if layout hasn't actually changed
      if (layoutCacheRef.current?.full === newLayoutStr) return

      const newStructure = JSON.stringify(stripPercentages(layout))
      layoutCacheRef.current = { full: newLayoutStr, structure: newStructure }

      // 保存百分比到 localStorage
      const percentages = extractPercentages(layout)
      saveLayoutPercentages(activeTabId, percentages)

      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab
          return {
            ...tab,
            layout,
          }
        })
      )
    },
    [activeTabId, activeTab]
  )

  // ============================================================================
  // 辅助方法
  // ============================================================================

  const isNoteOpenInAnyTab = useCallback(
    (noteId: string): boolean => {
      return tabs.some((tab) => {
        return Object.values(tab.panes).some((pane) => pane.noteId === noteId)
      })
    },
    [tabs]
  )

  const getOpenNoteIds = useCallback((): string[] => {
    const ids = new Set<string>()
    tabs.forEach((tab) => {
      Object.values(tab.panes).forEach((pane) => {
        if (pane.noteId) {
          ids.add(pane.noteId)
        }
      })
    })
    return Array.from(ids)
  }, [tabs])

  const getTabDisplayTitle = useCallback(
    (tab: Tab, getNoteTitle: (id: string) => string): string => {
      // 优先使用焦点 pane 的 noteId
      if (tab.focusedPaneId) {
        const noteId = tab.panes[tab.focusedPaneId]?.noteId
        if (noteId) {
          const title = getNoteTitle(noteId)
          if (title) return title
        }
      }
      // fallback: 使用第一个有 noteId 的 pane
      const firstNoteId = Object.values(tab.panes).find((p) => p.noteId)?.noteId
      if (firstNoteId) {
        const title = getNoteTitle(firstNoteId)
        if (title) return title
      }
      return 'New Tab'
    },
    []
  )

  // ============================================================================
  // Context Value
  // ============================================================================

  const contextValue: TabContextValue = {
    tabs,
    activeTabId,
    activeTab,
    focusedPaneId,
    focusedNoteId,
    createTab,
    closeTab,
    closeTabs,
    selectTab,
    pinTab,
    unpinTab,
    reorderTabs,
    openNoteInPane,
    splitPane,
    closePane,
    swapPanes,
    focusPane,
    updateLayout,
    getPaneNoteId,
    isNoteOpenInAnyTab,
    getOpenNoteIds,
    getTabDisplayTitle,
  }

  return <TabContext.Provider value={contextValue}>{children}</TabContext.Provider>
}

export default TabProvider
