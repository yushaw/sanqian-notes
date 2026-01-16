/**
 * FloatingToc - Notion-style floating table of contents
 *
 * Features:
 * - Collapsed state: small horizontal lines indicating document structure
 * - Expanded state: full heading list with level indentation
 * - Hover to expand (200ms delay), leave to collapse immediately
 * - Current position highlighting based on scroll position
 * - Two variants: 'editor' (normal mode) and 'typewriter' (typewriter mode)
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type { Editor } from '@tiptap/react'
import './FloatingToc.css'

// ==================== Constants ====================

// Collapsed state layout
const LINE_HEIGHT = 2 // px
const MAX_GAP = 12 // px
const MIN_GAP = 1 // px
const COLLAPSED_MAX_HEIGHT_PERCENT = 60
const COLLAPSED_PADDING_V = 16 // px

// Expanded state layout
const EXPANDED_MAX_HEIGHT_PERCENT = 80
const EXPANDED_WIDTH_PERCENT = 40
const EXPANDED_MIN_WIDTH = 160 // px
const EXPANDED_MAX_WIDTH = 280 // px

// Animation
const HOVER_DELAY = 200 // ms
const SCROLL_DURATION = 250 // ms

// ==================== Types ====================

export interface TocItem {
  id: string
  level: number
  text: string
  pos: number
}

interface FloatingTocProps {
  editor: Editor | null
  variant?: 'editor' | 'typewriter'
}

// ==================== Helper Functions ====================

/** Find scroll container by traversing up from element */
function findScrollContainer(el: Element): Element | null {
  let current: Element | null = el
  while (current) {
    if (current.classList.contains('zen-scroll-wrapper') ||
        current.classList.contains('typewriter-content')) {
      return current
    }
    current = current.parentElement
  }
  return null
}

/** Find pane container for dimension calculations */
function findPaneContainer(el: Element): Element | null {
  let current: Element | null = el
  while (current) {
    if (current.classList.contains('zen-editor-container') ||
        current.classList.contains('typewriter-container')) {
      return current
    }
    current = current.parentElement
  }
  return null
}

// ==================== Component ====================

