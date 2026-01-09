/**
 * DataviewBlock Extension
 *
 * A Tiptap extension for querying and displaying note data
 * using a DQL-like syntax similar to Obsidian Dataview
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { DataviewView } from '../DataviewView'
import { withErrorBoundary } from '../NodeViewErrorBoundary'

export interface DataviewBlockOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dataviewBlock: {
      setDataview: (attrs?: { query?: string }) => ReturnType
    }
  }
}

export const DataviewBlock = Node.create<DataviewBlockOptions>({
  name: 'dataviewBlock',

  group: 'block',

  atom: true,

  selectable: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      // The raw query string
      query: {
        default: 'LIST FROM #',
        parseHTML: (element) => element.getAttribute('data-query'),
        renderHTML: (attributes) => ({ 'data-query': attributes.query }),
      },
      // Whether showing edit mode or result mode
      isEditing: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-editing') === 'true',
        renderHTML: (attributes) => ({ 'data-editing': String(attributes.isEditing) }),
      },
      // Last execution time
      lastExecuted: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-last-executed'),
        renderHTML: (attributes) => ({ 'data-last-executed': attributes.lastExecuted || '' }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="dataview-block"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'dataview-block',
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(withErrorBoundary(DataviewView, 'Failed to render dataview'))
  },

  addCommands() {
    return {
      setDataview:
        (attrs?: { query?: string }) =>
        ({ commands }: { commands: { insertContent: (content: { type: string; attrs: unknown }) => boolean } }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              query: attrs?.query || 'LIST FROM #',
              isEditing: true,
            },
          })
        },
    } as unknown as Partial<import('@tiptap/core').RawCommands>
  },
})
