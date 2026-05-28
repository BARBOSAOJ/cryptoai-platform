import { useState, useEffect } from 'react'
import { User, Lock } from 'lucide-react'
import BacktestPanel from './BacktestPanel'
import AdminPanel from './AdminPanel'
import BtRendimientoPanel from './BtRendimientoPanel'
import { userApi } from '../../api'

interface SettingsProps {}


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

export default function Settings({}: SettingsProps) {
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

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

      </div>

      {/* ─── Rendimiento de BT ──────────────────────────────────────────── */}
      <div style={{ marginTop: '24px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div style={sectionLabelStyle}>Rendimiento de BT</div>
        <span style={{
          fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: '#818cf8',
          background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.3)',
          padding: '2px 7px', borderRadius: '5px'
        }}>RAG · Calibración</span>
      </div>
      <div style={{ background: '#091220', border: '1px solid #111e35', borderRadius: '12px', padding: '18px 16px' }}>
        <BtRendimientoPanel />
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


const wrapStyle: React.CSSProperties = {
  padding: '24px 28px', background: '#060d1a',
  fontFamily: 'Inter, sans-serif', color: '#fff'
}
const sectionLabelStyle: React.CSSProperties = {
  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#1e3050',
  letterSpacing: '2px', textTransform: 'uppercase', padding: '0 4px', marginBottom: '4px'
}
const cardStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', borderRadius: '12px', padding: '18px 16px'
}
const iconWrapStyle: React.CSSProperties = {
  width: '34px', height: '34px', background: '#111e35', borderRadius: '9px',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
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
