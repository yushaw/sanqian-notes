import { Node, mergeAttributes, wrappingInputRule } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { CalloutView } from '../CalloutView'

export type CalloutType = 'note' | 'tip' | 'warning' | 'danger' | 'info' | 'quote'

export const CALLOUT_TYPES: Record<CalloutType, { icon: string; color: string }> = {
  note: { icon: '📝', color: '#3b82f6' },
  tip: { icon: '💡', color: '#22c55e' },
  warning: { icon: '⚠️', color: '#f59e0b' },
  danger: { icon: '🚨', color: '#ef4444' },
  info: { icon: 'ℹ️', color: '#6366f1' },
  quote: { icon: '💬', color: '#6b7280' },
}

// Obsidian 语法: > [!note] 或 > [!tip] 等
const calloutInputRegex = /^>\s?\[!(\w+)\]\s?(.*)$/

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attributes?: { type?: CalloutType; title?: string }) => ReturnType
      toggleCallout: (attributes?: { type?: CalloutType; title?: string }) => ReturnType
      updateCallout: (attributes: { type?: CalloutType; title?: string; collapsed?: boolean }) => ReturnType
    }
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note',
        parseHTML: (element) => element.getAttribute('data-callout-type') || 'note',
        renderHTML: (attributes) => ({ 'data-callout-type': attributes.type }),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-callout-title'),
        renderHTML: (attributes) => {
          if (!attributes.title) return {}
          return { 'data-callout-title': attributes.title }
        },
      },
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-collapsed') === 'true',
        renderHTML: (attributes) => {
          if (!attributes.collapsed) return {}
          return { 'data-collapsed': 'true' }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-callout]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            type: el.getAttribute('data-callout-type') || 'note',
            title: el.getAttribute('data-callout-title'),
            collapsed: el.getAttribute('data-collapsed') === 'true',
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout': '',
        class: `callout callout-${HTMLAttributes['data-callout-type'] || 'note'}`,
      }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },

  addCommands() {
    return {
      setCallout:
        (attributes?: { type?: CalloutType; title?: string }) =>
        ({ commands }: { commands: { wrapIn: (name: string, attrs?: unknown) => boolean } }) => {
          return commands.wrapIn(this.name, attributes)
        },
      toggleCallout:
        (attributes?: { type?: CalloutType; title?: string }) =>
        ({ commands }: { commands: { toggleWrap: (name: string, attrs?: unknown) => boolean } }) => {
          return commands.toggleWrap(this.name, attributes)
        },
      updateCallout:
        (attributes: { type?: CalloutType; title?: string }) =>
        ({ commands }: { commands: { updateAttributes: (name: string, attrs: unknown) => boolean } }) => {
          return commands.updateAttributes(this.name, attributes)
        },
    } as unknown as Partial<import('@tiptap/core').RawCommands>
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: calloutInputRegex,
        type: this.type,
        getAttributes: (match) => ({
          type: (match[1]?.toLowerCase() as CalloutType) || 'note',
          title: match[2] || null,
        }),
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-c': () => this.editor.commands.toggleCallout({ type: 'note' }),
    }
  },
})
