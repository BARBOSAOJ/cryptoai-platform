import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Header from './Header'

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_t, tag: string) =>
      ({ children, ...props }: any) => {
        const { initial, animate, exit, whileHover, whileTap, ...rest } = props
        return (require('react')).createElement(tag, rest, children)
      },
  }),
  AnimatePresence: ({ children }: any) => children,
}))

vi.mock('../../api', () => ({
  apiClient: { get: vi.fn().mockResolvedValue({ data: { saldoDisponible: 5000 } }) },
  aiClient:  { get: vi.fn().mockResolvedValue({ data: null }) },
}))

const defaultProps = {
  currentSymbol: 'BTCUSDT',
  setCurrentSymbol: vi.fn(),
  user: { name: 'Test', plan: 'PRO ELITE', balance: 10000 },
  marketData: {
    BTCUSDT: { price: 50000, change: '+2.50%', history: [], volumes: [] },
    ETHUSDT: { price: 3000,  change: '-1.00%', history: [], volumes: [] },
  },
  sseConnected: true,
}

describe('Header', () => {
  it('renders without crashing', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByPlaceholderText(/Buscar/i)).toBeInTheDocument()
  })

  it('shows current symbol', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByText(/BTC \/ USDT/i)).toBeInTheDocument()
  })

  it('shows current price', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByText('$50,000')).toBeInTheDocument()
  })

  it('shows positive change in green-ish style', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByText('+2.50%')).toBeInTheDocument()
  })

  it('shows plan badge', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByText('PRO ELITE')).toBeInTheDocument()
  })

  it('shows avatar initials', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByText('TE')).toBeInTheDocument()
  })

  it('opens dropdown on search focus', () => {
    render(<Header {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText(/Buscar/i)
    fireEvent.focus(searchInput)
    expect(screen.getByText(/Favoritos/i)).toBeInTheDocument()
  })

  it('filters symbols on search input', () => {
    render(<Header {...defaultProps} />)
    const searchInput = screen.getByPlaceholderText(/Buscar/i)
    fireEvent.focus(searchInput)
    fireEvent.change(searchInput, { target: { value: 'ETH' } })
    expect(screen.getByText('ETHUSDT')).toBeInTheDocument()
  })

  it('calls setCurrentSymbol when symbol is clicked', () => {
    const setCurrentSymbol = vi.fn()
    render(<Header {...defaultProps} setCurrentSymbol={setCurrentSymbol} />)
    const searchInput = screen.getByPlaceholderText(/Buscar/i)
    fireEvent.focus(searchInput)
    fireEvent.change(searchInput, { target: { value: 'ETH' } })
    fireEvent.click(screen.getByText('ETHUSDT'))
    expect(setCurrentSymbol).toHaveBeenCalledWith('ETHUSDT')
  })

  it('shows SSE connected indicator', () => {
    render(<Header {...defaultProps} sseConnected={true} />)
    // Wifi icon should be rendered (no WifiOff)
    const wifiOff = document.querySelector('[data-lucide="wifi-off"]')
    expect(wifiOff).toBeNull()
  })

  it('shows stop-loss alert badge when stopAlertCount > 0', () => {
    render(<Header {...defaultProps} stopAlertCount={2} />)
    expect(screen.getByText(/STOP ×2/i)).toBeInTheDocument()
  })

  it('calls onLogout when logout button clicked', () => {
    const onLogout = vi.fn()
    render(<Header {...defaultProps} onLogout={onLogout} />)
    const logoutBtn = screen.getByTitle(/Cerrar sesión/i)
    fireEvent.click(logoutBtn)
    expect(onLogout).toHaveBeenCalled()
  })

  it('calls onSettingsOpen when settings button clicked', () => {
    const onSettingsOpen = vi.fn()
    render(<Header {...defaultProps} onSettingsOpen={onSettingsOpen} />)
    const settingsBtn = screen.getByTitle(/Configuración/i)
    fireEvent.click(settingsBtn)
    expect(onSettingsOpen).toHaveBeenCalled()
  })
})
