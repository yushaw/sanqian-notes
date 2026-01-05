/**
 * 导出器基类
 */

import { jsonToMarkdown } from '../markdown'
import type { Note, Notebook } from '../../shared/types'
import type { ExportOptions, ExportResult } from './types'

export abstract class BaseExporter {
  /** 导出器 ID */
  abstract readonly id: string

  /** 显示名称 */
  abstract readonly name: string

  /** 文件扩展名 */
  abstract readonly extension: string

  /** 执行导出 */
  abstract export(options: ExportOptions): Promise<ExportResult>

  // ========== 工具方法 ==========

  /**
   * TipTap JSON → Markdown
   */
  protected contentToMarkdown(content: string): string {
    return jsonToMarkdown(content)
  }

  /**
   * 生成 YAML front matter
   */
  protected generateFrontMatter(note: Note, notebook?: Notebook): string {
    const lines: string[] = ['---']

    // 标题
    lines.push(`title: "${this.escapeYamlString(note.title)}"`)

    // 创建和更新时间
    lines.push(`created: ${note.created_at}`)
    lines.push(`updated: ${note.updated_at}`)

    // 笔记本
    if (notebook) {
      lines.push(`notebook: "${this.escapeYamlString(notebook.name)}"`)
    }

    // 标签
    if (note.tags && note.tags.length > 0) {
      const tagNames = note.tags.map((t) => t.name)
      lines.push(`tags:`)
      for (const tag of tagNames) {
        lines.push(`  - "${this.escapeYamlString(tag)}"`)
      }
    }

    // 特殊属性
    if (note.is_favorite) {
      lines.push(`favorite: true`)
    }
    if (note.is_pinned) {
      lines.push(`pinned: true`)
    }
    if (note.is_daily && note.daily_date) {
      lines.push(`daily: true`)
      lines.push(`daily_date: ${note.daily_date}`)
    }

    lines.push('---')
    lines.push('')

    return lines.join('\n')
  }

  /**
   * 转义 YAML 字符串中的特殊字符
   */
  protected escapeYamlString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  }

  /**
   * 安全文件名（移除非法字符）
   */
  protected sanitizeFileName(name: string): string {
    return (
      name
        // 移除 Windows/Unix 非法字符
        .replace(/[<>:"/\\|?*]/g, '-')
        // 移除控制字符
        .replace(/[\x00-\x1f\x7f]/g, '')
        // 合并多个空格
        .replace(/\s+/g, ' ')
        // 移除首尾空格和点
        .replace(/^[\s.]+|[\s.]+$/g, '')
        // 限制长度
        .substring(0, 200) || 'untitled'
    )
  }

  /**
   * 生成唯一文件名（处理同名冲突）
   */
  protected makeUniqueFileName(baseName: string, existingNames: Set<string>, extension: string): string {
    let name = baseName
    let counter = 1

    while (existingNames.has(`${name}${extension}`)) {
      name = `${baseName} (${counter})`
      counter++
    }

    existingNames.add(`${name}${extension}`)
    return `${name}${extension}`
  }

  /**
   * 计算文件大小（字节）
   */
  protected getByteLength(str: string): number {
    return Buffer.byteLength(str, 'utf8')
  }
}
