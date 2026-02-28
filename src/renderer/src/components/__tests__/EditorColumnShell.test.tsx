/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorColumnShell } from '../EditorColumnShell'

describe('EditorColumnShell', () => {
  it('renders with shared editor shell layout classes', () => {
    render(
      <EditorColumnShell testId="editor-shell">
        <div>content</div>
      </EditorColumnShell>
    )

    const shell = screen.getByTestId('editor-shell')
    expect(shell).toHaveClass('flex-1')
    expect(shell).toHaveClass('min-h-0')
    expect(shell).toHaveClass('min-w-0')
    expect(shell).toHaveClass('overflow-hidden')
    expect(shell).toHaveClass('flex')
    expect(shell).toHaveClass('flex-col')
  })

  it('appends custom className', () => {
    render(
      <EditorColumnShell testId="editor-shell" className="relative no-drag">
        <div>content</div>
      </EditorColumnShell>
    )

    const shell = screen.getByTestId('editor-shell')
    expect(shell).toHaveClass('relative')
    expect(shell).toHaveClass('no-drag')
  })
})
