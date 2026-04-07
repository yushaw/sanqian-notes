/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WindowDragStrip } from '../WindowDragStrip'

describe('WindowDragStrip', () => {
  it('renders default drag region classes', () => {
    render(<WindowDragStrip testId="drag-strip" />)

    const strip = screen.getByTestId('drag-strip')
    expect(strip).toHaveClass('drag-region')
    expect(strip).toHaveClass('flex-shrink-0')
    expect(strip).toHaveClass('h-[42px]')
  })

  it('accepts custom height and class names', () => {
    render(<WindowDragStrip testId="drag-strip" heightClassName="h-[50px]" className="bg-red-500" />)

    const strip = screen.getByTestId('drag-strip')
    expect(strip).toHaveClass('h-[50px]')
    expect(strip).toHaveClass('bg-red-500')
  })

  it('does not forward custom context-menu handlers onto drag surfaces', () => {
    const onContextMenu = vi.fn()
    render(<WindowDragStrip {...({ onContextMenu, testId: 'drag-strip' } as any)} />)

    const strip = screen.getByTestId('drag-strip')
    fireEvent.contextMenu(strip)
    expect(onContextMenu).not.toHaveBeenCalled()
  })
})
