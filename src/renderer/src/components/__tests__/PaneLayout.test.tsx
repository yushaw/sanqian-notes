/**
 * PaneLayout 组件测试
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PaneLayout } from '../PaneLayout'
import type { Tab, TabContextValue, PaneState } from '../../contexts/TabContext'
import type { MosaicNode } from 'react-mosaic-component'

// Mock useTabs
const mockUseTabs = vi.fn<() => Partial<TabContextValue>>()

vi.mock('../../contexts/TabContext', () => ({
  useTabs: () => mockUseTabs(),
}))

// Mock useTranslations
vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    paneControls: {
      dragSwap: 'Swap',
    },
  }),
}))

// Mock react-mosaic-component
vi.mock('react-mosaic-component', () => ({
  Mosaic: ({ children }: { children?: React.ReactNode }) => <div data-testid="mosaic">{children}</div>,
  getLeaves: (node: MosaicNode<string> | string): string[] => {
    if (typeof node === 'string') return [node]
    const leaves: string[] = []
    const traverse = (n: MosaicNode<string> | string) => {
      if (typeof n === 'string') {
        leaves.push(n)
      } else {
        traverse(n.first)
        traverse(n.second)
      }
    }
    traverse(node)
    return leaves
  },
}))

// Mock @dnd-kit
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div data-testid="dnd-context">{children}</div>,
  PointerSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
  useDroppable: () => ({
    setNodeRef: vi.fn(),
    isOver: false,
  }),
}))

describe('PaneLayout', () => {
  // New signature: (paneId, noteId, isFocused, panelCount)
  const mockRenderPane = vi.fn((paneId: string, noteId: string | null, isFocused: boolean, panelCount: number) => (
    <div data-testid={`pane-${paneId}`} data-note-id={noteId} data-focused={isFocused} data-panel-count={panelCount}>
      Pane Content: {noteId || 'empty'}
    </div>
  ))

  const mockRenderEmpty = vi.fn(() => (
    <div data-testid="empty-state">Empty State</div>
  ))

  // Helper to create a mock tab with panes
  const createMockTab = (
    layout: MosaicNode<string> | string,
    panes: Record<string, PaneState>,
    focusedPaneId: string | null = null
  ): Tab => ({
    id: 'tab_1',
    layout,
    panes,
    focusedPaneId: focusedPaneId || (typeof layout === 'string' ? layout : null),
    createdAt: Date.now(),
  })

  // Helper to create panes from a simple mapping
  const createPanes = (mapping: Record<string, string | null>): Record<string, PaneState> => {
    const panes: Record<string, PaneState> = {}
    for (const [paneId, noteId] of Object.entries(mapping)) {
      panes[paneId] = { noteId }
    }
    return panes
  }

  const defaultMockContext: Partial<TabContextValue> = {
    activeTab: null,
    focusedPaneId: null,
    focusPane: vi.fn(),
    updateLayout: vi.fn(),
    swapPanes: vi.fn(),
    getPaneNoteId: vi.fn((_paneId: string) => null),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTabs.mockReturnValue(defaultMockContext)
  })

  afterEach(() => {
    cleanup()
  })

  // ============================================================================
  // Empty State Tests
  // ============================================================================

  describe('empty state', () => {
    it('renders empty state when no active tab', () => {
      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: null,
      })

      render(<PaneLayout renderPane={mockRenderPane} renderEmpty={mockRenderEmpty} />)

      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })

    it('renders empty state when layout is empty string', () => {
      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: createMockTab('', {}, null),
      })

      render(<PaneLayout renderPane={mockRenderPane} renderEmpty={mockRenderEmpty} />)

      expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    })

    it('renders default empty state when renderEmpty not provided', () => {
      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: null,
      })

      const { container } = render(<PaneLayout renderPane={mockRenderPane} />)

      // Should render a blank div
      expect(container.querySelector('.bg-\\[var\\(--color-card-solid\\)\\]')).toBeInTheDocument()
    })
  })

  // ============================================================================
  // Single Pane Tests
  // ============================================================================

  describe('single pane', () => {
    it('renders single pane correctly', () => {
      const panes = createPanes({ 'pane_1': 'note_1' })
      const tab = createMockTab('pane_1', panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      expect(screen.getByTestId('pane-pane_1')).toBeInTheDocument()
      expect(mockRenderPane).toHaveBeenCalledWith('pane_1', 'note_1', true, 1)
    })

    it('single pane has no mosaic resize layer', () => {
      const panes = createPanes({ 'pane_1': 'note_1' })
      const tab = createMockTab('pane_1', panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      // Mosaic should not be rendered for single pane
      expect(screen.queryByTestId('mosaic')).not.toBeInTheDocument()
    })
  })

  // ============================================================================
  // Split Pane Tests
  // ============================================================================

  describe('split panes', () => {
    it('renders two panes in horizontal split', () => {
      const layout: MosaicNode<string> = {
        direction: 'row',
        first: 'pane_1',
        second: 'pane_2',
        splitPercentage: 50,
      }
      const panes = createPanes({ 'pane_1': 'note_1', 'pane_2': 'note_2' })
      const tab = createMockTab(layout, panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      expect(screen.getByTestId('pane-pane_1')).toBeInTheDocument()
      expect(screen.getByTestId('pane-pane_2')).toBeInTheDocument()
    })

    it('renders two panes in vertical split', () => {
      const layout: MosaicNode<string> = {
        direction: 'column',
        first: 'pane_1',
        second: 'pane_2',
        splitPercentage: 50,
      }
      const panes = createPanes({ 'pane_1': 'note_1', 'pane_2': 'note_2' })
      const tab = createMockTab(layout, panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      expect(screen.getByTestId('pane-pane_1')).toBeInTheDocument()
      expect(screen.getByTestId('pane-pane_2')).toBeInTheDocument()
    })

    it('passes correct panelCount to renderPane', () => {
      const layout: MosaicNode<string> = {
        direction: 'row',
        first: 'pane_1',
        second: 'pane_2',
        splitPercentage: 50,
      }
      const panes = createPanes({ 'pane_1': 'note_1', 'pane_2': 'note_2' })
      const tab = createMockTab(layout, panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      // Both panes should report panelCount = 2
      expect(mockRenderPane).toHaveBeenCalledWith('pane_1', 'note_1', true, 2)
      expect(mockRenderPane).toHaveBeenCalledWith('pane_2', 'note_2', false, 2)
    })

    it('shows mosaic resize layer for split panes', () => {
      const layout: MosaicNode<string> = {
        direction: 'row',
        first: 'pane_1',
        second: 'pane_2',
        splitPercentage: 50,
      }
      const panes = createPanes({ 'pane_1': 'note_1', 'pane_2': 'note_2' })
      const tab = createMockTab(layout, panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      expect(screen.getByTestId('mosaic')).toBeInTheDocument()
    })
  })

  // ============================================================================
  // Focus Tests
  // ============================================================================

  describe('pane focus', () => {
    it('marks focused pane correctly', () => {
      const layout: MosaicNode<string> = {
        direction: 'row',
        first: 'pane_1',
        second: 'pane_2',
        splitPercentage: 50,
      }
      const panes = createPanes({ 'pane_1': 'note_1', 'pane_2': 'note_2' })
      const tab = createMockTab(layout, panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      const pane1 = screen.getByTestId('pane-pane_1')
      const pane2 = screen.getByTestId('pane-pane_2')

      expect(pane1.dataset.focused).toBe('true')
      expect(pane2.dataset.focused).toBe('false')
    })

    it('calls focusPane with paneId when clicking a pane', () => {
      const focusPane = vi.fn()
      const layout: MosaicNode<string> = {
        direction: 'row',
        first: 'pane_1',
        second: 'pane_2',
        splitPercentage: 50,
      }
      const panes = createPanes({ 'pane_1': 'note_1', 'pane_2': 'note_2' })
      const tab = createMockTab(layout, panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        focusPane,
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      // Click on pane wrapper (the parent div)
      const pane2 = screen.getByTestId('pane-pane_2')
      const paneWrapper = pane2.closest('[class*="absolute"]')
      if (paneWrapper) {
        fireEvent.click(paneWrapper)
        expect(focusPane).toHaveBeenCalledWith('pane_2')
      }
    })
  })

  // ============================================================================
  // Nested Layout Tests
  // ============================================================================

  describe('nested layouts', () => {
    it('renders three panes in nested layout', () => {
      const layout: MosaicNode<string> = {
        direction: 'row',
        first: 'pane_1',
        second: {
          direction: 'column',
          first: 'pane_2',
          second: 'pane_3',
          splitPercentage: 50,
        },
        splitPercentage: 50,
      }
      const panes = createPanes({ 'pane_1': 'note_1', 'pane_2': 'note_2', 'pane_3': 'note_3' })
      const tab = createMockTab(layout, panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      expect(screen.getByTestId('pane-pane_1')).toBeInTheDocument()
      expect(screen.getByTestId('pane-pane_2')).toBeInTheDocument()
      expect(screen.getByTestId('pane-pane_3')).toBeInTheDocument()
    })

    it('calculates correct panelCount for nested layout', () => {
      const layout: MosaicNode<string> = {
        direction: 'row',
        first: 'pane_1',
        second: {
          direction: 'column',
          first: 'pane_2',
          second: 'pane_3',
          splitPercentage: 50,
        },
        splitPercentage: 50,
      }
      const panes = createPanes({ 'pane_1': 'note_1', 'pane_2': 'note_2', 'pane_3': 'note_3' })
      const tab = createMockTab(layout, panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      // All panes should report panelCount = 3
      expect(mockRenderPane).toHaveBeenCalledWith('pane_1', 'note_1', true, 3)
      expect(mockRenderPane).toHaveBeenCalledWith('pane_2', 'note_2', false, 3)
      expect(mockRenderPane).toHaveBeenCalledWith('pane_3', 'note_3', false, 3)
    })
  })

  // ============================================================================
  // Same Note Multiple Panes Tests
  // ============================================================================

  describe('same note in multiple panes', () => {
    it('allows same note in multiple panes', () => {
      const layout: MosaicNode<string> = {
        direction: 'row',
        first: 'pane_1',
        second: 'pane_2',
        splitPercentage: 50,
      }
      // Same noteId for both panes
      const panes = createPanes({ 'pane_1': 'note_1', 'pane_2': 'note_1' })
      const tab = createMockTab(layout, panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      // Both panes should exist with same noteId
      expect(screen.getByTestId('pane-pane_1')).toBeInTheDocument()
      expect(screen.getByTestId('pane-pane_2')).toBeInTheDocument()
      expect(mockRenderPane).toHaveBeenCalledWith('pane_1', 'note_1', true, 2)
      expect(mockRenderPane).toHaveBeenCalledWith('pane_2', 'note_1', false, 2)
    })
  })

  // ============================================================================
  // DnD Context Tests
  // ============================================================================

  describe('drag and drop context', () => {
    it('wraps content in DndContext', () => {
      const panes = createPanes({ 'pane_1': 'note_1' })
      const tab = createMockTab('pane_1', panes, 'pane_1')

      mockUseTabs.mockReturnValue({
        ...defaultMockContext,
        activeTab: tab,
        focusedPaneId: 'pane_1',
        getPaneNoteId: vi.fn((paneId: string) => panes[paneId]?.noteId || null),
      })

      render(<PaneLayout renderPane={mockRenderPane} />)

      expect(screen.getByTestId('dnd-context')).toBeInTheDocument()
    })

  })
})
