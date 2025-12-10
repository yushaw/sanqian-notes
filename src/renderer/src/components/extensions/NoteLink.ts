import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface NoteLinkOptions {
  HTMLAttributes: Record<string, unknown>
  onNoteClick?: (noteId: string, noteTitle: string, target?: { type: 'heading' | 'block'; value: string }) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    noteLink: {
      setNoteLink: (attributes: {
        noteId: string
        noteTitle: string
        targetType?: 'note' | 'heading' | 'block'
        targetValue?: string // 标题文本或 blockId
      }) => ReturnType
      unsetNoteLink: () => ReturnType
    }
  }
}

export const NoteLink = Mark.create<NoteLinkOptions>({
  name: 'noteLink',

  priority: 1000,

  keepOnSplit: false,

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'note-link',
      },
      onNoteClick: undefined,
    }
  },

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: element => element.getAttribute('data-note-id'),
        renderHTML: attributes => {
          if (!attributes.noteId) return {}
          return { 'data-note-id': attributes.noteId }
        },
      },
      noteTitle: {
        default: null,
        parseHTML: element => element.getAttribute('data-note-title'),
        renderHTML: attributes => {
          if (!attributes.noteTitle) return {}
          return { 'data-note-title': attributes.noteTitle }
        },
      },
      // 目标类型: note | heading | block
      targetType: {
        default: 'note',
        parseHTML: element => element.getAttribute('data-target-type') || 'note',
        renderHTML: attributes => {
          if (!attributes.targetType || attributes.targetType === 'note') return {}
          return { 'data-target-type': attributes.targetType }
        },
      },
      // 目标值: 标题文本 或 blockId
      targetValue: {
        default: null,
        parseHTML: element => element.getAttribute('data-target-value'),
        renderHTML: attributes => {
          if (!attributes.targetValue) return {}
          return { 'data-target-value': attributes.targetValue }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-note-link]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // 根据目标类型添加不同的 class
    const targetType = HTMLAttributes['data-target-type'] || 'note'
    const baseClass = this.options.HTMLAttributes.class || 'note-link'
    const className = targetType !== 'note' ? `${baseClass} note-link-${targetType}` : baseClass

    return [
      'span',
      mergeAttributes(
        { ...this.options.HTMLAttributes, class: className },
        HTMLAttributes,
        { 'data-note-link': '' }
      ),
      0,
    ]
  },

  addCommands() {
    return {
      setNoteLink:
        attributes =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes)
        },
      unsetNoteLink:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },

  addProseMirrorPlugins() {
    const { onNoteClick } = this.options

    return [
      new Plugin({
        key: new PluginKey('noteLinkClick'),
        props: {
          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement
            if (target.hasAttribute('data-note-link')) {
              const noteId = target.getAttribute('data-note-id')
              const noteTitle = target.getAttribute('data-note-title')
              const targetType = target.getAttribute('data-target-type') as 'heading' | 'block' | null
              const targetValue = target.getAttribute('data-target-value')

              if (noteId && noteTitle && onNoteClick) {
                if (targetType && targetValue) {
                  onNoteClick(noteId, noteTitle, { type: targetType, value: targetValue })
                } else {
                  onNoteClick(noteId, noteTitle)
                }
                return true
              }
            }
            return false
          },
        },
      }),
    ]
  },
})
