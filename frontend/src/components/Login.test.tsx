import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Login from './Login'

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_t, tag: string) =>
      ({ children, ...props }: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { initial, animate, exit, whileHover, whileTap, transition, ...rest } = props
        return (require('react')).createElement(tag, rest, children)
      },
  }),
  AnimatePresence: ({ children }: any) => children,
}))

// Use vi.fn() directly — avoids hoisting issues with external variables
vi.mock('../api', () => ({
  authClient: {
    post: vi.fn(),
  },
}))

const onLoginSuccess = vi.fn()

// Re-import after mock so we get the mocked version
async function getAuthClient() {
  const { authClient } = await import('../api')
  return authClient as { post: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('Login', () => {
  it('renders email and password fields', () => {
    render(<Login onLoginSuccess={onLoginSuccess} />)
    expect(screen.getByPlaceholderText('tu@email.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Mínimo 6 caracteres')).toBeInTheDocument()
  })

  it('shows welcome text by default', () => {
    render(<Login onLoginSuccess={onLoginSuccess} />)
    expect(screen.getByText(/Bienvenido de vuelta/i)).toBeInTheDocument()
  })

  it('renders CryptoAI brand', () => {
    render(<Login onLoginSuccess={onLoginSuccess} />)
    expect(screen.getByText('CryptoAI')).toBeInTheDocument()
  })

  it('switches to register form on toggle click', async () => {
    render(<Login onLoginSuccess={onLoginSuccess} />)
    fireEvent.click(screen.getByText(/Regístrate/i))
    await waitFor(() => {
      // h1 heading specifically
      expect(screen.getByRole('heading', { name: /Crear cuenta/i })).toBeInTheDocument()
    })
  })

  it('shows error for invalid email', async () => {
    render(<Login onLoginSuccess={onLoginSuccess} />)
    fireEvent.change(screen.getByPlaceholderText('tu@email.com'),    { target: { value: 'notanemail' } })
    fireEvent.change(screen.getByPlaceholderText('Mínimo 6 caracteres'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))
    await waitFor(() => expect(screen.getByText(/email válido/i)).toBeInTheDocument())
  })

  it('shows error for short password', async () => {
    render(<Login onLoginSuccess={onLoginSuccess} />)
    fireEvent.change(screen.getByPlaceholderText('tu@email.com'),    { target: { value: 'user@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Mínimo 6 caracteres'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))
    await waitFor(() => expect(screen.getByText(/Mínimo 6/i)).toBeInTheDocument())
  })

  it('calls authClient.post on valid form submission', async () => {
    const { authClient } = await import('../api')
    const mockPost = authClient.post as ReturnType<typeof vi.fn>
    mockPost.mockResolvedValueOnce({ data: { token: 'jwt-token' } })

    render(<Login onLoginSuccess={onLoginSuccess} />)
    fireEvent.change(screen.getByPlaceholderText('tu@email.com'),    { target: { value: 'user@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Mínimo 6 caracteres'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/auth/login', { email: 'user@test.com', password: 'password123' })
    })
  })

  it('calls onLoginSuccess after successful login', async () => {
    const { authClient } = await import('../api')
    ;(authClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { token: 'jwt-token' } })

    render(<Login onLoginSuccess={onLoginSuccess} />)
    fireEvent.change(screen.getByPlaceholderText('tu@email.com'),    { target: { value: 'user@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Mínimo 6 caracteres'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledWith({ name: 'USER', plan: 'PRO ELITE' }))
  })

  it('saves token to localStorage on successful login', async () => {
    const { authClient } = await import('../api')
    ;(authClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { token: 'my-jwt' } })

    render(<Login onLoginSuccess={onLoginSuccess} />)
    fireEvent.change(screen.getByPlaceholderText('tu@email.com'),    { target: { value: 'user@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Mínimo 6 caracteres'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    await waitFor(() => expect(localStorage.getItem('token')).toBe('my-jwt'))
  })

  it('shows error message on 401 response', async () => {
    const { authClient } = await import('../api')
    ;(authClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ response: { status: 401 } })

    render(<Login onLoginSuccess={onLoginSuccess} />)
    fireEvent.change(screen.getByPlaceholderText('tu@email.com'),    { target: { value: 'user@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Mínimo 6 caracteres'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    await waitFor(() => expect(screen.getByText(/Credenciales incorrectas/i)).toBeInTheDocument())
  })

  it('shows network error message', async () => {
    const { authClient } = await import('../api')
    ;(authClient.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce({ code: 'ERR_NETWORK' })

    render(<Login onLoginSuccess={onLoginSuccess} />)
    fireEvent.change(screen.getByPlaceholderText('tu@email.com'),    { target: { value: 'user@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Mínimo 6 caracteres'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    await waitFor(() => expect(screen.getByText(/Sin conexión/i)).toBeInTheDocument())
  })

  it('shows name field in register mode', async () => {
    render(<Login onLoginSuccess={onLoginSuccess} />)
    fireEvent.click(screen.getByText(/Regístrate/i))
    await waitFor(() => expect(screen.getByPlaceholderText(/Tu nombre/i)).toBeInTheDocument())
  })

  it('shows error when name is empty in register mode', async () => {
    render(<Login onLoginSuccess={onLoginSuccess} />)
    fireEvent.click(screen.getByText(/Regístrate/i))
    await waitFor(() => screen.getByPlaceholderText(/Tu nombre/i))

    fireEvent.change(screen.getByPlaceholderText('tu@email.com'),    { target: { value: 'user@test.com' } })
    fireEvent.change(screen.getByPlaceholderText('Mínimo 6 caracteres'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /Crear cuenta/i }))

    await waitFor(() => expect(screen.getByText(/nombre es obligatorio/i)).toBeInTheDocument())
  })
})
