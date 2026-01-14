/**
 * Template Variables Parser
 *
 * Parses template variables like {{date}}, {{title}}, {{cursor}} in template content.
 * Supports:
 * - Basic variables: {{title}}, {{notebook}}, {{cursor}}
 * - Date variables: {{date}}, {{time}}, {{datetime}}
 * - Date with offset: {{yesterday}}, {{tomorrow}}
 * - Custom formats: {{date:YYYY-MM-DD}}, {{yesterday:MM/DD}}
 * - Daily note date: {{daily_date}} - the target date for daily notes
 */

import dayjs from 'dayjs'
import weekOfYear from 'dayjs/plugin/weekOfYear'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(weekOfYear)
dayjs.extend(isoWeek)

export interface TemplateContext {
  title: string
  notebookName: string
  /** For daily notes: the target date (may differ from today if creating past daily notes) */
  dailyDate?: string // YYYY-MM-DD format
}

export interface ParseResult {
  content: string
  cursorOffset: number | null
}

/**
 * Parse template variables in plain text
 * @param text Text containing template variables
 * @param context Current note context
 * @returns Parsed text and optional cursor position
 */
export function parseTemplateText(text: string, context: TemplateContext): ParseResult {
  const now = dayjs()
  // For daily notes, use the target date; otherwise use today
  const dailyDate = context.dailyDate ? dayjs(context.dailyDate) : now

  let cursorOffset: number | null = null
  let currentOffset = 0

  // Match {{variable}} or {{variable:format}}
  // Variable can include underscore, +/- offset (e.g., daily_date, date-7, date+3)
  const result = text.replace(/\{\{(\w+)([+-]\d+)?(?::([^}]+))?\}\}/g, (match, variable, offset, format, matchOffset) => {
    let replacement = ''
    const varLower = variable.toLowerCase()
    const offsetDays = offset ? parseInt(offset, 10) : 0

    switch (varLower) {
      // === Note Info ===
      case 'title':
        replacement = context.title || ''
        break
      case 'notebook':
        replacement = context.notebookName || ''
        break

      // === Current Date/Time (with optional offset) ===
      case 'date': {
        const targetDate = offsetDays !== 0 ? now.add(offsetDays, 'day') : now
        replacement = targetDate.format(format || 'YYYY-MM-DD')
        break
      }
      case 'time':
        replacement = now.format(format || 'HH:mm')
        break
      case 'datetime':
        replacement = now.format(format || 'YYYY-MM-DD HH:mm')
        break

      // === Week Number ===
      case 'week':
        // ISO week number (1-53)
        replacement = now.format(format || 'WW')
        break

      // === Relative Dates ===
      case 'yesterday':
        replacement = now.subtract(1, 'day').format(format || 'YYYY-MM-DD')
        break
      case 'tomorrow':
        replacement = now.add(1, 'day').format(format || 'YYYY-MM-DD')
        break

      // === Daily Note Specific ===
      case 'daily_date': {
        // The target date for daily notes (may be different from today)
        const targetDate = offsetDays !== 0 ? dailyDate.add(offsetDays, 'day') : dailyDate
        replacement = targetDate.format(format || 'YYYY-MM-DD')
        break
      }
      case 'daily_yesterday':
        // Yesterday relative to the daily note's date
        replacement = dailyDate.subtract(1, 'day').format(format || 'YYYY-MM-DD')
        break
      case 'daily_tomorrow':
        // Tomorrow relative to the daily note's date
        replacement = dailyDate.add(1, 'day').format(format || 'YYYY-MM-DD')
        break
      case 'daily_week':
        // Week number of the daily note's date
        replacement = dailyDate.format(format || 'WW')
        break

      // === Cursor ===
      case 'cursor':
        // Record cursor position (adjusted for previous replacements)
        cursorOffset = currentOffset + matchOffset
        replacement = ''
        break

      default:
        // Keep unknown variables as-is
        replacement = match
    }

    // Track offset adjustment
    currentOffset += replacement.length - match.length

    return replacement
  })

  return { content: result, cursorOffset }
}

