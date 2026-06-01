import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────

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

vi.mock('./api', () => ({
  apiClient:  { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn().mockResolvedValue({ data: {} }) },
  aiClient:   { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn().mockResolvedValue({ data: {} }) },
  API_PRICE:  'http://localhost:8001',
}))

vi.mock('./components/shared/Header', () => ({
  default: ({ onSettingsOpen }: any) => (
    <div data-testid="header">
      <button onClick={onSettingsOpen}>settings</button>
    </div>
  ),
}))

vi.mock('./components/shared/Sidebar', () => ({
  default: ({ setActiveTab }: any) => (
    <nav data-testid="sidebar">
      <button onClick={() => setActiveTab('TRADE')}>TRADE</button>
      <button onClick={() => setActiveTab('PORTFOLIO')}>PORTFOLIO</button>
      <button onClick={() => setActiveTab('BOT')}>BOT</button>
      <button onClick={() => setActiveTab('CONFIG')}>CONFIG</button>
    </nav>
  ),
}))

vi.mock('./components/terminal/ChartPanel', () => ({
  default: () => <div data-testid="chart-panel" />,
}))

vi.mock('./components/terminal/MultiTimeframe', () => ({
  default: () => <div data-testid="multi-timeframe" />,
}))

vi.mock('./components/shared/LoadingSplash', () => ({
  default: () => <div data-testid="loading-splash" />,
}))

vi.mock('./components/shared/ErrorBoundary', () => ({
  default: ({ children }: any) => <>{children}</>,
}))

vi.mock('./components/chat/ChatPanel', () => ({
  default: ({ onAction }: any) => (
    <div data-testid="chat-panel">
      <button onClick={() => onAction?.({ action: 'change_symbol', symbol: 'SOLUSDT' })}>
        trigger-action
      </button>
    </div>
  ),
}))

vi.mock('./components/portfolio/Portfolio', () => ({
  default: () => <div data-testid="portfolio" />,
}))

vi.mock('./hooks/useAgenteAutonomo', () => ({
  useAgenteAutonomo: () => ({
    estado: { activo: false, posicionesAbiertas: {}, log: [], config: {} },
    activar:      vi.fn(),
    pausar:       vi.fn(),
    procesarTick: vi.fn(),
    alertasStopLoss: new Set(),
  }),
}))

vi.mock('./components/configuracion/Settings', () => ({
  default: () => <div data-testid="settings" />,
}))

// Silence EventSource
class MockEventSource {
  close() {}
}
global.EventSource = MockEventSource as any

const makeSseResponse = () => ({
  ok: true,
  body: (() => {
    let done = false
    return {
      getReader: () => ({
        read: vi.fn(() => {
          if (done) return Promise.resolve({ done: true, value: undefined })
          done = true
          const enc = new TextEncoder().encode('data: [DONE]\n\n')
          return Promise.resolve({ done: false, value: enc })
        }),
      }),
    }
  })(),
})

global.fetch = vi.fn().mockResolvedValue(makeSseResponse())

// ── Tests ────────────────────────────────────────────────────────────────────

import App from './App'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  global.fetch = vi.fn().mockResolvedValue(makeSseResponse())
  localStorage.setItem('token', 'test-token')
  localStorage.setItem('userName', 'Test User')
})

afterEach(() => {
  vi.useRealTimers()
})

// Helper: render App and flush past the 1500ms loading timer using fake clocks
async function renderApp() {
  await act(async () => { render(<App />) })
  // Advance fake timers to clear the 1500ms loading splash
  await act(async () => { vi.advanceTimersByTime(2000) })
}

describe('App — tab navigation', () => {
  it('loading splash clears after timer', async () => {
    await renderApp()
    expect(screen.queryByTestId('loading-splash')).not.toBeInTheDocument()
  })

  it('renders sidebar and header after login', async () => {
    await renderApp()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('header')).toBeInTheDocument()
  })

  it('shows TRADE tab by default (chart panel visible)', async () => {
    await renderApp()
    expect(screen.getByTestId('chart-panel')).toBeInTheDocument()
  })

  it('switches to PORTFOLIO tab', async () => {
    await renderApp()
    fireEvent.click(screen.getByText('PORTFOLIO'))
    expect(screen.getByTestId('portfolio')).toBeInTheDocument()
    expect(screen.queryByTestId('chart-panel')).not.toBeInTheDocument()
  })

  it('switches to BOT tab and shows Agente Autónomo heading', async () => {
    await renderApp()
    fireEvent.click(screen.getByText('BOT'))
    expect(screen.getByText(/Agente Autónomo/i)).toBeInTheDocument()
  })

  it('switches to CONFIG tab via sidebar', async () => {
    await renderApp()
    fireEvent.click(screen.getByText('CONFIG'))
    expect(screen.getByTestId('settings')).toBeInTheDocument()
  })

  it('opens CONFIG tab from Header settings button', async () => {
    await renderApp()
    fireEvent.click(screen.getByText('settings'))
    expect(screen.getByTestId('settings')).toBeInTheDocument()
  })

  it('returns to TRADE from PORTFOLIO when TRADE clicked', async () => {
    await renderApp()
    fireEvent.click(screen.getByText('PORTFOLIO'))
    fireEvent.click(screen.getByText('TRADE'))
    expect(screen.getByTestId('chart-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('portfolio')).not.toBeInTheDocument()
  })
})

describe('App — BT onAction handler', () => {
  it('change_symbol action does not throw', async () => {
    await renderApp()
    const btn = screen.getByText('trigger-action')
    expect(() => fireEvent.click(btn)).not.toThrow()
  })
})

describe('App — BOT tab AgentePanel', () => {
  it('shows stat cards in BOT tab', async () => {
    await renderApp()
    fireEvent.click(screen.getByText('BOT'))
    expect(screen.getByText(/Estado/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Posiciones abiertas/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Total invertido/i)).toBeInTheDocument()
    expect(screen.getByText(/P&L agente/i)).toBeInTheDocument()
  })

  it('shows empty-positions message when no positions open', async () => {
    await renderApp()
    fireEvent.click(screen.getByText('BOT'))
    expect(screen.getByText(/no tiene posiciones abiertas/i)).toBeInTheDocument()
  })

  it('shows ACTIVAR AGENTE button when agent is inactive', async () => {
    await renderApp()
    fireEvent.click(screen.getByText('BOT'))
    expect(screen.getByText(/ACTIVAR AGENTE/i)).toBeInTheDocument()
  })
})
