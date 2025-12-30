/**
 * 知识库 - 工具函数
 */

import crypto from 'crypto'

/**
 * 计算内容哈希（MD5 前 16 位）
 *
 * 用于：
 * - Chunk 级增量更新检测
 * - 笔记内容变化快速判断
 *
 * 设计决策：使用 16 位 hex（64 bit）而非完整 MD5
 * - 碰撞概率：约 1/2^32（生日悖论），在几千个 chunks 时极低
 * - 对于个人笔记应用，这个风险可以接受
 * - 优势：chunkId 更短，存储和索引更高效
 *
 * @param content - 文本内容
 * @returns 16 位哈希字符串
 */
export function computeContentHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 16)
}

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
