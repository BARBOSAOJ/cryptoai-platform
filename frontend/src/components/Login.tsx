import { useState } from 'react'
import { authClient } from '../api'
import { TrendingUp } from 'lucide-react'

interface LoginProps {
  onLoginSuccess: (userData: { name: string; plan: string }) => void
}

function validateEmail(email: string): string {
  if (!email.trim()) return 'El email es obligatorio'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Introduce un email válido'
  return ''
}

function validatePassword(password: string): string {
  if (!password) return 'La contraseña es obligatoria'
  if (password.length < 6) return 'La contraseña debe tener al menos 6 caracteres'
  return ''
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [isRegistering, setIsRegistering] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const email    = (form.elements.namedItem('email')    as HTMLInputElement).value.trim()
    const password = (form.elements.namedItem('password') as HTMLInputElement).value

    const emailErr = validateEmail(email)
    if (emailErr) { setError(emailErr); return }
    const passErr = validatePassword(password)
    if (passErr)  { setError(passErr);  return }

    setLoading(true)
    setError('')
    try {
      const res = await authClient.post('/auth/login', { email, password })
      if (res.data.token) {
        try {
          localStorage.setItem('token', res.data.token)
        } catch {
          // localStorage lleno o deshabilitado — usar sessionStorage como fallback
          try { sessionStorage.setItem('token', res.data.token) } catch { /* ignorar */ }
        }
        onLoginSuccess({ name: email.split('@')[0].toUpperCase(), plan: 'PRO ELITE' })
      }
    } catch (e: any) {
      if (e.response?.status === 401 || e.response?.status === 400) {
        setError('Credenciales incorrectas')
      } else if (e.code === 'ERR_NETWORK') {
        setError('Sin conexión con el servidor de autenticación')
      } else {
        setError('Error al iniciar sesión. Inténtalo de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const email    = (form.elements.namedItem('email')    as HTMLInputElement).value.trim()
    const password = (form.elements.namedItem('password') as HTMLInputElement).value
    const fullName = (form.elements.namedItem('fullName') as HTMLInputElement)?.value.trim() || ''

    const emailErr = validateEmail(email)
    if (emailErr) { setError(emailErr); return }
    const passErr = validatePassword(password)
    if (passErr)  { setError(passErr);  return }
    if (!fullName) { setError('El nombre es obligatorio'); return }

    setLoading(true)
    setError('')
    try {
      await authClient.post('/auth/register', { email, fullName, password })
      setIsRegistering(false)
      setError('')
    } catch (e: any) {
      if (e.response?.status === 409) {
        setError('Este email ya está registrado')
      } else if (e.code === 'ERR_NETWORK') {
        setError('Sin conexión con el servidor de autenticación')
      } else {
        setError('Error en el registro. Inténtalo de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={brandRowStyle}>
          <div style={logoStyle}><TrendingUp size={18} color="#000" strokeWidth={2.5} /></div>
          <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-0.3px' }}>CryptoAI</span>
        </div>

        <div style={{ marginBottom: '28px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.8px', margin: '0 0 6px' }}>
            {isRegistering ? 'Crear cuenta' : 'Bienvenido'}
          </h1>
          <p style={{ fontSize: '13px', color: '#2c4268', margin: 0 }}>
            {isRegistering ? 'Regístrate para acceder al terminal' : 'Accede a tu terminal de trading'}
          </p>
        </div>

        {error && (
          <div style={{ background: 'rgba(255,59,59,0.08)', border: '1px solid rgba(255,59,59,0.2)', borderRadius: '8px', padding: '10px 12px', marginBottom: '16px', fontSize: '12px', color: '#ff3b3b' }}>
            {error}
          </div>
        )}

        <form onSubmit={isRegistering ? handleRegister : handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} noValidate>
          {isRegistering && (
            <div>
              <div style={labelStyle}>Nombre completo</div>
              <input name="fullName" type="text" placeholder="Tu nombre" required minLength={2} style={fieldStyle} />
            </div>
          )}
          <div>
            <div style={labelStyle}>Email</div>
            <input name="email" type="email" placeholder="tu@email.com" required style={fieldStyle} />
          </div>
          <div>
            <div style={labelStyle}>Contraseña</div>
            <input name="password" type="password" placeholder="Mínimo 6 caracteres" required minLength={6} style={fieldStyle} />
          </div>
          <button type="submit" disabled={loading} style={btnStyle(loading)}>
            {loading ? 'Cargando...' : isRegistering ? 'Crear cuenta' : 'Entrar'}
          </button>
        </form>

        <p
          onClick={() => { setIsRegistering(!isRegistering); setError('') }}
          style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: '#2c4268', cursor: 'pointer' }}
        >
          {isRegistering ? '¿Ya tienes cuenta? ' : '¿No tienes cuenta? '}
          <span style={{ color: '#fff' }}>{isRegistering ? 'Inicia sesión' : 'Regístrate'}</span>
        </p>
      </div>
    </div>
  )
}

const wrapStyle: React.CSSProperties = {
  height: '100vh', width: '100vw', background: '#060d1a',
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  fontFamily: 'Inter, sans-serif'
}
const cardStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', borderRadius: '20px',
  padding: '36px', width: '360px'
}
const brandRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px'
}
const logoStyle: React.CSSProperties = {
  width: '34px', height: '34px', background: '#fff', borderRadius: '9px',
  display: 'flex', alignItems: 'center', justifyContent: 'center'
}
const labelStyle: React.CSSProperties = {
  fontSize: '11px', color: '#2c4268', marginBottom: '6px', fontWeight: 500
}
const fieldStyle: React.CSSProperties = {
  background: '#0d1730', border: '1px solid #1a1a1a', color: '#fff',
  padding: '11px 14px', borderRadius: '10px', fontSize: '13px',
  width: '100%', fontFamily: 'Inter, sans-serif', outline: 'none',
  boxSizing: 'border-box'
}
const btnStyle = (loading: boolean): React.CSSProperties => ({
  background: '#fff', color: '#000', border: 'none',
  padding: '13px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
  cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
  fontFamily: 'Inter, sans-serif', marginTop: '4px', transition: 'opacity 0.15s'
})
