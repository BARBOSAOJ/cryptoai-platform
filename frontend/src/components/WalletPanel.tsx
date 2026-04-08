import { useState, useEffect, useCallback } from 'react'
import { Wallet, TrendingUp, TrendingDown, ArrowDownCircle, ArrowUpCircle, RefreshCw, X } from 'lucide-react'
import { apiClient } from '../api'

interface CarteraResumen {
  saldoDisponible: number
  valorPosiciones: number
  pnlTotal: number
  patrimonioTotal: number
  depositoInicial: number
  creadoEn: string | null
  tieneCartera: boolean
}

interface WalletPanelProps {
  onSaldoActualizado?: (saldo: number) => void
}

export default function WalletPanel({ onSaldoActualizado }: WalletPanelProps) {
  const [cartera, setCartera]         = useState<CarteraResumen | null>(null)
  const [loading, setLoading]         = useState(true)
  const [modalType, setModalType]     = useState<'depositar' | 'retirar' | null>(null)
  const [cantidad, setCantidad]       = useState('')
  const [operando, setOperando]       = useState(false)
  const [mensaje, setMensaje]         = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null)

  const fetchCartera = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get('/cartera')
      setCartera(res.data)
      onSaldoActualizado?.(res.data.saldoDisponible)
    } catch (e: any) {
      if (import.meta.env.DEV) console.warn('[WalletPanel] Error al cargar cartera:', e?.message)
    } finally {
      setLoading(false)
    }
  }, [onSaldoActualizado])

  useEffect(() => { fetchCartera() }, [fetchCartera])

  const abrirModal = (tipo: 'depositar' | 'retirar') => {
    setCantidad('')
    setMensaje(null)
    setModalType(tipo)
  }

  const cerrarModal = () => {
    setModalType(null)
    setCantidad('')
    setMensaje(null)
  }

  const ejecutarOperacion = async () => {
    const num = parseFloat(cantidad)
    if (isNaN(num) || num <= 0) {
      setMensaje({ texto: 'Introduce una cantidad válida mayor que 0', tipo: 'error' })
      return
    }

    setOperando(true)
    setMensaje(null)
    try {
      const endpoint = modalType === 'depositar' ? '/cartera/depositar' : '/cartera/retirar'
      const res = await apiClient.post(endpoint, { cantidad: num })
      setMensaje({ texto: res.data.mensaje, tipo: 'ok' })
      await fetchCartera()
      setTimeout(cerrarModal, 1200)
    } catch (e: any) {
      const errMsg = e.response?.data?.error || 'Error al realizar la operación'
      setMensaje({ texto: errMsg, tipo: 'error' })
    } finally {
      setOperando(false)
    }
  }

  const pnlPositivo = (cartera?.pnlTotal ?? 0) >= 0

  return (
    <>
      <div style={panelStyle}>
        {/* Cabecera */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wallet size={14} color="#486080" strokeWidth={1.75} />
            <span style={labelStyle}>Cartera Virtual</span>
          </div>
          <button onClick={fetchCartera} disabled={loading} style={iconBtnStyle} title="Actualizar cartera">
            <RefreshCw size={11} color={loading ? '#1a2840' : '#2c4268'} strokeWidth={1.75}
              style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>

        {/* Métricas */}
        <div style={metricsGridStyle}>
          {/* Saldo disponible */}
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Saldo disponible</div>
            <div style={metricValueStyle}>
              {loading ? '—' : `$${(cartera?.saldoDisponible ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            </div>
          </div>

          {/* Valor posiciones */}
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>En posiciones</div>
            <div style={metricValueStyle}>
              {loading ? '—' : `$${(cartera?.valorPosiciones ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            </div>
          </div>

          {/* P&L */}
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>P&L total</div>
            <div style={{ ...metricValueStyle, color: pnlPositivo ? '#00d060' : '#ff3b3b', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {pnlPositivo
                ? <TrendingUp size={13} color="#00d060" strokeWidth={2} />
                : <TrendingDown size={13} color="#ff3b3b" strokeWidth={2} />}
              {loading ? '—' : `${pnlPositivo ? '+' : ''}$${(cartera?.pnlTotal ?? 0).toFixed(2)}`}
            </div>
          </div>

          {/* Patrimonio total */}
          <div style={{ ...metricCardStyle, gridColumn: 'span 3' }}>
            <div style={metricLabelStyle}>Patrimonio total (saldo + posiciones)</div>
            <div style={{ ...metricValueStyle, fontSize: '20px' }}>
              {loading ? '—' : `$${(cartera?.patrimonioTotal ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            </div>
          </div>
        </div>

        {/* Botones */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
          <button onClick={() => abrirModal('depositar')} style={depositBtnStyle}>
            <ArrowDownCircle size={13} color="#00d060" strokeWidth={1.75} />
            Depositar
          </button>
          <button onClick={() => abrirModal('retirar')} style={withdrawBtnStyle}>
            <ArrowUpCircle size={13} color="#ff3b3b" strokeWidth={1.75} />
            Retirar
          </button>
        </div>

        {!cartera?.tieneCartera && !loading && (
          <div style={hintStyle}>
            Deposita fondos para empezar a operar con saldo virtual
          </div>
        )}
      </div>

      {/* Modal depositar / retirar */}
      {modalType && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#c8d8ec' }}>
                {modalType === 'depositar' ? 'Depositar fondos' : 'Retirar fondos'}
              </span>
              <button onClick={cerrarModal} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
                <X size={14} color="#486080" />
              </button>
            </div>

            {cartera && (
              <div style={{ fontSize: '11px', color: '#486080', fontFamily: 'JetBrains Mono, monospace', marginBottom: '16px' }}>
                Saldo disponible: ${cartera.saldoDisponible.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            )}

            <label style={{ fontSize: '10px', color: '#2c4268', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' }}>
              Cantidad (USDT)
            </label>
            <input
              type="number"
              min="1"
              step="0.01"
              value={cantidad}
              onChange={e => setCantidad(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ejecutarOperacion()}
              placeholder="0.00"
              autoFocus
              style={inputStyle}
            />

            {mensaje && (
              <div style={{
                ...mensajeStyle,
                color: mensaje.tipo === 'ok' ? '#00d060' : '#ff3b3b',
                background: mensaje.tipo === 'ok' ? 'rgba(0,208,96,0.06)' : 'rgba(255,59,59,0.06)',
                border: `1px solid ${mensaje.tipo === 'ok' ? 'rgba(0,208,96,0.15)' : 'rgba(255,59,59,0.15)'}`
              }}>
                {mensaje.texto}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={cerrarModal} style={cancelBtnStyle}>Cancelar</button>
              <button
                onClick={ejecutarOperacion}
                disabled={operando}
                style={modalType === 'depositar' ? confirmDepositBtnStyle : confirmWithdrawBtnStyle}
              >
                {operando ? 'Procesando...' : modalType === 'depositar' ? 'Depositar' : 'Retirar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', borderRadius: '14px',
  padding: '20px 24px', marginBottom: '20px'
}
const labelStyle: React.CSSProperties = {
  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#1e3050',
  letterSpacing: '2px', textTransform: 'uppercase'
}
const metricsGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px'
}
const metricCardStyle: React.CSSProperties = {
  background: '#060d1a', border: '1px solid #0e1c30', borderRadius: '10px', padding: '12px 14px'
}
const metricLabelStyle: React.CSSProperties = {
  fontSize: '9px', color: '#2c4268', textTransform: 'uppercase',
  letterSpacing: '0.5px', marginBottom: '6px', fontFamily: 'JetBrains Mono, monospace'
}
const metricValueStyle: React.CSSProperties = {
  fontSize: '15px', fontWeight: 700, letterSpacing: '-0.5px', color: '#c8d8ec',
  fontFamily: 'JetBrains Mono, monospace'
}
const depositBtnStyle: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
  background: 'rgba(0,208,96,0.07)', border: '1px solid rgba(0,208,96,0.18)',
  borderRadius: '8px', padding: '9px 14px', cursor: 'pointer',
  color: '#00d060', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
  fontWeight: 500, transition: 'background 0.15s'
}
const withdrawBtnStyle: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
  background: 'rgba(255,59,59,0.07)', border: '1px solid rgba(255,59,59,0.18)',
  borderRadius: '8px', padding: '9px 14px', cursor: 'pointer',
  color: '#ff3b3b', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
  fontWeight: 500, transition: 'background 0.15s'
}
const hintStyle: React.CSSProperties = {
  marginTop: '12px', fontSize: '10px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace',
  textAlign: 'center', fontStyle: 'italic'
}
const iconBtnStyle: React.CSSProperties = {
  background: '#0b1424', border: '1px solid #111e35', borderRadius: '6px',
  padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center'
}
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(4,10,24,0.85)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500,
  backdropFilter: 'blur(2px)'
}
const modalStyle: React.CSSProperties = {
  background: '#0d1730', border: '1px solid #1a2840', borderRadius: '14px',
  padding: '24px', width: '320px', boxShadow: '0 16px 40px rgba(0,0,0,0.7)'
}
const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: '8px', padding: '10px 12px',
  background: '#091220', border: '1px solid #1a2840', borderRadius: '8px',
  color: '#c8d8ec', fontSize: '14px', fontFamily: 'JetBrains Mono, monospace',
  outline: 'none', boxSizing: 'border-box'
}
const mensajeStyle: React.CSSProperties = {
  marginTop: '12px', padding: '9px 12px', borderRadius: '7px',
  fontSize: '11px', fontFamily: 'JetBrains Mono, monospace'
}
const cancelBtnStyle: React.CSSProperties = {
  flex: 1, padding: '10px', background: '#091220', border: '1px solid #1a2840',
  borderRadius: '8px', color: '#486080', fontSize: '12px', cursor: 'pointer'
}
const confirmDepositBtnStyle: React.CSSProperties = {
  flex: 1, padding: '10px', background: 'rgba(0,208,96,0.12)',
  border: '1px solid rgba(0,208,96,0.25)', borderRadius: '8px',
  color: '#00d060', fontSize: '12px', fontWeight: 600, cursor: 'pointer'
}
const confirmWithdrawBtnStyle: React.CSSProperties = {
  flex: 1, padding: '10px', background: 'rgba(255,59,59,0.12)',
  border: '1px solid rgba(255,59,59,0.25)', borderRadius: '8px',
  color: '#ff3b3b', fontSize: '12px', fontWeight: 600, cursor: 'pointer'
}
