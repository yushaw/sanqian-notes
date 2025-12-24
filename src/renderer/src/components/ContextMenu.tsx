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
  subItems: MenuItem[]
}

export type ContextMenuItem = MenuItem | SubMenuItem

interface ContextMenuProps {
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

function isSubMenuItem(item: ContextMenuItem): item is SubMenuItem {
  return 'subItems' in item
}

export function ContextMenu({ visible, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const subMenuRef = useRef<HTMLDivElement>(null)
  const [hoveredSubMenuIndex, setHoveredSubMenuIndex] = useState<number | null>(null)
  const [subMenuPosition, setSubMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)
  const showTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Reset submenu state when menu closes
  useEffect(() => {
    if (!visible) {
      setHoveredSubMenuIndex(null)
      setSubMenuPosition(null)
    }
  }, [visible])

  // Close on click outside
  useEffect(() => {
    if (!visible) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const isInsideMenu = menuRef.current?.contains(target)
      const isInsideSubMenu = subMenuRef.current?.contains(target)

      if (!isInsideMenu && !isInsideSubMenu) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [visible, onClose])

  // Calculate menu position to keep it within viewport
  useEffect(() => {
    if (!visible || !menuRef.current) return

    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let finalX = x
    let finalY = y

    // Adjust horizontal position
    if (x + rect.width > viewportWidth) {
      finalX = viewportWidth - rect.width - 8
    }

    // Adjust vertical position
    if (y + rect.height > viewportHeight) {
      finalY = Math.max(8, viewportHeight - rect.height - 8)
    }

    if (finalX !== x || finalY !== y) {
      menu.style.left = `${finalX}px`
      menu.style.top = `${finalY}px`
    }
  }, [visible, x, y])

  const handleSubMenuHover = (index: number, itemElement: HTMLElement) => {
    // Clear any existing hide timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }

    // Clear any existing show timer
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }

    // Add a short delay before showing submenu to avoid accidental triggers
    showTimerRef.current = setTimeout(() => {
      const rect = itemElement.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // Default: show to the right
      let left = rect.right + 4
      let top = rect.top

      // If not enough space on the right, show on the left
      if (left + 200 > viewportWidth) {
        left = rect.left - 204
      }

      // Adjust vertical position if needed
      const estimatedHeight = (items[index] as SubMenuItem).subItems.length * 32 + 8
      if (top + estimatedHeight > viewportHeight) {
        top = Math.max(8, viewportHeight - estimatedHeight - 8)
      }

      setSubMenuPosition({ top, left })
      setHoveredSubMenuIndex(index)
    }, 100) // 100ms delay to prevent accidental hover triggers
  }

  const handleSubMenuLeave = () => {
    // Clear show timer if still pending
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }

    // Add delay before hiding to allow mouse to move to submenu
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
    }
    hoverTimerRef.current = setTimeout(() => {
      setHoveredSubMenuIndex(null)
      setSubMenuPosition(null)
    }, 150)
  }

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
      }
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current)
      }
    }
  }, [])

  if (!visible) return null

  return createPortal(
    <>
      {/* Main menu */}
      <div
        ref={menuRef}
        className="fixed z-50 py-0.5 min-w-[140px] bg-[var(--color-card)]/95 backdrop-blur-xl rounded-lg shadow-lg border border-[var(--color-border)] select-none"
        style={{ left: x, top: y }}
      >
        {items.map((item, index) => {
          if (isSubMenuItem(item)) {
            return (
              <div
                key={index}
                className="relative"
                onMouseEnter={(e) => {
                  handleSubMenuHover(index, e.currentTarget)
                }}
                onMouseLeave={handleSubMenuLeave}
              >
                <button
                  className="w-full px-3 py-1.5 text-left text-[0.867rem] text-[var(--color-text)] hover:bg-[var(--color-surface)] flex items-center justify-between gap-2"
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

      {/* Submenu */}
      {hoveredSubMenuIndex !== null && subMenuPosition && isSubMenuItem(items[hoveredSubMenuIndex]) && (
        <div
          ref={subMenuRef}
          className="fixed z-[51] py-0.5 min-w-[140px] bg-[var(--color-card)]/95 backdrop-blur-xl rounded-lg shadow-lg border border-[var(--color-border)] select-none"
          style={{ left: subMenuPosition.left, top: subMenuPosition.top }}
          onMouseEnter={() => {
            // Cancel hide timer when mouse enters submenu
            if (hoverTimerRef.current) {
              clearTimeout(hoverTimerRef.current)
              hoverTimerRef.current = null
            }
          }}
          onMouseLeave={handleSubMenuLeave}
        >
          {(items[hoveredSubMenuIndex] as SubMenuItem).subItems.map((subItem, subIndex) => {
            if (subItem.divider) {
              return <div key={subIndex} className="h-px bg-[var(--color-divider)] my-1" />
            }

            return (
              <button
                key={subIndex}
                onClick={() => {
                  if (!subItem.disabled) {
                    subItem.onClick()
                    onClose()
                  }
                }}
                disabled={subItem.disabled}
                className={`w-full px-3 py-1.5 text-left text-[0.867rem] flex items-center gap-2 ${
                  subItem.danger
                    ? 'text-red-500 hover:bg-red-500/10'
                    : 'text-[var(--color-text)] hover:bg-[var(--color-surface)]'
                } ${subItem.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {subItem.icon && <span className="flex-shrink-0">{subItem.icon}</span>}
                <span>{subItem.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </>,
    document.body
  )
}
