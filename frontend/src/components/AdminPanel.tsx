import { useState, useEffect, useCallback } from 'react'
import { authClient } from '../api'
import { Shield, Trash2, ChevronLeft, ChevronRight, UserCheck, UserX } from 'lucide-react'

interface UsuarioAdmin {
  id: number
  email: string
  fullName: string
  roles: string[]
  createdAt: string
}

interface PaginaUsuarios {
  content: UsuarioAdmin[]
  page: number
  size: number
  total: number
  totalPages: number
}

export default function AdminPanel() {
  const [pagina, setPagina] = useState(0)
  const [datos, setDatos] = useState<PaginaUsuarios | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [confirmEliminar, setConfirmEliminar] = useState<number | null>(null)

  const cargarUsuarios = useCallback(async (p: number) => {
    setCargando(true)
    setError('')
    try {
      const res = await authClient.get<PaginaUsuarios>(`/admin/users?page=${p}&size=10`)
      setDatos(res.data)
    } catch {
      setError('Error al cargar usuarios')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargarUsuarios(pagina)
  }, [pagina, cargarUsuarios])

  const mostrarFeedback = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(''), 3000)
  }

  const cambiarRol = async (id: number, rolActual: string) => {
    const nuevoRol = rolActual === 'ADMIN' ? 'USER' : 'ADMIN'
    try {
      await authClient.put(`/admin/users/${id}/rol`, { rol: nuevoRol })
      mostrarFeedback(`Rol cambiado a ${nuevoRol}`)
      cargarUsuarios(pagina)
    } catch (e: any) {
      mostrarFeedback(e.response?.data?.error || 'Error al cambiar rol')
    }
  }

  const eliminarUsuario = async (id: number) => {
    if (confirmEliminar !== id) {
      setConfirmEliminar(id)
      setTimeout(() => setConfirmEliminar(null), 3000)
      return
    }
    try {
      await authClient.delete(`/admin/users/${id}`)
      setConfirmEliminar(null)
      mostrarFeedback('Usuario eliminado')
      cargarUsuarios(pagina)
    } catch (e: any) {
      mostrarFeedback(e.response?.data?.error || 'Error al eliminar usuario')
    }
  }

  const formatFecha = (iso: string) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
    } catch {
      return iso.substring(0, 10)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <Shield size={16} color="#818cf8" strokeWidth={1.75} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#818cf8' }}>
          Gestión de usuarios
        </span>
        {datos && (
          <span style={{ fontSize: '11px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>
            ({datos.total} total)
          </span>
        )}
      </div>

      {feedback && (
        <div style={{ fontSize: '12px', color: '#00d060', background: 'rgba(0,208,96,0.08)', border: '1px solid rgba(0,208,96,0.2)', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px' }}>
          {feedback}
        </div>
      )}

      {error && (
        <div style={{ fontSize: '12px', color: '#ff3b3b', background: 'rgba(255,59,59,0.08)', border: '1px solid rgba(255,59,59,0.2)', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px' }}>
          {error}
        </div>
      )}

      {cargando ? (
        <div style={{ fontSize: '12px', color: '#2c4268', textAlign: 'center', padding: '20px' }}>Cargando...</div>
      ) : datos && datos.content.length > 0 ? (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #111e35' }}>
                  {['Email', 'Nombre', 'Rol', 'Registro', 'Acciones'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {datos.content.map(u => {
                  const esAdmin = u.roles.includes('ADMIN')
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid #0d1a2e' }}>
                      <td style={{ padding: '10px 10px', color: '#8ba3cc' }}>{u.email}</td>
                      <td style={{ padding: '10px 10px', color: '#c0cfe6' }}>{u.fullName || '—'}</td>
                      <td style={{ padding: '10px 10px' }}>
                        <span style={{
                          fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
                          color: esAdmin ? '#818cf8' : '#00d060',
                          background: esAdmin ? 'rgba(129,140,248,0.1)' : 'rgba(0,208,96,0.08)',
                          border: `1px solid ${esAdmin ? 'rgba(129,140,248,0.3)' : 'rgba(0,208,96,0.2)'}`,
                          padding: '3px 7px', borderRadius: '5px'
                        }}>
                          {esAdmin ? 'ADMIN' : 'USER'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>
                        {formatFecha(u.createdAt)}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            onClick={() => cambiarRol(u.id, esAdmin ? 'ADMIN' : 'USER')}
                            title={esAdmin ? 'Quitar ADMIN' : 'Hacer ADMIN'}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
                              color: esAdmin ? '#f59e0b' : '#818cf8',
                              background: esAdmin ? 'rgba(245,158,11,0.08)' : 'rgba(129,140,248,0.08)',
                              border: `1px solid ${esAdmin ? 'rgba(245,158,11,0.2)' : 'rgba(129,140,248,0.2)'}`,
                              padding: '4px 8px', borderRadius: '6px', cursor: 'pointer'
                            }}
                          >
                            {esAdmin ? <UserX size={11} /> : <UserCheck size={11} />}
                            {esAdmin ? 'Quitar ADMIN' : 'Hacer ADMIN'}
                          </button>
                          <button
                            onClick={() => eliminarUsuario(u.id)}
                            title={confirmEliminar === u.id ? 'Clic de nuevo para confirmar' : 'Eliminar usuario'}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
                              color: confirmEliminar === u.id ? '#fff' : '#ff3b3b',
                              background: confirmEliminar === u.id ? '#ff3b3b' : 'rgba(255,59,59,0.08)',
                              border: '1px solid rgba(255,59,59,0.2)',
                              padding: '4px 8px', borderRadius: '6px', cursor: 'pointer'
                            }}
                          >
                            <Trash2 size={11} />
                            {confirmEliminar === u.id ? '¿Confirmar?' : 'Eliminar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {datos.totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '16px' }}>
              <button
                onClick={() => setPagina(p => Math.max(0, p - 1))}
                disabled={pagina === 0}
                style={{ ...btnPagStyle, opacity: pagina === 0 ? 0.3 : 1 }}
              >
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: '11px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>
                {pagina + 1} / {datos.totalPages}
              </span>
              <button
                onClick={() => setPagina(p => Math.min(datos.totalPages - 1, p + 1))}
                disabled={pagina >= datos.totalPages - 1}
                style={{ ...btnPagStyle, opacity: pagina >= datos.totalPages - 1 ? 0.3 : 1 }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: '12px', color: '#2c4268', textAlign: 'center', padding: '20px' }}>
          No hay usuarios
        </div>
      )}
    </div>
  )
}

const btnPagStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', color: '#8ba3cc',
  borderRadius: '7px', padding: '5px 8px', cursor: 'pointer',
  display: 'flex', alignItems: 'center'
}
