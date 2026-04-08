import { useState, useEffect } from 'react'
import { Zap, Shield, Database, Brain, Cpu, CheckCircle, XCircle, User, Lock } from 'lucide-react'
import BacktestPanel from './BacktestPanel'
import AdminPanel from './AdminPanel'
import { userApi } from '../../api'

interface SettingsProps {
  setRefreshInterval: (v: number) => void
  currentInterval: number
  aiHealth?: { lstm: boolean; finbert: boolean } | null
}

function decodificarToken(token: string | null): { roles: string[]; email: string } {
  if (!token) return { roles: [], email: '' }
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return {
      roles: payload.groups || [],
      email: payload.upn || payload.sub || ''
    }
  } catch {
    return { roles: [], email: '' }
  }
}

export default function Settings({ setRefreshInterval, currentInterval, aiHealth }: SettingsProps) {
  const token = localStorage.getItem('token')
  const { roles, email } = decodificarToken(token)
  const esAdmin = roles.includes('ADMIN')

  // ─── Perfil ───────────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState('')
  const [perfilMsg, setPerfilMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [guardandoPerfil, setGuardandoPerfil] = useState(false)

  useEffect(() => {
    userApi.getProfile().then(res => {
      setFullName(res.data.fullName || '')
    }).catch(() => {})
  }, [])

  const guardarPerfil = async () => {
    setGuardandoPerfil(true)
    setPerfilMsg(null)
    try {
      await userApi.updateProfile({ fullName })
      setPerfilMsg({ ok: true, text: 'Perfil actualizado correctamente' })
    } catch {
      setPerfilMsg({ ok: false, text: 'Error al actualizar el perfil' })
    } finally {
      setGuardandoPerfil(false)
    }
  }

  // ─── Cambio de contraseña ─────────────────────────────────────────────────
  const [contrasenaActual, setContrasenaActual] = useState('')
  const [contrasenaNueva, setContrasenaNueva] = useState('')
  const [contrasenaConfirm, setContrasenaConfirm] = useState('')
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [guardandoPw, setGuardandoPw] = useState(false)

  const cambiarContrasena = async () => {
    if (contrasenaNueva !== contrasenaConfirm) {
      setPwMsg({ ok: false, text: 'Las contraseñas nuevas no coinciden' })
      return
    }
    if (contrasenaNueva.length < 6) {
      setPwMsg({ ok: false, text: 'La nueva contraseña debe tener al menos 6 caracteres' })
      return
    }
    setGuardandoPw(true)
    setPwMsg(null)
    try {
      await userApi.changePassword(contrasenaActual, contrasenaNueva)
      setPwMsg({ ok: true, text: 'Contraseña actualizada correctamente' })
      setContrasenaActual('')
      setContrasenaNueva('')
      setContrasenaConfirm('')
    } catch (e: any) {
      setPwMsg({ ok: false, text: e.response?.data?.error || 'Error al cambiar la contraseña' })
    } finally {
      setGuardandoPw(false)
    }
  }

  return (
    <div style={wrapStyle}>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.5px', margin: '0 0 4px' }}>Configuración</h2>
        <p style={{ fontSize: '12px', color: '#2c4268', margin: 0 }}>Ajustes del terminal de trading</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '560px' }}>

        {/* ─── Mi perfil ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <div style={sectionLabelStyle}>Mi perfil</div>
          <span style={{
            fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
            color: esAdmin ? '#818cf8' : '#00d060',
            background: esAdmin ? 'rgba(129,140,248,0.1)' : 'rgba(0,208,96,0.08)',
            border: `1px solid ${esAdmin ? 'rgba(129,140,248,0.3)' : 'rgba(0,208,96,0.2)'}`,
            padding: '2px 7px', borderRadius: '5px', marginLeft: '4px'
          }}>
            {esAdmin ? 'ADMIN' : 'USER'}
          </span>
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <div style={{ ...iconWrapStyle, background: '#0a0a1a' }}>
              <User size={16} strokeWidth={1.75} color="#818cf8" />
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500 }}>Datos personales</div>
              <div style={{ fontSize: '11px', color: '#2c4268' }}>{email}</div>
            </div>
          </div>

          <label style={labelStyle}>Nombre completo</label>
          <input
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="Tu nombre"
            style={inputStyle}
          />

          {perfilMsg && (
            <div style={{ fontSize: '12px', color: perfilMsg.ok ? '#00d060' : '#ff3b3b', marginTop: '8px' }}>
              {perfilMsg.text}
            </div>
          )}

          <button
            onClick={guardarPerfil}
            disabled={guardandoPerfil}
            style={{ ...btnStyle, marginTop: '12px', opacity: guardandoPerfil ? 0.6 : 1 }}
          >
            {guardandoPerfil ? 'Guardando...' : 'Guardar perfil'}
          </button>
        </div>

        {/* ─── Cambio de contraseña ──────────────────────────────────────── */}
        <div style={{ marginTop: '8px' }} />
        <div style={sectionLabelStyle}>Seguridad</div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <div style={{ ...iconWrapStyle, background: '#0a1a0a' }}>
              <Lock size={16} strokeWidth={1.75} color="#00d060" />
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500 }}>Cambiar contraseña</div>
              <div style={{ fontSize: '11px', color: '#2c4268' }}>Mínimo 6 caracteres</div>
            </div>
          </div>

          <label style={labelStyle}>Contraseña actual</label>
          <input
            type="password"
            value={contrasenaActual}
            onChange={e => setContrasenaActual(e.target.value)}
            placeholder="••••••••"
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: '10px' }}>Nueva contraseña</label>
          <input
            type="password"
            value={contrasenaNueva}
            onChange={e => setContrasenaNueva(e.target.value)}
            placeholder="••••••••"
            style={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: '10px' }}>Confirmar nueva contraseña</label>
          <input
            type="password"
            value={contrasenaConfirm}
            onChange={e => setContrasenaConfirm(e.target.value)}
            placeholder="••••••••"
            style={inputStyle}
          />

          {pwMsg && (
            <div style={{ fontSize: '12px', color: pwMsg.ok ? '#00d060' : '#ff3b3b', marginTop: '8px' }}>
              {pwMsg.text}
            </div>
          )}

          <button
            onClick={cambiarContrasena}
            disabled={guardandoPw}
            style={{ ...btnStyle, marginTop: '12px', opacity: guardandoPw ? 0.6 : 1 }}
          >
            {guardandoPw ? 'Cambiando...' : 'Cambiar contraseña'}
          </button>
        </div>

        {/* ─── Motor IA ─────────────────────────────────────────────────── */}
        <div style={{ marginTop: '8px' }} />
        <div style={sectionLabelStyle}>Motor IA</div>

        <div style={rowStyle}>
          <div style={iconWrapStyle}><Zap size={16} strokeWidth={1.75} color="#fff" /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>Velocidad de escaneo</div>
            <div style={{ fontSize: '11px', color: '#2c4268' }}>Frecuencia de análisis de la red neuronal</div>
          </div>
          <select value={currentInterval} onChange={e => setRefreshInterval(parseInt(e.target.value))} style={selectStyle}>
            <option value={5000}>Conservador · 5s</option>
            <option value={3000}>Moderado · 3s</option>
            <option value={1000}>Agresivo · 1s</option>
          </select>
        </div>

        {/* Estado de modelos IA */}
        <div style={rowStyle}>
          <div style={{ ...iconWrapStyle, background: '#0a0a1a' }}><Brain size={16} strokeWidth={1.75} color="#818cf8" /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>Estado modelos IA</div>
            <div style={{ fontSize: '11px', color: '#2c4268' }}>LSTM (predicción técnica) + FinBERT (sentimiento)</div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <ModelBadge label="LSTM"    active={aiHealth?.lstm    ?? null} />
            <ModelBadge label="FinBERT" active={aiHealth?.finbert ?? null} />
          </div>
        </div>

        <div style={{ marginTop: '8px' }} />
        <div style={sectionLabelStyle}>Sistema</div>

        <div style={rowStyle}>
          <div style={{ ...iconWrapStyle, background: '#0a1a0a' }}><Shield size={16} strokeWidth={1.75} color="#00d060" /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>Seguridad</div>
            <div style={{ fontSize: '11px', color: '#2c4268' }}>Encriptación RSA-2048 activa</div>
          </div>
          <span style={activeBadgeStyle}>Activo</span>
        </div>

        <div style={rowStyle}>
          <div style={{ ...iconWrapStyle, background: '#0a0a1a' }}><Cpu size={16} strokeWidth={1.75} color="#818cf8" /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>Fuente de datos</div>
            <div style={{ fontSize: '11px', color: '#2c4268' }}>Binance WebSocket · Tiempo real</div>
          </div>
          <span style={activeBadgeStyle}>Activo</span>
        </div>

        <div style={rowStyle}>
          <div style={{ ...iconWrapStyle, background: '#0a1010' }}><Database size={16} strokeWidth={1.75} color="#2dd4bf" /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px' }}>Persistencia</div>
            <div style={{ fontSize: '11px', color: '#2c4268' }}>PostgreSQL · Trades almacenados en base de datos</div>
          </div>
          <span style={activeBadgeStyle}>Activo</span>
        </div>

      </div>

      <BacktestPanel />

      {/* ─── Panel de administración (solo ADMIN) ──────────────────────── */}
      {esAdmin && (
        <div style={{ maxWidth: '700px', marginTop: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={sectionLabelStyle}>Panel de administración</div>
            <span style={{
              fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: '#818cf8',
              background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.3)',
              padding: '2px 7px', borderRadius: '5px'
            }}>Solo ADMIN</span>
          </div>
          <div style={{ background: '#091220', border: '1px solid #111e35', borderRadius: '12px', padding: '20px' }}>
            <AdminPanel />
          </div>
        </div>
      )}
    </div>
  )
}

