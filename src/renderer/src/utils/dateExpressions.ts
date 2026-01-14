/**
 * Date Expressions Module
 *
 * Shared date utilities for dataview, templates, and other blocks.
 * Supports Obsidian-compatible date expressions like date(today), date(sow), etc.
 */

import dayjs from 'dayjs'
import weekOfYear from 'dayjs/plugin/weekOfYear'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(weekOfYear)
dayjs.extend(isoWeek)

/**
 * Date keywords supported in date() function
 */
export type DateKeyword =
  | 'now'
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'sow' // start of week
  | 'eow' // end of week
  | 'som' // start of month
  | 'eom' // end of month
  | 'soy' // start of year
  | 'eoy' // end of year

/**
 * Range keywords that represent a date range (for = comparison)
 */
export type RangeKeyword =
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'this_year'

/**
 * Date range with start (inclusive) and end (exclusive)
 */
export interface DateRange {
  start: Date
  end: Date
}

/**
 * Check if a string is a valid date keyword
 */
export function isDateKeyword(value: string): value is DateKeyword {
  const keywords: DateKeyword[] = [
    'now',
    'today',
    'yesterday',
    'tomorrow',
    'sow',
    'eow',
    'som',
    'eom',
    'soy',
    'eoy',
  ]
  return keywords.includes(value.toLowerCase() as DateKeyword)
}

/**
 * Check if a string is a range keyword (for = comparison)
 */
export function isRangeKeyword(value: string): value is RangeKeyword {
  const keywords: RangeKeyword[] = [
    'today',
    'yesterday',
    'tomorrow',
    'this_week',
    'last_week',
    'this_month',
    'last_month',
    'this_year',
  ]
  return keywords.includes(value.toLowerCase() as RangeKeyword)
}

/**
 * Parse a date keyword and return a Date object
 *
 * @param keyword - Date keyword like 'today', 'sow', etc.
 * @returns Date object
 */
export function parseDateKeyword(keyword: DateKeyword | string): Date {
  const now = dayjs()
  const k = keyword.toLowerCase()

  switch (k) {
    case 'now':
      return now.toDate()
    case 'today':
      return now.startOf('day').toDate()
    case 'yesterday':
      return now.subtract(1, 'day').startOf('day').toDate()
    case 'tomorrow':
      return now.add(1, 'day').startOf('day').toDate()
    case 'sow': // start of week (Monday)
      return now.startOf('isoWeek').toDate()
    case 'eow': // end of week (Sunday 23:59:59)
      return now.endOf('isoWeek').toDate()
    case 'som': // start of month
      return now.startOf('month').toDate()
    case 'eom': // end of month
      return now.endOf('month').toDate()
    case 'soy': // start of year
      return now.startOf('year').toDate()
    case 'eoy': // end of year
      return now.endOf('year').toDate()
    default:
      // Try to parse as ISO date string
      const parsed = dayjs(keyword)
      if (parsed.isValid()) {
        return parsed.toDate()
      }
      throw new Error(`Invalid date keyword: ${keyword}`)
  }
}

/**
 * Get date range for a range keyword
 * Used when comparing with = operator (e.g., created = today)
 *
 * @param keyword - Range keyword like 'today', 'this_week', etc.
 * @returns DateRange with start (inclusive) and end (exclusive)
 */
export function getDateRange(keyword: RangeKeyword | string): DateRange {
  const now = dayjs()
  const k = keyword.toLowerCase()

  switch (k) {
    case 'today':
      return {
        start: now.startOf('day').toDate(),
        end: now.add(1, 'day').startOf('day').toDate(),
      }
    case 'yesterday':
      return {
        start: now.subtract(1, 'day').startOf('day').toDate(),
        end: now.startOf('day').toDate(),
      }
    case 'tomorrow':
      return {
        start: now.add(1, 'day').startOf('day').toDate(),
        end: now.add(2, 'day').startOf('day').toDate(),
      }
    case 'this_week':
      return {
        start: now.startOf('isoWeek').toDate(),
        end: now.endOf('isoWeek').add(1, 'millisecond').toDate(),
      }
    case 'last_week':
      return {
        start: now.subtract(1, 'week').startOf('isoWeek').toDate(),
        end: now.subtract(1, 'week').endOf('isoWeek').add(1, 'millisecond').toDate(),
      }
    case 'this_month':
      return {
        start: now.startOf('month').toDate(),
        end: now.endOf('month').add(1, 'millisecond').toDate(),
      }
    case 'last_month':
      return {
        start: now.subtract(1, 'month').startOf('month').toDate(),
        end: now.subtract(1, 'month').endOf('month').add(1, 'millisecond').toDate(),
      }
    case 'this_year':
      return {
        start: now.startOf('year').toDate(),
        end: now.endOf('year').add(1, 'millisecond').toDate(),
      }
    default:
      throw new Error(`Invalid range keyword: ${keyword}`)
  }
}

