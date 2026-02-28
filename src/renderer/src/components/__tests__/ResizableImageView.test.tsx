/**
 * ResizableImageView regression tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ResizableImageView } from '../ResizableImageView'

vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
}))

vi.mock('../../i18n', () => ({
  useTranslations: () => ({
    media: {
      imageLoadFailed: 'Failed',
      alignLeft: 'Left',
      alignCenter: 'Center',
      alignRight: 'Right',
    },
  }),
}))

describe('ResizableImageView open behavior', () => {
  it('does not persist width/height when computing runtime default size on image load', () => {
    const updateAttributes = vi.fn()
    const { container } = render(
      <ResizableImageView
        node={{
          attrs: {
            src: 'https://example.com/large.png',
            alt: '',
            title: '',
            width: undefined,
            height: undefined,
            align: 'center',
          },
        } as never}
        updateAttributes={updateAttributes}
        selected={false}
        editor={null as never}
        getPos={(() => 0) as never}
        deleteNode={vi.fn() as never}
        extension={null as never}
        decorations={[] as never}
        innerDecorations={null as never}
        view={null as never}
        HTMLAttributes={{}}
      />
    )

    const image = container.querySelector('img')
    expect(image).toBeTruthy()
    if (!image) return

    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 2600 })
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1600 })
    fireEvent.load(image)

    expect(updateAttributes).not.toHaveBeenCalled()
  })
})
