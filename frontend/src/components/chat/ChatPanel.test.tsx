import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ChatPanel from './ChatPanel'

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_t, tag: string) =>
      ({ children, ...props }: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { initial, animate, exit, whileHover, whileTap, variants, custom, transition, ...rest } = props
        return (require('react')).createElement(tag, rest, children)
      },
  }),
  AnimatePresence: ({ children }: any) => children,
}))

vi.mock('../../api', () => ({
  API_AI: 'http://localhost:8002',
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

const makeSseResponse = (lines: string[]) => ({
  ok: true,
  body: (() => {
    let idx = 0
    const chunks = lines.map(l => new TextEncoder().encode(l))
    return {
      getReader: () => ({
        read: vi.fn(() => {
          if (idx >= chunks.length) return Promise.resolve({ done: true, value: undefined })
          return Promise.resolve({ done: false, value: chunks[idx++] })
        }),
      }),
    }
  })(),
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('token', 'test-token')
  // Default: /chat/inicio returns empty stream
  mockFetch.mockResolvedValue(makeSseResponse(['data: [DONE]\n\n']))
})

describe('ChatPanel', () => {
  it('renders without crashing', async () => {
    render(<ChatPanel />)
    expect(screen.getByPlaceholderText(/pregunta/i)).toBeInTheDocument()
  })

  it('shows BT header with name', async () => {
    render(<ChatPanel />)
    expect(screen.getByText(/BT — Asesor IA/i)).toBeInTheDocument()
  })

  it('shows suggestion prompts when no token (no greeting)', async () => {
    // Remove token so greeting doesn't fire and messages stay empty
    localStorage.removeItem('token')
    render(<ChatPanel />)
    await waitFor(() => {
      expect(screen.getByText(/¿Cómo está Bitcoin ahora mismo\?/i)).toBeInTheDocument()
    })
  })

  it('send button disabled when input is empty', async () => {
    render(<ChatPanel />)
    // Button is rendered with cursor: not-allowed when disabled
    const buttons = document.querySelectorAll('button')
    const sendBtn = Array.from(buttons).find(b =>
      b.getAttribute('style')?.includes('not-allowed') ||
      b.hasAttribute('disabled')
    )
    expect(sendBtn).toBeTruthy()
  })

  it('textarea accepts input', () => {
    render(<ChatPanel />)
    const textarea = screen.getByPlaceholderText(/pregunta/i)
    fireEvent.change(textarea, { target: { value: 'Bitcoin' } })
    expect((textarea as HTMLTextAreaElement).value).toBe('Bitcoin')
  })

  it('sends message when Enter is pressed (no shift)', async () => {
    // First call = /chat/inicio, second = /chat/stream
    mockFetch
      .mockResolvedValueOnce(makeSseResponse(['data: [DONE]\n\n']))
      .mockResolvedValueOnce(makeSseResponse([
        'data: {"ping":true}\n\n',
        'data: {"content":"BTC en $50000"}\n\n',
        'data: [DONE]\n\n',
      ]))

    render(<ChatPanel />)
    const textarea = screen.getByPlaceholderText(/pregunta/i)
    fireEvent.change(textarea, { target: { value: 'Bitcoin' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    await waitFor(() => {
      expect(screen.getByText('Bitcoin')).toBeInTheDocument()
    })
  })

  it('does NOT send on Shift+Enter', async () => {
    render(<ChatPanel />)
    const textarea = screen.getByPlaceholderText(/pregunta/i)
    fireEvent.change(textarea, { target: { value: 'test' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    await waitFor(() => {
      const streamCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes('/chat/stream'))
      expect(streamCalls).toHaveLength(0)
    })
  })

  it('does NOT send empty/whitespace messages', async () => {
    render(<ChatPanel />)
    const textarea = screen.getByPlaceholderText(/pregunta/i)
    fireEvent.change(textarea, { target: { value: '   ' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    await waitFor(() => {
      const streamCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes('/chat/stream'))
      expect(streamCalls).toHaveLength(0)
    })
  })

  it('shows error message when stream request fails', async () => {
    mockFetch
      .mockResolvedValueOnce(makeSseResponse(['data: [DONE]\n\n']))
      .mockRejectedValueOnce(new Error('Network error'))

    render(<ChatPanel />)
    const textarea = screen.getByPlaceholderText(/pregunta/i)
    fireEvent.change(textarea, { target: { value: 'test query' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    await waitFor(() => {
      expect(screen.getByText(/No se pudo conectar/i)).toBeInTheDocument()
    })
  })

  it('shows response content after streaming', async () => {
    mockFetch
      .mockResolvedValueOnce(makeSseResponse(['data: [DONE]\n\n']))
      .mockResolvedValueOnce(makeSseResponse([
        'data: {"ping":true}\n\n',
        'data: {"content":"Bitcoin está en $95,000"}\n\n',
        'data: [DONE]\n\n',
      ]))

    render(<ChatPanel />)
    const textarea = screen.getByPlaceholderText(/pregunta/i)
    fireEvent.change(textarea, { target: { value: '¿Cómo está bitcoin?' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    await waitFor(() => {
      expect(screen.getByText(/Bitcoin está en/i)).toBeInTheDocument()
    })
  })

  it('greeting from /chat/inicio is displayed', async () => {
    mockFetch.mockResolvedValueOnce(makeSseResponse([
      'data: {"ping":true}\n\n',
      'data: {"content":"BTCUSDT $95000 · MANTENER · Conviction 55/100"}\n\n',
      'data: [DONE]\n\n',
    ]))

    render(<ChatPanel />)
    await waitFor(() => {
      expect(screen.getByText(/BTCUSDT/i)).toBeInTheDocument()
    })
  })

  it('shows onClose button when provided', () => {
    const onClose = vi.fn()
    render(<ChatPanel onClose={onClose} />)
    const closeBtn = document.querySelector('button[style*="border: 1px solid"]')
    expect(closeBtn).toBeTruthy()
  })
})
