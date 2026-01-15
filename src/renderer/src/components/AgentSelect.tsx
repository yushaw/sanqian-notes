/**
 * AgentSelect - Agent selector using unified Select component
 */

import { Select } from './Select'
import { useI18n } from '../i18n'

interface AgentSelectProps {
  agents: AgentCapability[]
  value: string | null
  onChange: (id: string) => void
  disabled?: boolean
}

export function AgentSelect({ agents, value, onChange, disabled }: AgentSelectProps) {
  const { isZh } = useI18n()
  const locale = isZh ? 'zh' : 'en'

  const options = agents.map((agent) => ({
    value: agent.id,
    label: agent.display?.[locale] || agent.name,
    description: agent.shortDesc?.[locale] || agent.description,
  }))

  return (
    <Select
      options={options}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  )
}

export default AgentSelect
