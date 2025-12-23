import { forwardRef, useEffect, useImperativeHandle, useState, useRef } from 'react'
import type { SlashCommandItem } from './extensions/SlashCommand'
import { useTranslations } from '../i18n'

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

export const SlashCommandList = forwardRef<unknown, SlashCommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const t = useTranslations()
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    // Scroll selected item into view
    useEffect(() => {
      const selectedItem = itemRefs.current[selectedIndex]
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
    }, [selectedIndex])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          const item = items[selectedIndex]
          if (item) {
            command(item)
          }
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="slash-command-list">
          <div className="slash-command-empty">{t.slashCommand.noMatches}</div>
        </div>
      )
    }

    return (
      <div className="slash-command-list">
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(el) => { itemRefs.current[index] = el }}
            className={`slash-command-item ${index === selectedIndex ? 'selected' : ''}`}
            onClick={() => command(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="slash-command-icon">{item.icon}</span>
            <div className="slash-command-content">
              <span className="slash-command-title">
                {t.slashCommand[item.id as keyof typeof t.slashCommand]}
              </span>
              <span className="slash-command-description">
                {t.slashCommand[`${item.id}Desc` as keyof typeof t.slashCommand]}
              </span>
            </div>
          </button>
        ))}
      </div>
    )
  }
)

SlashCommandList.displayName = 'SlashCommandList'