/**
 * Parse template variables in Markdown content
 * @param markdownContent Markdown content string
 * @param context Current note context
 * @returns Parsed Markdown string and cursor offset
 */
export function parseTemplateContent(
  markdownContent: string,
  context: TemplateContext
): {
  content: string
  cursorPosition: number | null
} {
  const { content, cursorOffset } = parseTemplateText(markdownContent, context)
  return {
    content,
    cursorPosition: cursorOffset
  }
}

/**
 * Check if content contains any template variables
 */
export function hasTemplateVariables(text: string): boolean {
  return /\{\{(\w+)(?::[^}]+)?\}\}/.test(text)
}

/**
 * Get list of supported template variables for help display
 */
export function getTemplateVariableHelp(): Array<{
  variable: string
  description: string
  example: string
}> {
  const now = dayjs()
  return [
    // Note Info
    { variable: '{{title}}', description: '笔记标题', example: 'My Note' },
    { variable: '{{notebook}}', description: '笔记本名称', example: 'Work' },

    // Current Date/Time
    { variable: '{{date}}', description: '今天日期', example: now.format('YYYY-MM-DD') },
    { variable: '{{date:FORMAT}}', description: '自定义格式', example: now.format('MM/DD') },
    { variable: '{{date-7}}', description: '7天前', example: now.subtract(7, 'day').format('YYYY-MM-DD') },
    { variable: '{{date+7}}', description: '7天后', example: now.add(7, 'day').format('YYYY-MM-DD') },
    { variable: '{{time}}', description: '当前时间', example: now.format('HH:mm') },
    { variable: '{{week}}', description: '周数', example: now.format('WW') },

    // Relative Dates
    { variable: '{{yesterday}}', description: '昨天', example: now.subtract(1, 'day').format('YYYY-MM-DD') },
    { variable: '{{tomorrow}}', description: '明天', example: now.add(1, 'day').format('YYYY-MM-DD') },

    // Daily Note Specific
    { variable: '{{daily_date}}', description: '日记日期', example: now.format('YYYY-MM-DD') },
    { variable: '{{daily_date-1}}', description: '日记前一天', example: now.subtract(1, 'day').format('YYYY-MM-DD') },
    { variable: '{{daily_week}}', description: '日记周数', example: now.format('WW') },

    // Cursor
    { variable: '{{cursor}}', description: '光标位置', example: '|' },
  ]
}

/**
 * Get variable categories for organized help display
 */
export function getTemplateVariableCategories(): Array<{
  category: string
  variables: Array<{ variable: string; description: string; example: string }>
}> {
  const now = dayjs()
  return [
    {
      category: '笔记信息',
      variables: [
        { variable: '{{title}}', description: '笔记标题', example: 'My Note' },
        { variable: '{{notebook}}', description: '笔记本名称', example: 'Work' },
      ]
    },
    {
      category: '日期时间',
      variables: [
        { variable: '{{date}}', description: '今天', example: now.format('YYYY-MM-DD') },
        { variable: '{{date±N}}', description: 'N天偏移', example: now.subtract(7, 'day').format('YYYY-MM-DD') },
        { variable: '{{yesterday}}', description: '昨天', example: now.subtract(1, 'day').format('YYYY-MM-DD') },
        { variable: '{{tomorrow}}', description: '明天', example: now.add(1, 'day').format('YYYY-MM-DD') },
        { variable: '{{time}}', description: '时间', example: now.format('HH:mm') },
        { variable: '{{week}}', description: '周数', example: now.format('WW') },
      ]
    },
    {
      category: '日记专用',
      variables: [
        { variable: '{{daily_date}}', description: '日记日期', example: now.format('YYYY-MM-DD') },
        { variable: '{{daily_date±N}}', description: '日记偏移', example: now.subtract(1, 'day').format('YYYY-MM-DD') },
        { variable: '{{daily_week}}', description: '日记周数', example: now.format('WW') },
      ]
    },
    {
      category: '其他',
      variables: [
        { variable: '{{cursor}}', description: '光标位置', example: '|' },
      ]
    },
  ]
}
