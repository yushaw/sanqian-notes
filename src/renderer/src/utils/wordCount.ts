/**
 * 中英文混合字数统计
 *
 * 统计规则：
 * - 中文：每个汉字算 1 个字
 * - 英文：每个单词算 1 个字（以空格/标点分隔）
 * - 数字：连续数字算 1 个字
 */
export function countWords(text: string): number {
  if (!text || text.trim() === '') return 0

  // 移除多余空白
  const cleanText = text.trim()

  let count = 0

  // 匹配中文字符（包括中文标点）
  const chineseChars = cleanText.match(/[\u4e00-\u9fa5]/g)
  if (chineseChars) {
    count += chineseChars.length
  }

  // 移除中文字符后，统计英文单词和数字
  const nonChinese = cleanText.replace(/[\u4e00-\u9fa5]/g, ' ')

  // 匹配英文单词（字母组成）和数字
  const words = nonChinese.match(/[a-zA-Z]+|[0-9]+/g)
  if (words) {
    count += words.length
  }

  return count
}

/**
 * 从 Tiptap editor 获取纯文本并统计字数
 */
export function countWordsFromEditor(editor: { getText: () => string } | null): number {
  if (!editor) return 0
  const text = editor.getText()
  return countWords(text)
}

/**
 * 获取编辑器选中文本的字数
 * @returns 选中文本的字数，如果没有选中则返回 null
 */
export function countSelectedWords(editor: { state: { selection: { from: number; to: number; empty: boolean }; doc: { textBetween: (from: number, to: number) => string } } } | null): number | null {
  if (!editor) return null

  const { from, to, empty } = editor.state.selection
  if (empty) return null

  const selectedText = editor.state.doc.textBetween(from, to)
  return countWords(selectedText)
}
