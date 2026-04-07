import type { HTMLAttributes } from 'react'

interface WindowDragStripProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onContextMenu' | 'onContextMenuCapture'> {
  heightClassName?: string
  testId?: string
}

export function WindowDragStrip({
  heightClassName = 'h-[42px]',
  className,
  testId,
  ...rest
}: WindowDragStripProps) {
  // Electron draggable regions should not attach custom context menus.
  const fullRest = rest as HTMLAttributes<HTMLDivElement>
  const { onContextMenu, onContextMenuCapture, ...safeRest } = fullRest
  void onContextMenu
  void onContextMenuCapture

  const mergedClassName = className
    ? `${heightClassName} flex-shrink-0 drag-region ${className}`
    : `${heightClassName} flex-shrink-0 drag-region`

  return <div data-testid={testId} className={mergedClassName} {...safeRest} />
}

export default WindowDragStrip
