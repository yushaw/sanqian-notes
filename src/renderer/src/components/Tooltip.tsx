/**
 * Lightweight Tooltip component using @floating-ui/react
 * Shows immediately on hover (no delay)
 */
import { useState, ReactNode } from 'react'
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  Placement,
} from '@floating-ui/react'

interface TooltipProps {
  content: string
  children: ReactNode
  placement?: Placement
  delay?: number
}

export function Tooltip({
  content,
  children,
  placement = 'right',
  delay = 0,
}: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    middleware: [
      offset(6),
      flip({ fallbackPlacements: ['left', 'top', 'bottom'] }),
      shift({ padding: 8 }),
    ],
    whileElementsMounted: autoUpdate,
  })

  const hover = useHover(context, {
    delay: { open: delay, close: 0 },
  })
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ])

  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} className="inline-flex">
        {children}
      </span>
      {isOpen && content && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[9999] px-2 py-1.5 text-xs rounded-md bg-[var(--color-card)] text-[var(--color-text)] border border-[var(--color-border)] shadow-lg whitespace-nowrap pointer-events-none"
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
