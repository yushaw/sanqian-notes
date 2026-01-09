/**
 * AgentSelect 组件测试
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AgentSelect } from '../AgentSelect'

// Mock createPortal
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  }
})

const mockAgents: AgentCapability[] = [
  { type: 'agent', id: 'agent-1', name: 'Code Explorer', description: 'Analyzes code structure', source: 'builtin' },
  { type: 'agent', id: 'agent-2', name: 'Researcher', description: 'Researches topics', source: 'builtin' },
  { type: 'agent', id: 'agent-3', name: 'Test Agent', source: 'custom' }, // No description
]

describe('AgentSelect', () => {
  beforeAll(() => {
    // Mock getBoundingClientRect for positioning
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      top: 100,
      left: 50,
      bottom: 120,
      right: 200,
      width: 150,
      height: 20,
      x: 50,
      y: 100,
      toJSON: () => {},
    }))
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders with selected agent name', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)
    expect(screen.getByTestId('agent-select-trigger')).toHaveTextContent('Code Explorer')
  })

  it('renders placeholder when no agent selected', () => {
    render(<AgentSelect agents={mockAgents} value={null} onChange={vi.fn()} />)
    expect(screen.getByTestId('agent-select-trigger')).toHaveTextContent('-')
  })

  it('opens dropdown when clicked', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)

    expect(screen.queryByTestId('agent-select-dropdown')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('agent-select-trigger'))

    expect(screen.getByTestId('agent-select-dropdown')).toBeInTheDocument()
  })

  it('shows all agent options in dropdown', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('agent-select-trigger'))

    expect(screen.getByTestId('agent-option-agent-1')).toBeInTheDocument()
    expect(screen.getByTestId('agent-option-agent-2')).toBeInTheDocument()
    expect(screen.getByTestId('agent-option-agent-3')).toBeInTheDocument()
  })

  it('calls onChange when option is selected', () => {
    const onChange = vi.fn()
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={onChange} />)

    fireEvent.click(screen.getByTestId('agent-select-trigger'))
    fireEvent.click(screen.getByTestId('agent-option-agent-2'))

    expect(onChange).toHaveBeenCalledWith('agent-2')
  })

  it('closes dropdown after selection', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)

    fireEvent.click(screen.getByTestId('agent-select-trigger'))
    expect(screen.getByTestId('agent-select-dropdown')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('agent-option-agent-2'))
    expect(screen.queryByTestId('agent-select-dropdown')).not.toBeInTheDocument()
  })

  it('shows description panel on hover when agent has description', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('agent-select-trigger'))

    // Initially no description panel
    expect(screen.queryByTestId('agent-description-panel')).not.toBeInTheDocument()

    // Hover over agent with description
    fireEvent.mouseEnter(screen.getByTestId('agent-option-agent-2'))

    const descPanel = screen.getByTestId('agent-description-panel')
    expect(descPanel).toBeInTheDocument()
    expect(descPanel).toHaveTextContent('Researcher')
    expect(descPanel).toHaveTextContent('Researches topics')
  })

  it('does not show description panel for agent without description', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('agent-select-trigger'))

    // Hover over agent without description
    fireEvent.mouseEnter(screen.getByTestId('agent-option-agent-3'))

    expect(screen.queryByTestId('agent-description-panel')).not.toBeInTheDocument()
  })

  it('hides description panel on mouse leave', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('agent-select-trigger'))

    fireEvent.mouseEnter(screen.getByTestId('agent-option-agent-2'))
    expect(screen.getByTestId('agent-description-panel')).toBeInTheDocument()

    fireEvent.mouseLeave(screen.getByTestId('agent-option-agent-2'))
    expect(screen.queryByTestId('agent-description-panel')).not.toBeInTheDocument()
  })

  it('closes dropdown on escape key', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)

    fireEvent.click(screen.getByTestId('agent-select-trigger'))
    expect(screen.getByTestId('agent-select-dropdown')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('agent-select-dropdown')).not.toBeInTheDocument()
  })

  it('closes dropdown when clicking outside', () => {
    render(
      <div>
        <AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />
        <button data-testid="outside-button">Outside</button>
      </div>
    )

    fireEvent.click(screen.getByTestId('agent-select-trigger'))
    expect(screen.getByTestId('agent-select-dropdown')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId('outside-button'))
    expect(screen.queryByTestId('agent-select-dropdown')).not.toBeInTheDocument()
  })

  it('does not open when disabled', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} disabled />)

    fireEvent.click(screen.getByTestId('agent-select-trigger'))

    expect(screen.queryByTestId('agent-select-dropdown')).not.toBeInTheDocument()
  })

  it('shows checkmark for selected agent', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTestId('agent-select-trigger'))

    // Selected option should have checkmark (svg inside)
    const selectedOption = screen.getByTestId('agent-option-agent-1')
    expect(selectedOption.querySelector('svg')).toBeInTheDocument()

    // Non-selected options should not have checkmark
    const otherOption = screen.getByTestId('agent-option-agent-2')
    expect(otherOption.querySelector('svg')).not.toBeInTheDocument()
  })

  it('toggles dropdown on multiple clicks', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)

    // First click opens
    fireEvent.click(screen.getByTestId('agent-select-trigger'))
    expect(screen.getByTestId('agent-select-dropdown')).toBeInTheDocument()

    // Second click closes
    fireEvent.click(screen.getByTestId('agent-select-trigger'))
    expect(screen.queryByTestId('agent-select-dropdown')).not.toBeInTheDocument()
  })
})
