/**
 * ContextMenu 组件测试
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ContextMenu } from '../ContextMenu'

describe('ContextMenu', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('opens nested submenus on hover and keeps parent items clickable', async () => {
    vi.useFakeTimers()

    const onClose = vi.fn()
    const onMoveToNotebook = vi.fn()
    const onMoveToFolder = vi.fn()
    const onMoveToNestedFolder = vi.fn()

    render(
      <ContextMenu
        visible
        x={120}
        y={80}
        onClose={onClose}
        items={[
          {
            label: 'Work',
            onClick: onMoveToNotebook,
            subItems: [
              {
                label: 'Projects',
                onClick: onMoveToFolder,
                subItems: [
                  {
                    label: 'Alpha',
                    onClick: onMoveToNestedFolder,
                  },
                ],
              },
            ],
          },
        ]}
      />
    )

    const workButton = screen.getByRole('button', { name: 'Work' })
    await act(async () => {
      fireEvent.mouseEnter(workButton.parentElement!)
      vi.advanceTimersByTime(110)
    })

    const projectsButton = screen.getByRole('button', { name: 'Projects' })
    expect(projectsButton).toBeInTheDocument()

    await act(async () => {
      fireEvent.mouseEnter(projectsButton.parentElement!)
      vi.advanceTimersByTime(110)
    })

    const alphaButton = screen.getByRole('button', { name: 'Alpha' })
    expect(alphaButton).toBeInTheDocument()

    fireEvent.click(workButton)
    expect(onMoveToNotebook).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps ancestor submenu open while moving into a deeper submenu', async () => {
    vi.useFakeTimers()

    render(
      <ContextMenu
        visible
        x={120}
        y={80}
        onClose={vi.fn()}
        items={[
          {
            label: 'Work',
            subItems: [
              {
                label: 'Projects',
                subItems: [
                  {
                    label: 'Alpha',
                    onClick: vi.fn(),
                  },
                ],
              },
            ],
          },
        ]}
      />
    )

    const workButton = screen.getByRole('button', { name: 'Work' })
    await act(async () => {
      fireEvent.mouseEnter(workButton.parentElement!)
      vi.advanceTimersByTime(110)
    })

    const projectsButton = screen.getByRole('button', { name: 'Projects' })
    await act(async () => {
      fireEvent.mouseEnter(projectsButton.parentElement!)
      vi.advanceTimersByTime(110)
    })

    const menuPanels = document.querySelectorAll('.sanqian-context-menu-panel')
    expect(menuPanels).toHaveLength(3)

    await act(async () => {
      fireEvent.mouseLeave(menuPanels[1])
      fireEvent.mouseEnter(menuPanels[2])
      vi.advanceTimersByTime(200)
    })

    expect(screen.getByRole('button', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
  })
})
