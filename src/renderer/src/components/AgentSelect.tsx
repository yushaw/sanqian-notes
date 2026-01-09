/**
 * AgentSelect - Agent selector using unified Select component
 */

import { Select } from './Select'

interface AgentSelectProps {
  agents: AgentCapability[]
  value: string | null
  onChange: (id: string) => void
  disabled?: boolean
}

export function AgentSelect({ agents, value, onChange, disabled }: AgentSelectProps) {
  const options = agents.map((agent) => ({
    value: agent.id,
    label: agent.name,
    description: agent.description,
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
