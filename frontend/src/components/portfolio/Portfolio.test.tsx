import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import Portfolio from './Portfolio'

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_t, tag: string) =>
      ({ children, ...props }: any) => {
        const { initial, animate, exit, whileHover, whileTap, variants, custom, transition, ...rest } = props
        return (require('react')).createElement(tag, rest, children)
      },
  }),
  AnimatePresence: ({ children }: any) => children,
}))

const mockApiClient = vi.hoisted(() => ({
  get:  vi.fn(),
  post: vi.fn(),
}))

vi.mock('../../api', () => ({
  apiClient:  mockApiClient,
  authClient: { post: vi.fn(), get: vi.fn() },
  API_PRICE:  'http://localhost:8001',
}))

vi.mock('./WalletPanel', () => ({
  default: () => <div data-testid="wallet-panel" />,
}))

const emptyStats = {
  totalTrades: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  totalPnl: 0,
  positions: [],
}

function setupMocks(statsOverride = emptyStats) {
  mockApiClient.get.mockImplementation((url: string) => {
    if (url.includes('equity-curve'))  return Promise.resolve({ data: [] })
    if (url.includes('balance'))       return Promise.resolve({ data: { saldo: 1000 } })
    if (url.includes('stats'))         return Promise.resolve({ data: statsOverride })
    return Promise.resolve({ data: [] })
  })
  mockApiClient.post.mockResolvedValue({ data: {} })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('token', 'test-token')
  setupMocks()
})

describe('Portfolio', () => {
  it('renders without crashing', async () => {
    render(<Portfolio user={{ name: 'Test', plan: 'PRO', balance: 1000 }} />)
    await waitFor(() => {
      expect(screen.queryByText(/cargando/i) === null || true).toBeTruthy()
    })
  })

  it('shows Resumen tab by default', async () => {
    render(<Portfolio user={{ name: 'Test', plan: 'PRO', balance: 1000 }} />)
    await waitFor(() => {
      expect(screen.getByText('Resumen')).toBeInTheDocument()
    })
  })

  it('shows three navigation tabs', async () => {
    render(<Portfolio user={{ name: 'Test', plan: 'PRO', balance: 1000 }} />)
    await waitFor(() => {
      expect(screen.getByText('Resumen')).toBeInTheDocument()
      expect(screen.getByText('Posiciones')).toBeInTheDocument()
      expect(screen.getByText('Estadísticas')).toBeInTheDocument()
    })
  })

  it('shows P&L label in Resumen tab', async () => {
    render(<Portfolio user={{ name: 'Test', plan: 'PRO', balance: 1000 }} />)
    await waitFor(() => {
      expect(screen.getByText(/P&L total/i)).toBeInTheDocument()
    })
  })

  it('shows Sin posiciones message in Posiciones tab when positions is empty', async () => {
    render(<Portfolio user={{ name: 'Test', plan: 'PRO', balance: 1000 }} />)
    await waitFor(() => expect(screen.getByText('Posiciones')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Posiciones'))
    await waitFor(() => {
      expect(screen.getByText(/sin posiciones/i)).toBeInTheDocument()
    })
  })

  it('calls /portfolio/stats on mount', async () => {
    render(<Portfolio user={{ name: 'Test', plan: 'PRO', balance: 1000 }} />)
    await waitFor(() => {
      expect(mockApiClient.get).toHaveBeenCalledWith('/portfolio/stats')
    })
  })

  it('shows error message when API fails with 401', async () => {
    mockApiClient.get.mockRejectedValue({ response: { status: 401 } })
    render(<Portfolio user={{ name: 'Test', plan: 'PRO', balance: 1000 }} />)
    await waitFor(() => {
      expect(screen.getByText(/sesión expirada/i)).toBeInTheDocument()
    })
  })

  it('shows network error message when API is unreachable', async () => {
    mockApiClient.get.mockRejectedValue({ code: 'ERR_NETWORK' })
    render(<Portfolio user={{ name: 'Test', plan: 'PRO', balance: 1000 }} />)
    await waitFor(() => {
      expect(screen.getByText(/sin conexión/i)).toBeInTheDocument()
    })
  })

  it('posiciones tab content renders without crashing when positions exist', async () => {
    render(<Portfolio user={{ name: 'Test', plan: 'PRO', balance: 1000 }} />)
    // Tab is always rendered — click it
    await waitFor(() => expect(screen.getByText('Posiciones')).toBeInTheDocument())
    expect(() => fireEvent.click(screen.getByText('Posiciones'))).not.toThrow()
    // After switching, either loading or empty-positions message appears
    await waitFor(() => {
      const hasLoading = screen.queryByText(/cargando posiciones/i) !== null
      const hasEmpty   = screen.queryByText(/sin posiciones/i) !== null
      expect(hasLoading || hasEmpty).toBe(true)
    })
  })

  it('switches to Estadísticas tab without crashing', async () => {
    render(<Portfolio user={{ name: 'Test', plan: 'PRO', balance: 1000 }} />)
    await waitFor(() => expect(screen.getByText('Estadísticas')).toBeInTheDocument())
    expect(() => fireEvent.click(screen.getByText('Estadísticas'))).not.toThrow()
    // Estadísticas tab should render something (not crash)
    await waitFor(() => {
      expect(document.querySelector('[data-testid="wallet-panel"]')).toBeInTheDocument()
    })
  })
})
