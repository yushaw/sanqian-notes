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

  // Match {{variable}} or {{variable:format}}
  // Variable can include underscore, +/- offset (e.g., daily_date, date-7, date+3)
  const result = text.replace(/\{\{(\w+)([+-]\d+)?(?::([^}]+))?\}\}/g, (match, variable, offset, format) => {
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
        // Use invisible separator as placeholder, Editor will handle cursor positioning
        replacement = '\u2063'
        break

      default:
        // Keep unknown variables as-is
        replacement = match
    }

    return replacement
  })

  // cursorOffset is deprecated - cursor is now handled via \u2063 placeholder
  return { content: result, cursorOffset: null }
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
  return /\{\{(\w+)([+-]\d+)?(?::[^}]+)?\}\}/.test(text)
}

/**
 * Translations type for template variable descriptions
 */
export interface VariableTranslations {
  title: string
  notebook: string
  date: string
  dateFormat: string
  dateOffset: string
  time: string
  week: string
  yesterday: string
  tomorrow: string
  dailyDate: string
  dailyDateOffset: string
  dailyWeek: string
  cursor: string
}

/**
 * Get list of supported template variables for help display
 * @param translations Optional translations for descriptions (falls back to Chinese)
 */
export function getTemplateVariableHelp(translations?: VariableTranslations): Array<{
  variable: string
  description: string
  example: string
}> {
  const now = dayjs()
  const t = translations ?? {
    title: '笔记标题',
    notebook: '笔记本名称',
    date: '今天日期',
    dateFormat: '自定义格式',
    dateOffset: '天前/后',
    time: '当前时间',
    week: '周数',
    yesterday: '昨天',
    tomorrow: '明天',
    dailyDate: '日记日期',
    dailyDateOffset: '日记前/后一天',
    dailyWeek: '日记周数',
    cursor: '光标位置',
  }
  return [
    // Note Info
    { variable: '{{title}}', description: t.title, example: 'My Note' },
    { variable: '{{notebook}}', description: t.notebook, example: 'Work' },

    // Current Date/Time
    { variable: '{{date}}', description: t.date, example: now.format('YYYY-MM-DD') },
    { variable: '{{date:FORMAT}}', description: t.dateFormat, example: now.format('MM/DD') },
    { variable: '{{date+N}}/{{date-N}}', description: t.dateOffset, example: now.subtract(7, 'day').format('YYYY-MM-DD') },
    { variable: '{{time}}', description: t.time, example: now.format('HH:mm') },
    { variable: '{{week}}', description: t.week, example: now.format('WW') },

    // Relative Dates
    { variable: '{{yesterday}}', description: t.yesterday, example: now.subtract(1, 'day').format('YYYY-MM-DD') },
    { variable: '{{tomorrow}}', description: t.tomorrow, example: now.add(1, 'day').format('YYYY-MM-DD') },

    // Daily Note Specific
    { variable: '{{daily_date}}', description: t.dailyDate, example: now.format('YYYY-MM-DD') },
    { variable: '{{daily_date+N}}/{{daily_date-N}}', description: t.dailyDateOffset, example: now.subtract(1, 'day').format('YYYY-MM-DD') },
    { variable: '{{daily_week}}', description: t.dailyWeek, example: now.format('WW') },

    // Cursor
    { variable: '{{cursor}}', description: t.cursor, example: '|' },
  ]
}
