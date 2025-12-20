import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { FileAttachmentView } from '../FileAttachmentView'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fileAttachment: {
      setFileAttachment: (options: { src: string; name: string; size?: number; type?: string }) => ReturnType
    }
  }
}

export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      name: {
        default: '附件',
      },
      size: {
        default: null,
      },
      type: {
        default: null,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-file-attachment]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-file-attachment': '' }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView)
  },

  addCommands() {
    return {
      setFileAttachment:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
    }
  },
})
