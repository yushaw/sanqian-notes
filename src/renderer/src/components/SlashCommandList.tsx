import { forwardRef, useEffect, useImperativeHandle, useState, useRef, useMemo } from 'react'
import type { SlashCommandItem } from './extensions/SlashCommand'
import { useTranslations } from '../i18n'

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

// Group items by type
function groupItems(items: SlashCommandItem[]): { group: 'format' | 'ai'; items: SlashCommandItem[] }[] {
  const formatItems = items.filter(item => !item.isAIAction)
  const aiItems = items.filter(item => item.isAIAction)

  const groups: { group: 'format' | 'ai'; items: SlashCommandItem[] }[] = []

  if (formatItems.length > 0) {
    groups.push({ group: 'format', items: formatItems })
  }
  if (aiItems.length > 0) {
    groups.push({ group: 'ai', items: aiItems })
  }

  return groups
}

export const SlashCommandList = forwardRef<unknown, SlashCommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const t = useTranslations()
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

    // Create grouped items for display, use items directly for keyboard navigation
    const groupedItems = useMemo(() => groupItems(items), [items])

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

    // Calculate index offset for each group
    let itemIndex = 0

    return (
      <div className="slash-command-list">
        {groupedItems.map((group) => (
          <div key={group.group} className="slash-command-group">
            {groupedItems.length > 1 && (
              <div className="slash-command-group-header">
                {group.group === 'ai' ? t.slashCommand.aiGroup : t.slashCommand.formatGroup}
              </div>
            )}
            {group.items.map((item) => {
              const currentIndex = itemIndex++
              return (
                <button
                  key={item.id}
                  ref={(el) => { itemRefs.current[currentIndex] = el }}
                  className={`slash-command-item ${currentIndex === selectedIndex ? 'selected' : ''}`}
                  onClick={() => command(item)}
                  onMouseEnter={() => setSelectedIndex(currentIndex)}
                >
                  <span className="slash-command-icon">{item.icon}</span>
                  <div className="slash-command-content">
                    <span className="slash-command-title">
                      {item.isAIAction
                        ? item.aiName
                        : t.slashCommand[item.id as keyof typeof t.slashCommand]}
                    </span>
                    <span className="slash-command-separator">·</span>
                    <span className="slash-command-description">
                      {item.isAIAction
                        ? (item.aiDescription || t.slashCommand.aiActionDesc)
                        : t.slashCommand[`${item.id}Desc` as keyof typeof t.slashCommand]}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    )
  }
)

SlashCommandList.displayName = 'SlashCommandList'
