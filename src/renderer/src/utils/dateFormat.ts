interface DateTranslations {
  today: string
  yesterday: string
  dayBeforeYesterday: string
  daysAgo: string
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
