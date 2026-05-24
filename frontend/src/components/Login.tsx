import { useState } from 'react'
import { authClient } from '../api'
import { motion, AnimatePresence } from 'framer-motion'
import { TrendingUp, AlertCircle, ArrowRight, Loader2 } from 'lucide-react'

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
  if (password.length < 6) return 'Mínimo 6 caracteres'
  return ''
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [isRegistering, setIsRegistering] = useState(false)
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState('')
  const [success, setSuccess]             = useState('')

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form     = e.currentTarget
    const email    = (form.elements.namedItem('email')    as HTMLInputElement).value.trim()
    const password = (form.elements.namedItem('password') as HTMLInputElement).value

    const emailErr = validateEmail(email)
    if (emailErr) { setError(emailErr); return }
    const passErr = validatePassword(password)
    if (passErr)  { setError(passErr);  return }

    setLoading(true); setError('')
    try {
      const res = await authClient.post('/auth/login', { email, password })
      if (res.data.token) {
        try { localStorage.setItem('token', res.data.token) }
        catch { try { sessionStorage.setItem('token', res.data.token) } catch { /* noop */ } }
        onLoginSuccess({ name: email.split('@')[0].toUpperCase(), plan: 'PRO ELITE' })
      }
    } catch (e: any) {
      if (e.response?.status === 401 || e.response?.status === 400) setError('Credenciales incorrectas')
      else if (e.code === 'ERR_NETWORK') setError('Sin conexión con el servidor')
      else setError('Error al iniciar sesión. Inténtalo de nuevo.')
    } finally { setLoading(false) }
  }

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form     = e.currentTarget
    const email    = (form.elements.namedItem('email')    as HTMLInputElement).value.trim()
    const password = (form.elements.namedItem('password') as HTMLInputElement).value
    const fullName = (form.elements.namedItem('fullName') as HTMLInputElement)?.value.trim() || ''

    const emailErr = validateEmail(email)
    if (emailErr) { setError(emailErr); return }
    const passErr = validatePassword(password)
    if (passErr)  { setError(passErr);  return }
    if (!fullName) { setError('El nombre es obligatorio'); return }

    setLoading(true); setError('')
    try {
      await authClient.post('/auth/register', { email, fullName, password })
      setSuccess('Cuenta creada. Ahora inicia sesión.')
      setIsRegistering(false)
    } catch (e: any) {
      if (e.response?.status === 409) setError('Este email ya está registrado')
      else if (e.code === 'ERR_NETWORK') setError('Sin conexión con el servidor')
      else setError('Error en el registro. Inténtalo de nuevo.')
    } finally { setLoading(false) }
  }

  return (
    <div style={{
      height: '100vh', width: '100vw',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.08) 0%, var(--bg-base) 60%)',
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      fontFamily: 'Inter, sans-serif', position: 'relative', overflow: 'hidden',
    }}>
      {/* Ambient dots */}
      {[...Array(6)].map((_, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: 2 + (i % 3),
          height: 2 + (i % 3),
          borderRadius: '50%',
          background: i % 2 === 0 ? 'rgba(99,102,241,0.4)' : 'rgba(0,208,96,0.3)',
          left: `${10 + i * 15}%`,
          top: `${20 + (i * 13) % 60}%`,
          animation: `float ${4 + i * 0.6}s ease-in-out ${i * 0.4}s infinite`,
          pointerEvents: 'none',
        }} />
      ))}

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.25,0.46,0.45,0.94] } }}
        style={{
          background: 'rgba(9,18,32,0.92)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(99,102,241,0.15)',
          borderRadius: 20,
          padding: '36px 32px',
          width: 380,
          boxShadow: '0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02)',
          position: 'relative',
        }}
      >
        {/* Top gradient line */}
        <div style={{
          position: 'absolute', top: 0, left: '20%', right: '20%', height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.6), transparent)',
          borderRadius: '0 0 2px 2px',
        }} />

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 30 }}>
          <div style={{
            width: 36, height: 36, background: 'linear-gradient(135deg, #818cf8, #6366f1)',
            borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 16px rgba(99,102,241,0.35)',
          }}>
            <TrendingUp size={18} color="#fff" strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px' }}>CryptoAI</div>
            <div style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '2px' }}>TERMINAL v4.0</div>
          </div>
        </div>

        {/* Title */}
        <AnimatePresence mode="wait">
          <motion.div
            key={isRegistering ? 'reg' : 'login'}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            style={{ marginBottom: 24 }}
          >
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.6px', margin: '0 0 6px', color: 'var(--text-1)' }}>
              {isRegistering ? 'Crear cuenta' : 'Bienvenido de vuelta'}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-4)', margin: 0 }}>
              {isRegistering ? 'Regístrate para acceder al terminal' : 'Accede a tu terminal de trading IA'}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* Success message */}
        <AnimatePresence>
          {success && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{
                background: 'rgba(0,208,96,0.08)', border: '1px solid rgba(0,208,96,0.2)',
                borderRadius: 8, padding: '10px 12px', marginBottom: 16,
                fontSize: 12, color: 'var(--green)',
              }}
            >
              {success}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error message */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              style={{
                background: 'var(--red-dim)', border: '1px solid var(--red-mid)',
                borderRadius: 8, padding: '10px 12px', marginBottom: 16,
                fontSize: 12, color: 'var(--red)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <AlertCircle size={14} color="var(--red)" strokeWidth={2} />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form */}
        <AnimatePresence mode="wait">
          <motion.form
            key={isRegistering ? 'form-reg' : 'form-login'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onSubmit={isRegistering ? handleRegister : handleLogin}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            noValidate
          >
            {isRegistering && (
              <Field label="Nombre completo" name="fullName" type="text" placeholder="Tu nombre" />
            )}
            <Field label="Email" name="email" type="email" placeholder="tu@email.com" />
            <Field label="Contraseña" name="password" type="password" placeholder="Mínimo 6 caracteres" />

            <motion.button
              type="submit"
              disabled={loading}
              whileHover={!loading ? { scale: 1.02, boxShadow: '0 0 20px rgba(99,102,241,0.4)' } : {}}
              whileTap={!loading ? { scale: 0.97 } : {}}
              style={{
                background: loading ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg, #818cf8, #6366f1)',
                color: '#fff', border: 'none',
                padding: '13px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'Inter, sans-serif', marginTop: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: '0 0 12px rgba(99,102,241,0.25)',
                transition: 'all var(--transition)',
              }}
            >
              {loading
                ? <Loader2 size={16} strokeWidth={2} className="spin" />
                : <>
                    {isRegistering ? 'Crear cuenta' : 'Entrar al terminal'}
                    <ArrowRight size={15} strokeWidth={2} />
                  </>
              }
            </motion.button>
          </motion.form>
        </AnimatePresence>

        <p
          onClick={() => { setIsRegistering(!isRegistering); setError(''); setSuccess('') }}
          style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text-4)', cursor: 'pointer' }}
        >
          {isRegistering ? '¿Ya tienes cuenta? ' : '¿No tienes cuenta? '}
          <span style={{ color: 'var(--indigo)', fontWeight: 500 }}>
            {isRegistering ? 'Inicia sesión' : 'Regístrate'}
          </span>
        </p>
      </motion.div>
    </div>
  )
}

function Field({ label, name, type, placeholder }: { label: string; name: string; type: string; placeholder: string }) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 5, fontWeight: 500 }}>{label}</div>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          background: 'var(--bg-input)',
          border: `1px solid ${focused ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`,
          color: 'var(--text-1)',
          padding: '11px 14px', borderRadius: 10, fontSize: 13,
          width: '100%', fontFamily: 'Inter, sans-serif', outline: 'none',
          transition: 'border-color var(--transition), box-shadow var(--transition)',
          boxShadow: focused ? '0 0 0 3px rgba(99,102,241,0.1)' : 'none',
        }}
      />
    </div>
  )
}
