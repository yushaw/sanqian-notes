import { Node } from '@tiptap/core'

/**
 * Frontmatter block node.
 *
 * We keep frontmatter as a first-class node to avoid lossy conversion
 * through generic codeBlock(language=yaml-frontmatter).
 */
export const Frontmatter = Node.create({
  name: 'frontmatter',

  group: 'block',
  content: 'text*',

  // Make Enter produce newline inside this block like code blocks.
  code: true,

  // Keep marks out of frontmatter and keep it structurally stable.
  marks: '',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'pre[data-type="frontmatter"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['pre', { ...HTMLAttributes, 'data-type': 'frontmatter', spellcheck: 'false' }, ['code', 0]]
  },
})
