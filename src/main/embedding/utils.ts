/**
 * 知识库 - 工具函数
 */

/**
 * 在中文和英文/数字之间插入空格
 *
 * 解决中英文混合词（如"math公式"）无法正确分词的问题。
 * 参考：
 * - https://github.com/sparanoid/chinese-copywriting-guidelines
 * - https://github.com/vinta/pangu.js
 *
 * @param text - 原始文本
 * @returns 处理后的文本，中英文之间有空格
 */
export function normalizeCjkAscii(text: string): string {
  if (!text) return text

  // 中文后面跟英文/数字：加空格
  let result = text.replace(
    /([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])([a-zA-Z0-9])/g,
    '$1 $2'
  )
  // 英文/数字后面跟中文：加空格
  result = result.replace(
    /([a-zA-Z0-9])([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])/g,
    '$1 $2'
  )

  return result
}
