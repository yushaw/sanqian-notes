import type { HTMLAttributes } from 'react'

type DragRegionContainerProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'onContextMenu' | 'onContextMenuCapture'
>

export function DragRegionContainer({ className, ...rest }: DragRegionContainerProps) {
  // Electron draggable regions should not attach custom context menus.
  const fullRest = rest as HTMLAttributes<HTMLDivElement>
  const { onContextMenu, onContextMenuCapture, ...safeRest } = fullRest
  void onContextMenu
  void onContextMenuCapture

  const mergedClassName = className ? `drag-region ${className}` : 'drag-region'
  return <div className={mergedClassName} {...safeRest} />
}

export default DragRegionContainer
