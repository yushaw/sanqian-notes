import type { ReactNode } from 'react'

const EDITOR_COLUMN_SHELL_BASE_CLASS =
  'flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col'

interface EditorColumnShellProps {
  children: ReactNode
  className?: string
  testId?: string
}

export function EditorColumnShell({ children, className, testId }: EditorColumnShellProps) {
  const mergedClassName = className
    ? `${EDITOR_COLUMN_SHELL_BASE_CLASS} ${className}`
    : EDITOR_COLUMN_SHELL_BASE_CLASS

  return (
    <div data-testid={testId} className={mergedClassName}>
      {children}
    </div>
  )
}

export default EditorColumnShell
