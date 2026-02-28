import type { Node as PMNode } from '@tiptap/pm/model'
import type { Slice } from '@tiptap/pm/model'

/**
 * Serialize a ProseMirror clipboard slice to plain text, correctly formatting
 * nested bullet / ordered / task lists with indentation.
 *
 * Shared between Editor.tsx and TypewriterMode.tsx.
 */
export function serializeClipboardText(slice: Slice): string {
  const lines: string[] = []

  const serializeNode = (
    node: PMNode,
    indent: number = 0,
    listType?: 'bullet' | 'ordered' | 'task',
    listIndex?: number
  ) => {
    const indentStr = '  '.repeat(indent)

    if (node.type.name === 'bulletList') {
      node.content.forEach((child) => {
        serializeNode(child, indent, 'bullet')
      })
    } else if (node.type.name === 'orderedList') {
      let idx = 1
      node.content.forEach((child) => {
        serializeNode(child, indent, 'ordered', idx++)
      })
    } else if (node.type.name === 'taskList') {
      node.content.forEach((child) => {
        serializeNode(child, indent, 'task')
      })
    } else if (node.type.name === 'listItem') {
      const prefix = listType === 'ordered' ? `${listIndex}. ` : '\u2022 '
      const textParts: string[] = []
      node.content.forEach((child) => {
        if (!['bulletList', 'orderedList', 'taskList'].includes(child.type.name)) {
          const childText = child.textContent
          if (childText) textParts.push(childText)
        }
      })
      const text = textParts.join(' ')
      if (text) {
        lines.push(indentStr + prefix + text)
      }
      node.content.forEach((child) => {
        if (['bulletList', 'orderedList', 'taskList'].includes(child.type.name)) {
          serializeNode(child, indent + 1)
        }
      })
    } else if (node.type.name === 'taskItem') {
      const checked = node.attrs?.checked ? '\u2611' : '\u2610'
      const textParts: string[] = []
      node.content.forEach((child) => {
        if (!['bulletList', 'orderedList', 'taskList'].includes(child.type.name)) {
          const childText = child.textContent
          if (childText) textParts.push(childText)
        }
      })
      const text = textParts.join(' ')
      if (text) {
        lines.push(indentStr + checked + ' ' + text)
      }
      node.content.forEach((child) => {
        if (['bulletList', 'orderedList', 'taskList'].includes(child.type.name)) {
          serializeNode(child, indent + 1)
        }
      })
    } else if (node.isBlock) {
      const text = node.textContent
      if (text) {
        lines.push(text)
      } else if (node.type.name === 'paragraph' && lines.length > 0) {
        lines.push('')
      }
    }
  }

  slice.content.forEach((node) => {
    serializeNode(node)
  })

  return lines.join('\n')
}
