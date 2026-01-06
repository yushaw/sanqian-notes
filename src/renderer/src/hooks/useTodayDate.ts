import { useState, useEffect } from 'react'

const getToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Returns today's date string (YYYY-MM-DD) that auto-updates when:
 * 1. User switches back to the app (Page Visibility API)
 * 2. Date changes while app is open
 */
export function useTodayDate(): string {
  const [today, setToday] = useState(getToday)

  useEffect(() => {
    const checkDateChange = () => {
      if (document.visibilityState === 'visible') {
        setToday(prev => {
          const newToday = getToday()
          return newToday !== prev ? newToday : prev
        })
      }
    }

    document.addEventListener('visibilitychange', checkDateChange)
    return () => document.removeEventListener('visibilitychange', checkDateChange)
  }, [])

  return today
}

/**
 * Returns today's date number (1-31) that auto-updates on visibility change
 */
export function useTodayDateNumber(): number {
  const [dateNum, setDateNum] = useState(() => new Date().getDate())

  useEffect(() => {
    const checkDateChange = () => {
      if (document.visibilityState === 'visible') {
        setDateNum(prev => {
          const newDateNum = new Date().getDate()
          return newDateNum !== prev ? newDateNum : prev
        })
      }
    }

    document.addEventListener('visibilitychange', checkDateChange)
    return () => document.removeEventListener('visibilitychange', checkDateChange)
  }, [])

  return dateNum
}
