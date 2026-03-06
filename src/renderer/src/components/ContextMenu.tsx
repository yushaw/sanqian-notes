import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  divider?: boolean
}

export interface SubMenuItem {
  label: string
  icon?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  subItems: ContextMenuItem[]
}

export type ContextMenuItem = MenuItem | SubMenuItem

interface ContextMenuProps {
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

interface ContextMenuPanelProps {
  depth?: number
  items: ContextMenuItem[]
  x: number
  y: number
  onClose: () => void
  onParentSubMenuEnter?: () => void
  onParentSubMenuLeave?: () => void
}

const MENU_GAP = 0
const MENU_ESTIMATED_WIDTH = 200
const VIEWPORT_MARGIN = 8

function isSubMenuItem(item: ContextMenuItem): item is SubMenuItem {
  return 'subItems' in item
}

function estimateMenuHeight(items: ContextMenuItem[]): number {
  return items.reduce((total, item) => total + (('divider' in item && item.divider) ? 9 : 32), 8)
}

function clampMenuPosition(left: number, top: number, width: number, height: number) {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  return {
    left: Math.min(Math.max(VIEWPORT_MARGIN, left), Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN)),
    top: Math.min(Math.max(VIEWPORT_MARGIN, top), Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN)),
  }
}

function ContextMenuPanel({
  depth = 0,
  items,
  x,
  y,
  onClose,
  onParentSubMenuEnter,
  onParentSubMenuLeave,
}: ContextMenuPanelProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState({ left: x, top: y })
  const [hoveredSubMenuIndex, setHoveredSubMenuIndex] = useState<number | null>(null)
  const [subMenuAnchorRect, setSubMenuAnchorRect] = useState<DOMRect | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setMenuPosition({ left: x, top: y })
  }, [x, y])

  useEffect(() => {
    if (!menuRef.current) return

    const rect = menuRef.current.getBoundingClientRect()
    const nextPosition = clampMenuPosition(x, y, rect.width, rect.height)
    if (nextPosition.left !== menuPosition.left || nextPosition.top !== menuPosition.top) {
      setMenuPosition(nextPosition)
    }
  }, [menuPosition.left, menuPosition.top, x, y])

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const clearShowTimer = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
  }

  const closeSubMenu = () => {
    setHoveredSubMenuIndex(null)
    setSubMenuAnchorRect(null)
  }

  const handleSubMenuHover = (index: number, itemElement: HTMLElement) => {
    clearCloseTimer()
    clearShowTimer()

    showTimerRef.current = setTimeout(() => {
      setHoveredSubMenuIndex(index)
      setSubMenuAnchorRect(itemElement.getBoundingClientRect())
    }, 100)
  }

  const handleSubMenuLeave = () => {
    clearShowTimer()
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      closeSubMenu()
    }, 150)
  }

  const handleDescendantSubMenuEnter = () => {
    clearCloseTimer()
    onParentSubMenuEnter?.()
  }

  const handleDescendantSubMenuLeave = () => {
    handleSubMenuLeave()
    onParentSubMenuLeave?.()
  }

  useEffect(() => {
    return () => {
      clearCloseTimer()
      clearShowTimer()
    }
  }, [])

  const hoveredSubMenuItem =
    hoveredSubMenuIndex !== null && isSubMenuItem(items[hoveredSubMenuIndex])
      ? items[hoveredSubMenuIndex]
      : null

  let subMenuPosition: { left: number; top: number } | null = null
  if (hoveredSubMenuItem && subMenuAnchorRect) {
    const estimatedHeight = estimateMenuHeight(hoveredSubMenuItem.subItems)
    const desiredLeft = subMenuAnchorRect.right + MENU_GAP
    const fallbackLeft = subMenuAnchorRect.left - MENU_ESTIMATED_WIDTH - MENU_GAP
    const nextLeft = desiredLeft + MENU_ESTIMATED_WIDTH > window.innerWidth ? fallbackLeft : desiredLeft
    subMenuPosition = clampMenuPosition(nextLeft, subMenuAnchorRect.top, MENU_ESTIMATED_WIDTH, estimatedHeight)
  }

  return (
    <>
      <div
        ref={menuRef}
        className="sanqian-context-menu-panel fixed py-0.5 min-w-[140px] bg-[var(--color-card)]/95 backdrop-blur-xl rounded-lg shadow-lg border border-[var(--color-border)] select-none"
        style={{ left: menuPosition.left, top: menuPosition.top, zIndex: 200 + depth }}
        onMouseEnter={() => {
          onParentSubMenuEnter?.()
        }}
        onMouseLeave={() => {
          onParentSubMenuLeave?.()
        }}
      >
        {items.map((item, index) => {
          if (isSubMenuItem(item)) {
            return (
              <div
                key={index}
                className="relative"
                onMouseEnter={(event) => {
                  if (item.disabled) return
                  handleSubMenuHover(index, event.currentTarget)
                }}
                onMouseLeave={handleSubMenuLeave}
              >
                <button
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    if (!item.disabled && item.onClick) {
                      item.onClick()
                      onClose()
                    }
                  }}
                  className={`w-full px-3 py-1.5 text-left text-[0.867rem] flex items-center justify-between gap-2 ${
                    item.danger
                      ? 'text-red-500 hover:bg-red-500/10'
                      : 'text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                  } ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span className="flex items-center gap-2">
                    {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
                    <span>{item.label}</span>
                  </span>
                  <svg className="w-3 h-3 text-[var(--color-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )
          }

          if (item.divider) {
            return <div key={index} className="h-px bg-[var(--color-divider)] my-1" />
          }

          return (
            <button
              type="button"
              key={index}
              onClick={() => {
                if (!item.disabled) {
                  item.onClick()
                  onClose()
                }
              }}
              disabled={item.disabled}
              className={`w-full px-3 py-1.5 text-left text-[0.867rem] flex items-center gap-2 ${
                item.danger
                  ? 'text-red-500 hover:bg-red-500/10'
                  : 'text-[var(--color-text)] hover:bg-[var(--color-surface)]'
              } ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      {hoveredSubMenuItem && subMenuPosition && (
        <ContextMenuPanel
          depth={depth + 1}
          items={hoveredSubMenuItem.subItems}
          x={subMenuPosition.left}
          y={subMenuPosition.top}
          onClose={onClose}
          onParentSubMenuEnter={handleDescendantSubMenuEnter}
          onParentSubMenuLeave={handleDescendantSubMenuLeave}
        />
      )}
    </>
  )
}

export function ContextMenu({ visible, x, y, items, onClose }: ContextMenuProps) {
  useEffect(() => {
    if (!visible) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.sanqian-context-menu-panel')) return
      onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [visible, onClose])

  if (!visible) return null

  return createPortal(
    <ContextMenuPanel items={items} x={x} y={y} onClose={onClose} />,
    document.body,
  )
}
