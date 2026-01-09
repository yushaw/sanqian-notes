/**
 * AgentSelect - Custom dropdown selector for agents with description tooltip
 */

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface AgentSelectProps {
  agents: AgentCapability[]
  value: string | null
  onChange: (id: string) => void
  disabled?: boolean
}

export function AgentSelect({ agents, value, onChange, disabled }: AgentSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [hoveredAgent, setHoveredAgent] = useState<AgentCapability | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedAgent = agents.find((a) => a.id === value)

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative flex-1" data-testid="agent-select">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full flex items-center justify-between font-medium bg-transparent text-[var(--color-text)] focus:outline-none cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="agent-select-trigger"
      >
        <span className="truncate">{selectedAgent?.name || '-'}</span>
        <svg className="w-3 h-3 text-[var(--color-muted)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown - opens upward */}
      {isOpen && createPortal(
        <div
          className="fixed bg-[var(--color-card)] rounded-lg shadow-lg border border-black/10 dark:border-white/10 overflow-hidden flex"
          style={{
            bottom: containerRef.current ? window.innerHeight - containerRef.current.getBoundingClientRect().top + 4 : 0,
            left: containerRef.current ? containerRef.current.getBoundingClientRect().left : 0,
            zIndex: 10000,
            minWidth: containerRef.current?.offsetWidth || 120,
          }}
          data-testid="agent-select-dropdown"
        >
          {/* Options list */}
          <div className="py-1 max-h-48 overflow-y-auto min-w-[120px]">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => {
                  onChange(agent.id)
                  setIsOpen(false)
                }}
                onMouseEnter={() => setHoveredAgent(agent)}
                onMouseLeave={() => setHoveredAgent(null)}
                className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors flex items-center gap-2 ${
                  agent.id === value
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/5'
                }`}
                data-testid={`agent-option-${agent.id}`}
              >
                {agent.id === value && (
                  <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span className={agent.id === value ? '' : 'pl-5'}>{agent.name}</span>
              </button>
            ))}
          </div>

          {/* Description panel - shows on hover */}
          {hoveredAgent?.description && (
            <div
              className="w-48 p-3 border-l border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]"
              data-testid="agent-description-panel"
            >
              <div className="text-[10px] text-[var(--color-muted)] mb-1">{hoveredAgent.name}</div>
              <div className="text-[11px] text-[var(--color-text)] leading-relaxed">
                {hoveredAgent.description}
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

export default AgentSelect
