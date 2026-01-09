/**
 * TabBar 组件测试
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TabBar } from '../TabBar'
import type { Tab, TabContextValue } from '../../contexts/TabContext'

// Mock useTabs
const mockUseTabs = vi.fn<() => Partial<TabContextValue>>()

vi.mock('../../contexts/TabContext', () => ({
  useTabs: () => mockUseTabs(),
}))

// Mock useTranslations
vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    tabBar: {
      pin: 'Pin',
      unpin: 'Unpin',
      close: 'Close',
      closeOthers: 'Close Others',
      closeAll: 'Close All',
    },
  }),
}))

const createMockTab = (id: string, noteId: string, isPinned = false): Tab => {
  const paneId = `pane_${id}`
  return {
    id,
    layout: paneId,
    panes: { [paneId]: { noteId } },
    focusedPaneId: paneId,
    isPinned,
    createdAt: Date.now(),
  }
}

describe('TabBar', () => {
  const defaultMockContext: Partial<TabContextValue> = {
    tabs: [],
    activeTabId: null,
    createTab: vi.fn(),
    closeTab: vi.fn(),
    closeTabs: vi.fn(),
    selectTab: vi.fn(),
    pinTab: vi.fn(),
    unpinTab: vi.fn(),
    getTabDisplayTitle: (tab: Tab, getNoteTitle: (id: string) => string) => {
      // 从 focusedPaneId 获取对应的 noteId
      const noteId = tab.focusedPaneId ? tab.panes[tab.focusedPaneId]?.noteId : null
      if (noteId) {
        const title = getNoteTitle(noteId)
        if (title) return title
      }
      return 'New Tab'
    },
    reorderTabs: vi.fn(),
  }

  const mockGetNoteTitle = (noteId: string) => {
    const titles: Record<string, string> = {
      note_1: 'First Note',
      note_2: 'Second Note',
      note_3: 'Third Note',
    }
    return titles[noteId] || 'Untitled'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTabs.mockReturnValue(defaultMockContext)
  })

  afterEach(() => {
    cleanup()
  })

  // ============================================================================
  // Basic Rendering Tests
  // ============================================================================

  describe('rendering', () => {
    it('renders nothing when no tabs exist', () => {
      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs: [],
      })

      const { container } = render(<TabBar getNoteTitle={mockGetNoteTitle} />)
      expect(container.firstChild).toBeNull()
    })

    it('renders tabs with correct titles', () => {
      const tabs = [
        createMockTab('tab_1', 'note_1'),
        createMockTab('tab_2', 'note_2'),
      ]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      expect(screen.getByText('First Note')).toBeInTheDocument()
      expect(screen.getByText('Second Note')).toBeInTheDocument()
    })

    it('shows new tab button', () => {
      const tabs = [createMockTab('tab_1', 'note_1'), createMockTab('tab_2', 'note_2')]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      const newTabButton = screen.getByTitle('New Tab')
      expect(newTabButton).toBeInTheDocument()
    })

    it('shows pin indicator for pinned tabs', () => {
      const tabs = [createMockTab('tab_1', 'note_1', true), createMockTab('tab_2', 'note_2')]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      // Pinned tab should have an SVG icon
      const tabElement = screen.getByText('First Note').closest('div')
      expect(tabElement?.querySelector('svg')).toBeInTheDocument()
    })
  })

  // ============================================================================
  // Tab Selection Tests
  // ============================================================================

  describe('tab selection', () => {
    it('calls selectTab when clicking a tab', () => {
      const selectTab = vi.fn()
      const tabs = [
        createMockTab('tab_1', 'note_1'),
        createMockTab('tab_2', 'note_2'),
      ]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
        selectTab,
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      fireEvent.click(screen.getByText('Second Note'))

      expect(selectTab).toHaveBeenCalledWith('tab_2')
    })
  })

  // ============================================================================
  // Tab Closing Tests
  // ============================================================================

  describe('tab closing', () => {
    it('calls closeTab when clicking close button', () => {
      const closeTab = vi.fn()
      const tabs = [createMockTab('tab_1', 'note_1'), createMockTab('tab_2', 'note_2')]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
        closeTab,
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      // Find close button (it's hidden by default, but still in DOM)
      const tabElement = screen.getByText('First Note').closest('div')
      const closeButton = tabElement?.querySelector('button')

      if (closeButton) {
        fireEvent.click(closeButton)
        expect(closeTab).toHaveBeenCalledWith('tab_1')
      }
    })

    it('calls closeTab on middle click', () => {
      const closeTab = vi.fn()
      const tabs = [createMockTab('tab_1', 'note_1'), createMockTab('tab_2', 'note_2')]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
        closeTab,
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      const tabText = screen.getByText('First Note')

      // Simulate middle mouse button
      fireEvent.mouseDown(tabText, { button: 1 })

      expect(closeTab).toHaveBeenCalledWith('tab_1')
    })

    it('does not show close button for pinned tabs', () => {
      const tabs = [createMockTab('tab_1', 'note_1', true), createMockTab('tab_2', 'note_2')]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      const tabElement = screen.getByText('First Note').closest('div')
      // Pinned tabs should not have close button inside the clickable area
      const buttons = tabElement?.querySelectorAll('button')
      expect(buttons?.length).toBe(0)
    })
  })

  // ============================================================================
  // New Tab Tests
  // ============================================================================

  describe('new tab', () => {
    it('calls createTab when clicking new tab button', () => {
      const createTab = vi.fn()
      const tabs = [createMockTab('tab_1', 'note_1'), createMockTab('tab_2', 'note_2')]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
        createTab,
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      fireEvent.click(screen.getByTitle('New Tab'))

      expect(createTab).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // Context Menu Tests
  // ============================================================================

  describe('context menu', () => {
    it('opens context menu on right click', () => {
      const tabs = [createMockTab('tab_1', 'note_1'), createMockTab('tab_2', 'note_2')]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      fireEvent.contextMenu(screen.getByText('First Note'))

      expect(screen.getByText('Close')).toBeInTheDocument()
      expect(screen.getByText('Close Others')).toBeInTheDocument()
      expect(screen.getByText('Close All')).toBeInTheDocument()
    })

    it('shows Pin option for unpinned tab', () => {
      const tabs = [createMockTab('tab_1', 'note_1', false), createMockTab('tab_2', 'note_2')]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      fireEvent.contextMenu(screen.getByText('First Note'))

      expect(screen.getByText('Pin')).toBeInTheDocument()
    })

    it('shows Unpin option for pinned tab', () => {
      const tabs = [createMockTab('tab_1', 'note_1', true), createMockTab('tab_2', 'note_2')]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      fireEvent.contextMenu(screen.getByText('First Note'))

      expect(screen.getByText('Unpin')).toBeInTheDocument()
    })

    it('calls pinTab when clicking Pin', () => {
      const pinTab = vi.fn()
      const tabs = [createMockTab('tab_1', 'note_1', false), createMockTab('tab_2', 'note_2')]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
        pinTab,
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      fireEvent.contextMenu(screen.getByText('First Note'))
      fireEvent.click(screen.getByText('Pin'))

      expect(pinTab).toHaveBeenCalledWith('tab_1')
    })

    it('calls unpinTab when clicking Unpin', () => {
      const unpinTab = vi.fn()
      const tabs = [createMockTab('tab_1', 'note_1', true), createMockTab('tab_2', 'note_2')]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
        unpinTab,
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      fireEvent.contextMenu(screen.getByText('First Note'))
      fireEvent.click(screen.getByText('Unpin'))

      expect(unpinTab).toHaveBeenCalledWith('tab_1')
    })

    it('closes other tabs when clicking Close Others', () => {
      const closeTabs = vi.fn()
      const tabs = [
        createMockTab('tab_1', 'note_1'),
        createMockTab('tab_2', 'note_2'),
        createMockTab('tab_3', 'note_3'),
      ]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
        closeTabs,
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      fireEvent.contextMenu(screen.getByText('First Note'))
      fireEvent.click(screen.getByText('Close Others'))

      // closeTabs 被调用一次，参数是要关闭的 tab id 数组
      expect(closeTabs).toHaveBeenCalledWith(['tab_2', 'tab_3'])
    })

    it('closes all non-pinned tabs when clicking Close All', () => {
      const closeTabs = vi.fn()
      const tabs = [
        createMockTab('tab_1', 'note_1', true), // pinned
        createMockTab('tab_2', 'note_2'),
        createMockTab('tab_3', 'note_3'),
      ]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
        closeTabs,
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      fireEvent.contextMenu(screen.getByText('First Note'))
      fireEvent.click(screen.getByText('Close All'))

      // closeTabs 被调用一次，参数只包含非 pinned 的 tab id
      expect(closeTabs).toHaveBeenCalledWith(['tab_2', 'tab_3'])
    })
  })

  // ============================================================================
  // Active Tab Indicator Tests
  // ============================================================================

  describe('active tab indicator', () => {
    it('shows active indicator on active tab', () => {
      const tabs = [
        createMockTab('tab_1', 'note_1'),
        createMockTab('tab_2', 'note_2'),
      ]

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        tabs,
        activeTabId: 'tab_1',
      })

      render(<TabBar getNoteTitle={mockGetNoteTitle} />)

      // Active tab should have accent color indicator
      const activeTab = screen.getByText('First Note').closest('[class*="bg-[var(--color-card-solid)]"]')
      expect(activeTab).toBeInTheDocument()
    })
  })
})