function ModelBadge({ label, active }: { label: string; active: boolean | null }) {
  const color = active === null ? '#2c4268' : active ? '#00d060' : '#ff3b3b'
  const bg    = active === null ? '#0b1424' : active ? 'rgba(0,208,96,0.08)' : 'rgba(255,59,59,0.08)'
  const border = active === null ? '#1a2840' : active ? 'rgba(0,208,96,0.2)' : 'rgba(255,59,59,0.2)'
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color, background: bg, border: `1px solid ${border}`, padding: '4px 8px', borderRadius: '6px' }}>
      {active === null
        ? '—'
        : active
          ? <CheckCircle size={10} color="#00d060" strokeWidth={2} />
          : <XCircle size={10} color="#ff3b3b" strokeWidth={2} />}
      {label}
    </span>
  )
}

const wrapStyle: React.CSSProperties = {
  padding: '32px 36px', background: '#060d1a', height: '100%',
  overflowY: 'auto', fontFamily: 'Inter, sans-serif', color: '#fff'
}
const sectionLabelStyle: React.CSSProperties = {
  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#1e3050',
  letterSpacing: '2px', textTransform: 'uppercase', padding: '0 4px', marginBottom: '4px'
}
const cardStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', borderRadius: '12px', padding: '18px 16px'
}
const rowStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', borderRadius: '12px',
  padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '14px'
}
const iconWrapStyle: React.CSSProperties = {
  width: '34px', height: '34px', background: '#111e35', borderRadius: '9px',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
}
const selectStyle: React.CSSProperties = {
  background: '#111e35', border: '1px solid #1a1a1a', color: '#fff',
  padding: '7px 10px', borderRadius: '8px', fontSize: '11px',
  fontFamily: 'Inter, sans-serif', cursor: 'pointer', outline: 'none'
}
const activeBadgeStyle: React.CSSProperties = {
  fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: '#00d060',
  background: 'rgba(0,208,96,0.08)', border: '1px solid rgba(0,208,96,0.15)',
  padding: '4px 9px', borderRadius: '6px'
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', color: '#2c4268',
  fontFamily: 'JetBrains Mono, monospace', marginBottom: '6px'
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0d1a2e', border: '1px solid #111e35', color: '#fff',
  padding: '9px 12px', borderRadius: '8px', fontSize: '12px',
  fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box'
}
const btnStyle: React.CSSProperties = {
  background: '#1a2a4a', border: '1px solid #243858', color: '#8ba3cc',
  padding: '9px 18px', borderRadius: '8px', fontSize: '12px',
  fontFamily: 'Inter, sans-serif', cursor: 'pointer'
}