export function FloatingToc({ editor, variant = 'editor' }: FloatingTocProps) {
  // State
  const [items, setItems] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [containerHeight, setContainerHeight] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)

  // Refs
  const containerRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<HTMLDivElement>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // ==================== Computed Values ====================

  // Normalize heading levels (e.g., if doc starts with h2, treat it as level 1)
  const minLevel = useMemo(() => {
    if (items.length === 0) return 1
    return Math.min(...items.map(item => item.level))
  }, [items])

  const getRelativeLevel = useCallback((level: number) => {
    return level - minLevel + 1
  }, [minLevel])

  // Collapsed state style (dynamic gap based on item count)
  const collapsedStyle = useMemo(() => {
    const count = items.length
    if (count <= 1 || containerHeight === 0) {
      return { gap: MAX_GAP, maxHeight: '60%' }
    }

    const gapCount = count - 1
    const totalLineHeight = count * LINE_HEIGHT
    const heightWithMaxGap = totalLineHeight + (MAX_GAP * gapCount) + COLLAPSED_PADDING_V
    const maxHeightPx = containerHeight * (COLLAPSED_MAX_HEIGHT_PERCENT / 100)

    // Use max gap if it fits, otherwise compress
    if (heightWithMaxGap <= maxHeightPx) {
      return { gap: MAX_GAP, maxHeight: heightWithMaxGap + 'px' }
    }

    const availableForGaps = maxHeightPx - COLLAPSED_PADDING_V - totalLineHeight
    const gap = Math.max(MIN_GAP, Math.floor(availableForGaps / gapCount))
    return { gap, maxHeight: maxHeightPx + 'px' }
  }, [items.length, containerHeight])

  // Expanded state style
  const expandedStyle = useMemo(() => {
    const maxHeight = containerHeight === 0
      ? '80vh'
      : (containerHeight * (EXPANDED_MAX_HEIGHT_PERCENT / 100)) + 'px'

    const rawWidth = containerWidth === 0 ? 240 : containerWidth * (EXPANDED_WIDTH_PERCENT / 100)
    const width = Math.max(EXPANDED_MIN_WIDTH, Math.min(EXPANDED_MAX_WIDTH, rawWidth)) + 'px'

    return { maxHeight, width }
  }, [containerHeight, containerWidth])

  // ==================== Effects ====================

  // Observe container dimensions
  useEffect(() => {
    const updateDimensions = () => {
      const paneContainer = containerRef.current ? findPaneContainer(containerRef.current) : null
      if (paneContainer) {
        setContainerHeight(paneContainer.clientHeight)
        setContainerWidth(paneContainer.clientWidth)
      } else {
        setContainerHeight(window.innerHeight)
        setContainerWidth(window.innerWidth)
      }
    }

    const timer = setTimeout(updateDimensions, 0)
    const paneContainer = containerRef.current ? findPaneContainer(containerRef.current) : null

    const resizeObserver = new ResizeObserver(updateDimensions)
    if (paneContainer) {
      resizeObserver.observe(paneContainer)
    }

    window.addEventListener('resize', updateDimensions)
    return () => {
      clearTimeout(timer)
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateDimensions)
    }
  }, [items.length])

  // Extract headings from editor
  const extractHeadings = useCallback(() => {
    if (!editor) return []

    const headings: TocItem[] = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && node.attrs.level <= 3) {
        headings.push({
          id: node.attrs.blockId || `heading-${pos}`,
          level: node.attrs.level,
          text: node.textContent,
          pos,
        })
      }
    })
    return headings
  }, [editor])

  // Listen to editor content changes
  useEffect(() => {
    if (!editor) return

    const updateToc = () => setItems(extractHeadings())
    updateToc()
    editor.on('update', updateToc)
    return () => { editor.off('update', updateToc) }
  }, [editor, extractHeadings])

  // Update active heading based on scroll position
  useEffect(() => {
    if (!editor || items.length === 0) return

    const proseMirrorEl = editor.view.dom
    if (!proseMirrorEl) return

    const scrollContainer = findScrollContainer(proseMirrorEl)

    const updateActiveHeading = () => {
      const headings = proseMirrorEl.querySelectorAll('h1, h2, h3')
      if (headings.length === 0 || items.length === 0) return

      const targetY = window.innerHeight * 0.5
      let activeIndex = 0
      let minDistance = Infinity

      headings.forEach((heading, index) => {
        if (index >= items.length) return
        const distance = Math.abs(heading.getBoundingClientRect().top - targetY)
        if (distance < minDistance) {
          minDistance = distance
          activeIndex = index
        }
      })

      setActiveId(items[activeIndex].id)
    }

    updateActiveHeading()
    scrollContainer?.addEventListener('scroll', updateActiveHeading, { passive: true })
    editor.on('update', updateActiveHeading)

    return () => {
      scrollContainer?.removeEventListener('scroll', updateActiveHeading)
      editor.off('update', updateActiveHeading)
    }
  }, [editor, items])

  // Cleanup hover timeout
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    }
  }, [])

  // ==================== Handlers ====================

  // Custom smooth scroll with easing
  const smoothScrollTo = useCallback((element: Element, container: Element | null) => {
    if (!container) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    const elementRect = element.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const targetScrollTop = container.scrollTop + elementRect.top - containerRect.top
      - containerRect.height / 2 + elementRect.height / 2

    const startScrollTop = container.scrollTop
    const distance = targetScrollTop - startScrollTop
    const startTime = performance.now()

    const animate = (currentTime: number) => {
      const progress = Math.min((currentTime - startTime) / SCROLL_DURATION, 1)
      const easeOut = 1 - Math.pow(1 - progress, 3)
      container.scrollTop = startScrollTop + distance * easeOut
      if (progress < 1) requestAnimationFrame(animate)
    }

    requestAnimationFrame(animate)
  }, [])

  const handleClick = (item: TocItem) => {
    if (!editor) return

    setActiveId(item.id)
    editor.chain().focus().setTextSelection(item.pos + 1).run()

    const proseMirrorEl = editor.view.dom
    if (!proseMirrorEl) return

    // Find heading by index (more reliable than text matching)
    const itemIndex = items.findIndex(i => i.id === item.id)
    if (itemIndex === -1) return

    const headings = proseMirrorEl.querySelectorAll('h1, h2, h3')
    if (itemIndex < headings.length) {
      smoothScrollTo(headings[itemIndex], findScrollContainer(proseMirrorEl))
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => e.preventDefault()

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)

    hoverTimeoutRef.current = setTimeout(() => {
      setIsExpanded(true)
      requestAnimationFrame(() => {
        if (itemsRef.current && activeId) {
          const activeItem = itemsRef.current.querySelector(`[data-id="${activeId}"]`)
          activeItem?.scrollIntoView({ block: 'center', behavior: 'instant' })
        }
      })
    }, HOVER_DELAY)
  }, [activeId])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setIsExpanded(false)
  }, [])

  // ==================== Render ====================

  if (items.length <= 1) return null

  return (
    <div
      ref={containerRef}
      className={`floating-toc floating-toc-${variant} ${isExpanded ? 'expanded' : 'collapsed'}`}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Collapsed state */}
      <div
        className="floating-toc-collapsed"
        style={{ gap: collapsedStyle.gap, maxHeight: collapsedStyle.maxHeight }}
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={`floating-toc-line floating-toc-line-level-${getRelativeLevel(item.level)} ${activeId === item.id ? 'active' : ''}`}
          />
        ))}
      </div>

      {/* Expanded state */}
      <div className="floating-toc-expanded" style={expandedStyle}>
        <div className="floating-toc-items" ref={itemsRef} style={{ maxHeight: expandedStyle.maxHeight }}>
          {items.map((item) => (
            <button
              key={item.id}
              data-id={item.id}
              className={`floating-toc-item floating-toc-level-${getRelativeLevel(item.level)} ${activeId === item.id ? 'active' : ''}`}
              onClick={() => handleClick(item)}
            >
              {item.text || '(empty heading)'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
