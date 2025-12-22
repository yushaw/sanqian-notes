/**
 * 快捷键配置 - 统一管理所有快捷键显示
 *
 * 设计原则（参考 Typora/Bear）：
 * - 基础格式：⌘B/I/U（业界标准）
 * - 标题：⌘1-4（最简洁）
 * - 列表：⌘⇧U/O/X（语义化）
 * - 块元素：⌘⇧.（引用）、⌘⌥C（代码块）
 */

import { isMacOS } from './platform'

// 平台检测
export const isMac = isMacOS()

// 修饰键符号
const mod = isMac ? '⌘' : 'Ctrl+'
const shift = isMac ? '⇧' : 'Shift+'
const alt = isMac ? '⌥' : 'Alt+'

// 快捷键映射
export const shortcuts = {
  // 文本格式
  bold: `${mod}B`,
  italic: `${mod}I`,
  underline: `${mod}U`,
  strike: `${mod}${shift}S`,
  highlight: `${mod}${shift}H`,
  code: `${mod}${shift}E`,
  link: `${mod}K`,

  // 标题
  body: `${mod}0`,
  h1: `${mod}1`,
  h2: `${mod}2`,
  h3: `${mod}3`,
  h4: `${mod}4`,

  // 列表
  bulletList: `${mod}${shift}U`,
  orderedList: `${mod}${shift}O`,
  taskList: `${mod}${shift}X`,

  // 块元素
  quote: `${mod}${shift}.`,
  codeBlock: `${mod}${alt}C`,

  // 其他
  toggleList: `${mod}${shift}T`,  // Toggle 折叠
  callout: `${mod}${shift}C`,     // Callout
  footnote: `${mod}${shift}F`,    // 脚注
}
