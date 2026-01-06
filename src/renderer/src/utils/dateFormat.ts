interface DateTranslations {
  today: string
  yesterday: string
  dayBeforeYesterday: string
  daysAgo: string
}

/**
 * Format daily note date (e.g., "1月7日 周二" or "Jan 7, Wed")
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param isZh - Whether to use Chinese format
 */
export function formatDailyDate(dateStr: string, isZh: boolean): string {
  const date = new Date(dateStr + 'T00:00:00')
  if (isZh) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      weekday: 'short'
    })
  }
}

/**
 * Format date for display in note list
 * - Today: show time (14:30)
 * - Yesterday/Day before: localized label
 * - 3-6 days ago: "N天前" / "N days ago"
 * - Same year: "12.15"
 * - Different year: "2024.12.15"
 */
export function formatRelativeDate(dateString: string, t: DateTranslations): string {
  const date = new Date(dateString)
  const now = new Date()

  // Reset time to start of day for accurate day comparison
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.floor((nowDay.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    // Today: show time like "14:30"
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  } else if (diffDays === 1) {
    return t.yesterday
  } else if (diffDays === 2) {
    return t.dayBeforeYesterday
  } else if (diffDays < 7) {
    // 3-6 days ago
    return t.daysAgo.replace('{n}', String(diffDays))
  } else if (date.getFullYear() === now.getFullYear()) {
    // Same year: "12.15"
    return `${date.getMonth() + 1}.${date.getDate()}`
  } else {
    // Different year: "2024.12.15"
    return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`
  }
}
