/**
 * @vitest-environment jsdom
 */
import { fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LinkPopover } from '../LinkPopover'

vi.mock('../../../i18n', () => ({
  useTranslations: () => ({
    contextMenu: {
      linkUrlPlaceholder: 'Enter URL...',
      editLink: 'Edit Link',
      openLink: 'Open in Browser',
      removeLink: 'Remove Link',
    },
  }),
}))

vi.mock('@floating-ui/react', () => ({
  useFloating: () => ({
    refs: {
      setReference: vi.fn(),
      setFloating: vi.fn(),
    },
    floatingStyles: {},
  }),
  offset: vi.fn(),
  flip: vi.fn(),
  shift: vi.fn(),
  autoUpdate: vi.fn(),
  FloatingPortal: ({ children }: { children: ReactNode }) => children,
}))

function createEditorMock(runResult = true) {
  const chain = {
    focus: vi.fn(() => chain),
    setTextSelection: vi.fn(() => chain),
    extendMarkRange: vi.fn(() => chain),
    setLink: vi.fn(() => chain),
    unsetLink: vi.fn(() => chain),
    run: vi.fn(() => runResult),
  }

  return {
    chain: vi.fn(() => chain),
    commands: {
      focus: vi.fn(),
      setTextSelection: vi.fn(),
    },
    view: {
      posAtDOM: vi.fn(() => 5),
    },
    schema: {
      marks: {
        link: {
          create: vi.fn(),
        },
      },
    },
    __chain: chain,
  }
}

describe('LinkPopover', () => {
  it('uses the validated link command path for saved selections', () => {
    const editor = createEditorMock(true)
    const onClose = vi.fn()
    const anchorEl = document.createElement('a')
    document.body.appendChild(anchorEl)

    const { container } = render(
      <LinkPopover
        editor={editor as never}
        anchorEl={anchorEl}
        href=""
        editMode={true}
        savedSelection={{ from: 2, to: 6 }}
        onClose={onClose}
      />
    )

    const input = container.querySelector('.link-popover-input') as HTMLInputElement
    const saveButton = container.querySelector('.link-popover-save-btn') as HTMLButtonElement

    fireEvent.change(input, { target: { value: 'https://example.com' } })
    fireEvent.click(saveButton)

    expect(editor.__chain.setTextSelection).toHaveBeenCalledWith({ from: 2, to: 6 })
    expect(editor.__chain.setLink).toHaveBeenCalledWith({ href: 'https://example.com' })
    expect(editor.schema.marks.link.create).not.toHaveBeenCalled()
    expect(editor.commands.focus).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the editor open when link validation rejects the URL', () => {
    const editor = createEditorMock(false)
    const onClose = vi.fn()
    const anchorEl = document.createElement('a')
    document.body.appendChild(anchorEl)

    const { container } = render(
      <LinkPopover
        editor={editor as never}
        anchorEl={anchorEl}
        href=""
        editMode={true}
        savedSelection={{ from: 2, to: 6 }}
        onClose={onClose}
      />
    )

    const input = container.querySelector('.link-popover-input') as HTMLInputElement
    const saveButton = container.querySelector('.link-popover-save-btn') as HTMLButtonElement

    fireEvent.change(input, { target: { value: 'not-a-valid-url' } })
    fireEvent.click(saveButton)

    expect(editor.__chain.setLink).toHaveBeenCalledWith({ href: 'not-a-valid-url' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('delegates hover enter and leave events back to the editor container', () => {
    const editor = createEditorMock(true)
    const onHoverEnter = vi.fn()
    const onHoverLeave = vi.fn()
    const anchorEl = document.createElement('a')
    document.body.appendChild(anchorEl)

    const { container } = render(
      <LinkPopover
        editor={editor as never}
        anchorEl={anchorEl}
        href="https://example.com"
        isHover={true}
        onHoverEnter={onHoverEnter}
        onHoverLeave={onHoverLeave}
        onClose={vi.fn()}
      />
    )

    const popover = container.querySelector('.link-popover') as HTMLDivElement

    fireEvent.mouseEnter(popover)
    fireEvent.mouseLeave(popover)

    expect(onHoverEnter).toHaveBeenCalledTimes(1)
    expect(onHoverLeave).toHaveBeenCalledTimes(1)
  })
})