/**
 * Parse a date expression string
 * Supports: date(keyword), date(YYYY-MM-DD), or just keyword
 *
 * @param expression - Date expression like "date(today)" or "today" or "2024-01-15"
 * @returns Date object
 */
export function parseDateExpression(expression: string): Date {
  const trimmed = expression.trim()

  // Match date(xxx) function syntax
  const funcMatch = trimmed.match(/^date\(([^)]+)\)$/i)
  if (funcMatch) {
    const inner = funcMatch[1].trim()
    // Remove quotes if present
    const unquoted = inner.replace(/^["']|["']$/g, '')
    return parseDateKeyword(unquoted)
  }

  // Try as direct keyword
  if (isDateKeyword(trimmed)) {
    return parseDateKeyword(trimmed)
  }

  // Try as ISO date string
  const parsed = dayjs(trimmed)
  if (parsed.isValid()) {
    return parsed.toDate()
  }

  throw new Error(`Invalid date expression: ${expression}`)
}

/**
 * Check if a date falls within a range
 *
 * @param date - Date to check
 * @param range - Date range with start (inclusive) and end (exclusive)
 * @returns boolean
 */
export function isDateInRange(date: Date | string, range: DateRange): boolean {
  const d = typeof date === 'string' ? new Date(date) : date
  return d >= range.start && d < range.end
}

/**
 * Format a date for display
 *
 * @param date - Date to format
 * @param format - dayjs format string (default: 'YYYY-MM-DD')
 * @returns Formatted date string
 */
export function formatDate(date: Date, format: string = 'YYYY-MM-DD'): string {
  return dayjs(date).format(format)
}

/**
 * Get all supported date keywords with descriptions
 * Useful for help documentation
 */
export function getDateKeywordHelp(): Array<{ keyword: string; description: string; example: string }> {
  return [
    { keyword: 'today', description: '今天', example: formatDate(parseDateKeyword('today')) },
    { keyword: 'yesterday', description: '昨天', example: formatDate(parseDateKeyword('yesterday')) },
    { keyword: 'tomorrow', description: '明天', example: formatDate(parseDateKeyword('tomorrow')) },
    { keyword: 'sow', description: '本周开始', example: formatDate(parseDateKeyword('sow')) },
    { keyword: 'eow', description: '本周结束', example: formatDate(parseDateKeyword('eow')) },
    { keyword: 'som', description: '本月开始', example: formatDate(parseDateKeyword('som')) },
    { keyword: 'eom', description: '本月结束', example: formatDate(parseDateKeyword('eom')) },
    { keyword: 'soy', description: '本年开始', example: formatDate(parseDateKeyword('soy')) },
    { keyword: 'eoy', description: '本年结束', example: formatDate(parseDateKeyword('eoy')) },
  ]
}

/**
 * Get all supported range keywords with descriptions
 */
export function getRangeKeywordHelp(): Array<{ keyword: string; description: string }> {
  return [
    { keyword: 'today', description: '今天的笔记' },
    { keyword: 'yesterday', description: '昨天的笔记' },
    { keyword: 'this_week', description: '本周的笔记' },
    { keyword: 'last_week', description: '上周的笔记' },
    { keyword: 'this_month', description: '本月的笔记' },
    { keyword: 'last_month', description: '上月的笔记' },
    { keyword: 'this_year', description: '今年的笔记' },
  ]
}
