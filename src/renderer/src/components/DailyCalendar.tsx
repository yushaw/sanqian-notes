import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useI18n } from '../i18n'
import { Tooltip } from './Tooltip'
import { formatDailyDate } from '../utils/dateFormat'
import { useTodayDate } from '../hooks/useTodayDate'

interface DailyCalendarProps {
  selectedDate: string | null // YYYY-MM-DD
  datesWithContent: string[] // Dates that have daily notes
  onSelectDate: (date: string) => void
  showCreateButton?: boolean
  onCreateDaily?: () => void
  isSidebarCollapsed?: boolean
}

// Check if macOS
const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

export function DailyCalendar({
  selectedDate,
  datesWithContent,
  onSelectDate,
  showCreateButton = false,
  onCreateDaily,
  isSidebarCollapsed = false
}: DailyCalendarProps) {
  // Add padding for traffic lights on macOS when sidebar is collapsed
  const needsTrafficLightPadding = isMac && isSidebarCollapsed
  const { isZh } = useI18n()
  const today = useTodayDate()

  // Current viewing month
  const [viewYear, setViewYear] = useState(() => {
    if (selectedDate) {
      return parseInt(selectedDate.split('-')[0])
    }
    return new Date().getFullYear()
  })
  const [viewMonth, setViewMonth] = useState(() => {
    if (selectedDate) {
      return parseInt(selectedDate.split('-')[1])
    }
    return new Date().getMonth() + 1
  })

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth - 1, 1)
    const lastDay = new Date(viewYear, viewMonth, 0)
    const daysInMonth = lastDay.getDate()
    const startWeekday = firstDay.getDay() // 0 = Sunday

    const days: (number | null)[] = []

    // Add empty slots for days before the first day of the month
    for (let i = 0; i < startWeekday; i++) {
      days.push(null)
    }

    // Add the days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i)
    }

    return days
  }, [viewYear, viewMonth])

  const hasContent = useMemo(() => {
    const set = new Set(datesWithContent)
    return (day: number) => {
      const dateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      return set.has(dateStr)
    }
  }, [datesWithContent, viewYear, viewMonth])

  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewYear(viewYear - 1)
      setViewMonth(12)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewYear(viewYear + 1)
      setViewMonth(1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  const handleSelectDay = (day: number) => {
    const dateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    onSelectDate(dateStr)
  }

  const handleGoToToday = () => {
    const [year, month] = today.split('-').map(Number)
    setViewYear(year)
    setViewMonth(month)
    onSelectDate(today)
  }

  const weekDays = isZh
    ? ['日', '一', '二', '三', '四', '五', '六']
    : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  const monthNames = isZh
    ? ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  // Format selected date for tooltip (using shared utility)
  const tooltipContent = selectedDate ? formatDailyDate(selectedDate, isZh) : ''

  return (
    <div className="daily-calendar">
      {/* Header with nav, today button, and create button */}
      <div className={`daily-calendar-header ${needsTrafficLightPadding ? 'with-traffic-light' : ''}`}>
        <div className="daily-calendar-nav">
          <button
            className="daily-calendar-nav-btn"
            onClick={handlePrevMonth}
            aria-label="Previous month"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="daily-calendar-title">
            {isZh
              ? `${viewYear}年${monthNames[viewMonth - 1]}`
              : `${monthNames[viewMonth - 1]} ${viewYear}`}
          </span>
          <button
            className="daily-calendar-nav-btn"
            onClick={handleNextMonth}
            aria-label="Next month"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="daily-calendar-actions">
          <button
            className="daily-calendar-today-btn"
            onClick={handleGoToToday}
          >
            {isZh ? '今天' : 'Today'}
          </button>
          {showCreateButton && (
            <Tooltip content={tooltipContent} placement="bottom">
              <button
                className="daily-calendar-create-btn"
                onClick={onCreateDaily}
              >
                <Plus size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Weekday headers */}
      <div className="daily-calendar-weekdays">
        {weekDays.map((day, i) => (
          <div key={i} className="daily-calendar-weekday">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="daily-calendar-grid">
        {calendarDays.map((day, i) => {
          if (day === null) {
            return <div key={i} className="daily-calendar-day empty" />
          }

          const dateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isSelected = selectedDate === dateStr
          const isToday = today === dateStr
          const hasNote = hasContent(day)

          return (
            <button
              key={i}
              className={`daily-calendar-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${hasNote ? 'has-content' : ''}`}
              onClick={() => handleSelectDay(day)}
            >
              <span className="day-number">{day}</span>
              {hasNote && <span className="content-dot" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
