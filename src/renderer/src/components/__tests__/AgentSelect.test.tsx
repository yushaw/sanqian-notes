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
    expect(screen.getByRole('button', { name: /Code Explorer/i })).toBeInTheDocument()
  })

  it('renders placeholder when no agent selected', () => {
    render(<AgentSelect agents={mockAgents} value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveTextContent('-')
  })

  it('opens dropdown when clicked', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('shows all agent options in dropdown', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button'))

    // All options should be rendered in the listbox
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveTextContent('Code Explorer')
    expect(options[1]).toHaveTextContent('Researcher')
    expect(options[2]).toHaveTextContent('Test Agent')
  })

  it('shows agent descriptions in dropdown', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Analyzes code structure')).toBeInTheDocument()
    expect(screen.getByText('Researches topics')).toBeInTheDocument()
  })

  it('calls onChange when option is selected', () => {
    const onChange = vi.fn()
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Researcher'))

    expect(onChange).toHaveBeenCalledWith('agent-2')
  })

  it('closes dropdown after selection', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Researcher'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes dropdown on escape key', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes dropdown when clicking outside', () => {
    render(
      <div>
        <AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />
        <button data-testid="outside-button">Outside</button>
      </div>
    )

    fireEvent.click(screen.getByRole('button', { name: /Code Explorer/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId('outside-button'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does not open when disabled', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} disabled />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('highlights selected agent option', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button'))

    // Selected option should have aria-selected=true
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('toggles dropdown on multiple clicks', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)

    // First click opens
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    // Second click closes
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('has correct aria attributes', () => {
    render(<AgentSelect agents={mockAgents} value="agent-1" onChange={vi.fn()} />)

    const trigger = screen.getByRole('button')
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})
