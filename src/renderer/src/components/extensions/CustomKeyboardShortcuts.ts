/**
 * CustomKeyboardShortcuts - 自定义快捷键扩展
 *
 * 参考业界标准设计，采用 Typora/Bear 风格的简洁快捷键：
 * - 基础格式：⌘B/I/U（业界标准）
 * - 标题：⌘1-4（最简洁，参考 Typora/Bear）
 * - 列表：⌘⇧U/O/X（语义化，U=Unordered, O=Ordered, X=checkbox）
 * - 块元素：⌘⇧.（引用）、⌘⌥C（代码块）
 */

import { Extension } from '@tiptap/core'

// 声明 Tiptap 扩展命令类型
declare module '@tiptap/core' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    customKeyboardShortcuts: Record<string, never>
  }
}

export const CustomKeyboardShortcuts = Extension.create({
  name: 'customKeyboardShortcuts',

  addKeyboardShortcuts() {
    return {
      // ============ 标题 H1-H4（⌘1-4 / Ctrl+1-4）============
      'Mod-1': () => this.editor.commands.toggleHeading({ level: 1 }),
      'Mod-2': () => this.editor.commands.toggleHeading({ level: 2 }),
      'Mod-3': () => this.editor.commands.toggleHeading({ level: 3 }),
      'Mod-4': () => this.editor.commands.toggleHeading({ level: 4 }),
      // ⌘0 恢复正文
      'Mod-0': () => this.editor.commands.setParagraph(),

      // ============ 列表（语义化快捷键）============
      // 无序列表：⌘⇧U (U = Unordered)
      'Mod-Shift-u': () => this.editor.commands.toggleBulletList(),
      // 有序列表：⌘⇧O (O = Ordered)
      'Mod-Shift-o': () => this.editor.commands.toggleOrderedList(),
      // 任务列表：⌘⇧X (X = checkbox)
      'Mod-Shift-x': () => this.editor.commands.toggleTaskList(),

      // ============ 块元素 ============
      // 引用块：⌘⇧. (. 像引号)
      'Mod-Shift-.': () => this.editor.commands.toggleBlockquote(),
      // 代码块：⌘⌥C (C = Code)
      'Mod-Alt-c': () => this.editor.commands.toggleCodeBlock(),

      // ============ 文本格式（补充 Tiptap 默认没有的）============
      // 删除线：⌘⇧S
      'Mod-Shift-s': () => this.editor.commands.toggleStrike(),
      // 高亮：⌘⇧H (H = Highlight)
      'Mod-Shift-h': () => this.editor.commands.toggleHighlight(),
      // 行内代码：⌘⇧E
      'Mod-Shift-e': () => this.editor.commands.toggleCode(),
    }
  },
})
