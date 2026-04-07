/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DragRegionContainer } from '../DragRegionContainer'

describe('DragRegionContainer', () => {
  it('applies drag-region class by default', () => {
    render(<DragRegionContainer data-testid="drag-region" />)

    const element = screen.getByTestId('drag-region')
    expect(element).toHaveClass('drag-region')
  })

  it('merges custom classes and forwards html props', () => {
    render(
      <DragRegionContainer
        className="header-shell"
        data-testid="drag-region"
        aria-label="header drag region"
      />
    )

    const element = screen.getByTestId('drag-region')
    expect(element).toHaveClass('drag-region')
    expect(element).toHaveClass('header-shell')
    expect(element).toHaveAttribute('aria-label', 'header drag region')
  })

  it('does not forward custom context-menu handlers onto drag surfaces', () => {
    const onContextMenu = vi.fn()
    render(<DragRegionContainer {...({ onContextMenu, 'data-testid': 'drag-region' } as any)} />)

    const element = screen.getByTestId('drag-region')
    fireEvent.contextMenu(element)
    expect(onContextMenu).not.toHaveBeenCalled()
  })
})
