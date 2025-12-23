import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { AudioView } from '../AudioView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    audio: {
      setAudio: (options: { src: string; title?: string }) => ReturnType
    }
  }
}

export const Audio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      title: {
        default: '音频',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'audio[src]',
      },
      {
        tag: 'div[data-audio]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ 'data-audio': '' }),
      ['audio', mergeAttributes(HTMLAttributes, { controls: true })],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioView)
  },

  addCommands() {
    return {
      setAudio:
        (options: { src: string; title?: string }) =>
        ({ commands }: { commands: { insertContent: (content: unknown) => boolean } }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    } as unknown as Partial<import('@tiptap/core').RawCommands>
  },
})
