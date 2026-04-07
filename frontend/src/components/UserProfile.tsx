import { useState, useEffect } from 'react'
import { Edit2, Lock, Save, X, Award, Calendar } from 'lucide-react'
import { userApi } from '../api'
import type { UserProfile as IUserProfile } from '../interfaces'

export default function UserProfile() {
  const [profile, setProfile]           = useState<IUserProfile | null>(null)
  const [editing, setEditing]           = useState(false)
  const [editForm, setEditForm]         = useState({ fullName: '', bio: '', avatarInitials: '' })
  const [pwForm, setPwForm]             = useState({ current: '', next: '', confirm: '' })
  const [showPw, setShowPw]             = useState(false)
  const [saving, setSaving]             = useState(false)
  const [msg, setMsg]                   = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    userApi.getProfile()
      .then(r => {
        setProfile(r.data)
        setEditForm({
          fullName:       r.data.fullName || '',
          bio:            r.data.bio || '',
          avatarInitials: r.data.avatarInitials || '',
        })
      })
      .catch(() => {})
  }, [])

  const saveProfile = async () => {
    setSaving(true)
    try {
      await userApi.updateProfile(editForm)
      setProfile(prev => prev ? { ...prev, ...editForm } : prev)
      setEditing(false)
      flash(true, 'Perfil actualizado correctamente')
    } catch (e: any) {
      flash(false, e.response?.data?.error || 'Error al guardar el perfil')
    } finally {
      setSaving(false)
    }
  }

  const changePw = async () => {
    if (pwForm.next !== pwForm.confirm) {
      flash(false, 'Las contraseñas no coinciden')
      return
    }
    if (pwForm.next.length < 6) {
      flash(false, 'La contraseña debe tener al menos 6 caracteres')
      return
    }
    setSaving(true)
    try {
      await userApi.changePassword(pwForm.current, pwForm.next)
      setShowPw(false)
      setPwForm({ current: '', next: '', confirm: '' })
      flash(true, 'Contraseña actualizada correctamente')
    } catch (e: any) {
      flash(false, e.response?.data?.error || 'Error al cambiar la contraseña')
    } finally {
      setSaving(false)
    }
  }

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 4000)
  }

  if (!profile) return (
    <div style={wrapStyle}>
      <div style={{ color: '#2c4268', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' }}>Cargando perfil...</div>
    </div>
  )

  const initials = profile.avatarInitials || profile.fullName?.substring(0, 2).toUpperCase() || profile.email.substring(0, 2).toUpperCase()
  const memberSince = profile.createdAt ? new Date(profile.createdAt).getFullYear() : new Date().getFullYear()

  return (
    <div style={wrapStyle}>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.5px', margin: '0 0 4px' }}>Perfil</h2>
        <p style={{ fontSize: '12px', color: '#2c4268', margin: 0 }}>Gestiona tu información personal</p>
      </div>

      {msg && (
        <div style={{
          marginBottom: '16px', padding: '10px 14px', borderRadius: '10px', fontSize: '12px',
          background: msg.ok ? 'rgba(0,208,96,0.08)' : 'rgba(255,59,59,0.08)',
          border: `1px solid ${msg.ok ? 'rgba(0,208,96,0.2)' : 'rgba(255,59,59,0.2)'}`,
          color: msg.ok ? '#00d060' : '#ff3b3b',
          fontFamily: 'JetBrains Mono, monospace'
        }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', maxWidth: '700px', flexWrap: 'wrap' }}>

        {/* Avatar card */}
        <div style={cardStyle}>
          <div style={avatarStyle}>{initials}</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '4px' }}>{profile.fullName || 'Sin nombre'}</div>
            <div style={{ fontSize: '11px', color: '#384e70' }}>{profile.email}</div>
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <Stat icon={<Award size={12} color="#818cf8" />} label="Miembro" value={`desde ${memberSince}`} />
            <Stat icon={<Calendar size={12} color="#2dd4bf" />} label="Plan" value="PRO ELITE" />
          </div>
          {profile.bio && (
            <div style={{ fontSize: '11px', color: '#384e70', textAlign: 'center', lineHeight: 1.5, borderTop: '1px solid #111e35', paddingTop: '12px', width: '100%' }}>
              {profile.bio}
            </div>
          )}
        </div>

        {/* Edit form */}
        <div style={{ flex: 1, minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={sectionLabel}>Información personal</span>
            {!editing ? (
              <button onClick={() => setEditing(true)} style={ghostBtn}>
                <Edit2 size={12} /> Editar
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setEditing(false)} style={ghostBtn}><X size={12} /> Cancelar</button>
                <button onClick={saveProfile} disabled={saving} style={primaryBtn}>
                  <Save size={12} /> {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            )}
          </div>

          <Field label="Nombre completo" value={editing ? editForm.fullName : (profile.fullName || '—')}
            disabled={!editing}
            onChange={v => setEditForm(p => ({ ...p, fullName: v }))} />

          <Field label="Iniciales del avatar (2 letras)" value={editing ? editForm.avatarInitials : initials}
            disabled={!editing} maxLength={2}
            onChange={v => setEditForm(p => ({ ...p, avatarInitials: v.toUpperCase().substring(0, 2) }))} />

          <Field label="Biografía" value={editing ? editForm.bio : (profile.bio || '—')}
            disabled={!editing} multiline
            onChange={v => setEditForm(p => ({ ...p, bio: v }))} />

          {/* Change password */}
          <div style={{ marginTop: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={sectionLabel}>Seguridad</span>
              <button onClick={() => setShowPw(p => !p)} style={ghostBtn}>
                <Lock size={12} /> {showPw ? 'Cancelar' : 'Cambiar contraseña'}
              </button>
            </div>

            {showPw && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Field label="Contraseña actual" value={pwForm.current} type="password"
                  onChange={v => setPwForm(p => ({ ...p, current: v }))} />
                <Field label="Nueva contraseña" value={pwForm.next} type="password"
                  onChange={v => setPwForm(p => ({ ...p, next: v }))} />
                <Field label="Confirmar contraseña" value={pwForm.confirm} type="password"
                  onChange={v => setPwForm(p => ({ ...p, confirm: v }))} />
                <button onClick={changePw} disabled={saving} style={{ ...primaryBtn, width: '100%', justifyContent: 'center' }}>
                  {saving ? 'Guardando…' : 'Cambiar contraseña'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, disabled, onChange, multiline, type, maxLength }: {
  label: string; value: string; disabled?: boolean; onChange?: (v: string) => void
  multiline?: boolean; type?: string; maxLength?: number
}) {
  const style: React.CSSProperties = {
    background: '#091220', border: '1px solid #111e35', color: disabled ? '#2c4268' : '#c8d8ec',
    padding: '9px 12px', borderRadius: '8px', fontSize: '12px',
    fontFamily: 'Inter, sans-serif', outline: 'none', width: '100%',
    resize: 'none', cursor: disabled ? 'default' : 'text'
  }
  return (
    <div>
      <div style={{ fontSize: '10px', color: '#243858', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>{label}</div>
      {multiline
        ? <textarea rows={3} value={value} disabled={disabled} onChange={e => onChange?.(e.target.value)} style={style} />
        : <input type={type || 'text'} value={value} disabled={disabled} maxLength={maxLength}
            onChange={e => onChange?.(e.target.value)} style={style} />
      }
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>{icon}<span style={{ fontSize: '9px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span></div>
      <div style={{ fontSize: '11px', fontWeight: 600 }}>{value}</div>
    </div>
  )
}

const wrapStyle: React.CSSProperties = {
  padding: '32px 36px', background: '#060d1a', height: '100%',
  overflowY: 'auto', fontFamily: 'Inter, sans-serif', color: '#fff'
}
const cardStyle: React.CSSProperties = {
  background: '#07101e', border: '1px solid #111e35', borderRadius: '14px',
  padding: '24px 20px', display: 'flex', flexDirection: 'column',
  alignItems: 'center', gap: '12px', width: '200px'
}
const avatarStyle: React.CSSProperties = {
  width: '64px', height: '64px', borderRadius: '50%',
  background: 'linear-gradient(135deg, #818cf8, #2dd4bf)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '22px', fontWeight: 700, color: '#000', letterSpacing: '-1px'
}
const sectionLabel: React.CSSProperties = {
  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#1e3050',
  letterSpacing: '2px', textTransform: 'uppercase'
}
const ghostBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px', background: 'none',
  border: '1px solid #1a1a1a', color: '#486080', fontSize: '10px',
  padding: '5px 10px', borderRadius: '7px', cursor: 'pointer',
  fontFamily: 'Inter, sans-serif'
}
const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px',
  background: '#fff', color: '#000', border: 'none',
  fontSize: '10px', fontWeight: 600, padding: '5px 10px',
  borderRadius: '7px', cursor: 'pointer', fontFamily: 'Inter, sans-serif'
}
