/**
 * TabContext 测试
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { TabProvider, useTabs } from '../TabContext'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

describe('TabContext', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  // ============================================================================
  // Tab Creation Tests
  // ============================================================================

  describe('createTab', () => {
    it('creates a new empty tab', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab()
      })

      expect(result.current.tabs.length).toBe(1)
      expect(result.current.tabs[0].layout).toBe('')
      expect(result.current.tabs[0].panes).toEqual({})
      expect(result.current.activeTabId).toBe(result.current.tabs[0].id)
    })

    it('creates a tab with a specific note', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_123')
      })

      expect(result.current.tabs.length).toBe(1)
      // Layout now contains paneId, not noteId
      const paneId = result.current.tabs[0].layout as string
      expect(paneId).toMatch(/^pane_/)
      // Pane should contain the noteId
      expect(result.current.tabs[0].panes[paneId]?.noteId).toBe('note_123')
      expect(result.current.focusedNoteId).toBe('note_123')
    })

    it('creates multiple tabs', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
        result.current.createTab('note_2')
      })

      expect(result.current.tabs.length).toBe(2)
      expect(result.current.activeTabId).toBe(result.current.tabs[1].id) // Last created is active
    })
  })

  // ============================================================================
  // Tab Closing Tests
  // ============================================================================

  describe('closeTab', () => {
    it('closes the current tab', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
      })

      const tabId = result.current.tabs[0].id

      act(() => {
        result.current.closeTab(tabId)
      })

      expect(result.current.tabs.length).toBe(0)
      expect(result.current.activeTabId).toBe(null)
    })

    it('switches to adjacent tab when closing current', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
        result.current.createTab('note_2')
        result.current.createTab('note_3')
      })

      const secondTabId = result.current.tabs[1].id
      const thirdTabId = result.current.tabs[2].id

      // Select second tab
      act(() => {
        result.current.selectTab(secondTabId)
      })

      // Close second tab
      act(() => {
        result.current.closeTab(secondTabId)
      })

      // Should switch to the tab at same position (third tab, now second)
      expect(result.current.tabs.length).toBe(2)
      expect(result.current.activeTabId).toBe(thirdTabId)
    })
  })

  // ============================================================================
  // Tab Selection Tests
  // ============================================================================

  describe('selectTab', () => {
    it('selects a specific tab', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
        result.current.createTab('note_2')
      })

      const firstTabId = result.current.tabs[0].id

      act(() => {
        result.current.selectTab(firstTabId)
      })

      expect(result.current.activeTabId).toBe(firstTabId)
    })
  })

  // ============================================================================
  // Tab Pin Tests
  // ============================================================================

  describe('pinTab / unpinTab', () => {
    it('pins and unpins a tab', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
      })

      const tabId = result.current.tabs[0].id

      act(() => {
        result.current.pinTab(tabId)
      })

      expect(result.current.tabs[0].isPinned).toBe(true)

      act(() => {
        result.current.unpinTab(tabId)
      })

      expect(result.current.tabs[0].isPinned).toBe(false)
    })
  })

  // ============================================================================
  // Tab Reordering Tests
  // ============================================================================

  describe('reorderTabs', () => {
    it('reorders tabs', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
        result.current.createTab('note_2')
        result.current.createTab('note_3')
      })

      const originalOrder = result.current.tabs.map(t => t.id)

      act(() => {
        result.current.reorderTabs(0, 2) // Move first to last
      })

      const newOrder = result.current.tabs.map(t => t.id)
      expect(newOrder[0]).toBe(originalOrder[1])
      expect(newOrder[1]).toBe(originalOrder[2])
      expect(newOrder[2]).toBe(originalOrder[0])
    })

    it('does nothing when indices are the same', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
        result.current.createTab('note_2')
      })

      const originalOrder = result.current.tabs.map(t => t.id)

      act(() => {
        result.current.reorderTabs(0, 0)
      })

      const newOrder = result.current.tabs.map(t => t.id)
      expect(newOrder).toEqual(originalOrder)
    })
  })

  // ============================================================================
  // Pane Operations Tests
  // ============================================================================

  describe('openNoteInPane', () => {
    it('opens a note in the current pane', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
      })

      const paneId = result.current.focusedPaneId!

      act(() => {
        result.current.openNoteInPane('note_2')
      })

      // Same paneId, but now contains note_2
      expect(result.current.tabs[0].panes[paneId]?.noteId).toBe('note_2')
      expect(result.current.focusedNoteId).toBe('note_2')
    })

    it('creates a new tab if no tabs exist', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.openNoteInPane('note_1')
      })

      expect(result.current.tabs.length).toBe(1)
      expect(result.current.focusedNoteId).toBe('note_1')
    })

    it('replaces empty pane with note', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      // Create tab with note
      act(() => {
        result.current.createTab('note_1')
      })

      // Split to create empty pane
      act(() => {
        result.current.splitPane('row')
      })

      // After split, focusedPaneId should be the new pane
      const newPaneId = result.current.focusedPaneId!
      expect(result.current.tabs[0].panes[newPaneId]?.noteId).toBe(null)

      // Open a note in the empty pane
      act(() => {
        result.current.openNoteInPane('note_2')
      })

      expect(result.current.tabs[0].panes[newPaneId]?.noteId).toBe('note_2')
      expect(result.current.focusedNoteId).toBe('note_2')
    })
  })

  describe('splitPane', () => {
    it('splits horizontally (row)', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
      })

      act(() => {
        result.current.splitPane('row')
      })

      const layout = result.current.tabs[0].layout
      expect(typeof layout).toBe('object')
      expect((layout as { direction: string }).direction).toBe('row')
    })

    it('splits vertically (column)', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
      })

      act(() => {
        result.current.splitPane('column')
      })

      const layout = result.current.tabs[0].layout
      expect(typeof layout).toBe('object')
      expect((layout as { direction: string }).direction).toBe('column')
    })

    it('creates new pane with null noteId by default', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      // Create tab with note
      act(() => {
        result.current.createTab('note_1')
      })

      // Split to create empty pane
      act(() => {
        result.current.splitPane('row')
      })

      const newPaneId = result.current.focusedPaneId!
      expect(result.current.tabs[0].panes[newPaneId]?.noteId).toBe(null)
    })

    it('can split with a specific noteId', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      // Create tab with note
      act(() => {
        result.current.createTab('note_1')
      })

      // Split with specific note
      act(() => {
        result.current.splitPane('row', { noteId: 'note_2' })
      })

      const newPaneId = result.current.focusedPaneId!
      expect(result.current.tabs[0].panes[newPaneId]?.noteId).toBe('note_2')
      expect(result.current.focusedNoteId).toBe('note_2')
    })

    it('does nothing if layout is empty', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab() // Empty tab
      })

      act(() => {
        result.current.splitPane('row')
      })

      // Should still be empty string
      expect(result.current.tabs[0].layout).toBe('')
    })
  })

  describe('closePane', () => {
    it('closes a pane and focuses the remaining one', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      // Create tab and split with a specific note
      act(() => {
        result.current.createTab('note_1')
      })

      const firstPaneId = result.current.focusedPaneId!

      act(() => {
        result.current.splitPane('row', { noteId: 'note_2' })
      })

      const secondPaneId = result.current.focusedPaneId!

      // After split, focus is on new pane (note_2)
      expect(result.current.focusedNoteId).toBe('note_2')

      // Close second pane
      act(() => {
        result.current.closePane(secondPaneId)
      })

      // After closing, should have only first pane
      expect(result.current.tabs[0].layout).toBe(firstPaneId)
      expect(result.current.focusedNoteId).toBe('note_1')
    })

    it('closes the tab if only one pane remains', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
      })

      const paneId = result.current.focusedPaneId!

      act(() => {
        result.current.closePane(paneId)
      })

      expect(result.current.tabs.length).toBe(0)
    })
  })

  describe('swapPanes', () => {
    it('swaps two panes', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      // Create tab
      act(() => {
        result.current.createTab('note_1')
      })

      const firstPaneId = result.current.focusedPaneId!

      // Split with note_2
      act(() => {
        result.current.splitPane('row', { noteId: 'note_2' })
      })

      const secondPaneId = result.current.focusedPaneId!

      // Verify initial layout: { first: firstPaneId, second: secondPaneId }
      const layoutBefore = result.current.tabs[0].layout as { first: string; second: string }
      expect(layoutBefore.first).toBe(firstPaneId)
      expect(layoutBefore.second).toBe(secondPaneId)

      // Swap
      act(() => {
        result.current.swapPanes(firstPaneId, secondPaneId)
      })

      const layoutAfter = result.current.tabs[0].layout as { first: string; second: string }
      expect(layoutAfter.first).toBe(secondPaneId)
      expect(layoutAfter.second).toBe(firstPaneId)
    })

    it('does nothing when swapping same pane', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      // Create tab
      act(() => {
        result.current.createTab('note_1')
      })

      const paneId = result.current.focusedPaneId!

      // Split with note_2
      act(() => {
        result.current.splitPane('row', { noteId: 'note_2' })
      })

      const originalLayout = JSON.stringify(result.current.tabs[0].layout)

      act(() => {
        result.current.swapPanes(paneId, paneId)
      })

      expect(JSON.stringify(result.current.tabs[0].layout)).toBe(originalLayout)
    })
  })

  describe('focusPane', () => {
    it('focuses a specific pane', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      // Create tab
      act(() => {
        result.current.createTab('note_1')
      })

      const firstPaneId = result.current.focusedPaneId!

      // Split with note_2
      act(() => {
        result.current.splitPane('row', { noteId: 'note_2' })
      })

      const secondPaneId = result.current.focusedPaneId!

      // After split, focus is on secondPane
      expect(result.current.focusedPaneId).toBe(secondPaneId)
      expect(result.current.focusedNoteId).toBe('note_2')

      // Focus first pane
      act(() => {
        result.current.focusPane(firstPaneId)
      })

      expect(result.current.focusedPaneId).toBe(firstPaneId)
      expect(result.current.focusedNoteId).toBe('note_1')

      // Focus second pane
      act(() => {
        result.current.focusPane(secondPaneId)
      })

      expect(result.current.focusedPaneId).toBe(secondPaneId)
      expect(result.current.focusedNoteId).toBe('note_2')
    })
  })

  // ============================================================================
  // Same Note Multiple Panes Tests
  // ============================================================================

  describe('same note in multiple panes', () => {
    it('allows same note to be opened in multiple panes', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      // Create tab with note_1
      act(() => {
        result.current.createTab('note_1')
      })

      // Split with same note_1
      act(() => {
        result.current.splitPane('row', { noteId: 'note_1' })
      })

      // Both panes should have note_1
      const panes = Object.values(result.current.tabs[0].panes)
      expect(panes.filter(p => p.noteId === 'note_1').length).toBe(2)
    })
  })

  // ============================================================================
  // Helper Methods Tests
  // ============================================================================

  describe('getPaneNoteId', () => {
    it('returns noteId for a pane', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
      })

      const paneId = result.current.focusedPaneId!
      expect(result.current.getPaneNoteId(paneId)).toBe('note_1')
    })

    it('returns null for empty pane', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
      })

      act(() => {
        result.current.splitPane('row') // Creates empty pane
      })

      const emptyPaneId = result.current.focusedPaneId!
      expect(result.current.getPaneNoteId(emptyPaneId)).toBe(null)
    })

    it('returns null for non-existent pane', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
      })

      expect(result.current.getPaneNoteId('non_existent_pane')).toBe(null)
    })
  })

  describe('isNoteOpenInAnyTab', () => {
    it('returns true for open notes', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
      })

      expect(result.current.isNoteOpenInAnyTab('note_1')).toBe(true)
    })

    it('returns false for notes not open', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_1')
      })

      expect(result.current.isNoteOpenInAnyTab('note_2')).toBe(false)
    })
  })

  describe('getOpenNoteIds', () => {
    it('returns all open note IDs', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      // Create tab
      act(() => {
        result.current.createTab('note_1')
      })

      // Split with note_2
      act(() => {
        result.current.splitPane('row', { noteId: 'note_2' })
      })

      const openIds = result.current.getOpenNoteIds()
      expect(openIds).toContain('note_1')
      expect(openIds).toContain('note_2')
    })

    it('excludes empty panes', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      // Create tab
      act(() => {
        result.current.createTab('note_1')
      })

      // Split without noteId to create empty pane
      act(() => {
        result.current.splitPane('row')
      })

      const openIds = result.current.getOpenNoteIds()
      expect(openIds).toContain('note_1')
      expect(openIds.length).toBe(1) // Only note_1, not the empty pane
    })
  })

  describe('getTabDisplayTitle', () => {
    it('returns note title from callback', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab('note_123')
      })

      const title = result.current.getTabDisplayTitle(
        result.current.tabs[0],
        (id) => id === 'note_123' ? 'My Note Title' : ''
      )

      expect(title).toBe('My Note Title')
    })

    it('returns "New Tab" for empty tabs', () => {
      const { result } = renderHook(() => useTabs(), { wrapper: TabProvider })

      act(() => {
        result.current.createTab()
      })

      const title = result.current.getTabDisplayTitle(
        result.current.tabs[0],
        () => ''
      )

      expect(title).toBe('New Tab')
    })
  })
})
