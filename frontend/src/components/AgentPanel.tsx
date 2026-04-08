import { Bot, Power, AlertTriangle, Activity } from 'lucide-react'
import type { EstadoAgente, ConfigAgente } from '../hooks/useAgenteAutonomo'

const MAIN_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'TRUMPUSDT', 'PEPEUSDT', 'DOGEUSDT']

interface AgentPanelProps {
  estado: EstadoAgente
  activar: () => void
  pausar: () => void
  configurarSimbolo: (symbol: string, config: Partial<ConfigAgente>) => void
}

function badgePosicion(symbol: string, estado: EstadoAgente): { label: string; color: string; bg: string } {
  const cfg = estado.configuracion[symbol]
  if (!cfg?.activo) return { label: 'INACTIVO', color: '#2c4268', bg: '#111e35' }
  if (estado.posicionesAbiertas[symbol]) return { label: 'EN_POSICIÓN', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' }
  return { label: 'VIGILANDO', color: '#00d060', bg: 'rgba(0,208,96,0.08)' }
}

export default function AgentPanel({ estado, activar, pausar, configurarSimbolo }: AgentPanelProps) {
  const logVisible = estado.log.slice(0, 10)

  const formatTs = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
    catch { return iso }
  }

  const formatPrice = (price: number) =>
    price >= 1 ? price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : price.toFixed(6)

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#060d1a', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '12px',
            background: estado.activo ? 'rgba(0,208,96,0.12)' : '#0b1424',
            border: `1px solid ${estado.activo ? 'rgba(0,208,96,0.3)' : '#111e35'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative'
          }}>
            <Bot size={20} color={estado.activo ? '#00d060' : '#2c4268'} strokeWidth={1.75} />
            {estado.activo && (
              <span style={{
                position: 'absolute', top: '6px', right: '6px',
                width: '8px', height: '8px', borderRadius: '50%', background: '#00d060',
                boxShadow: '0 0 0 3px rgba(0,208,96,0.2)',
                animation: 'pulse 1.5s infinite'
              }} />
            )}
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#c8d8ec', letterSpacing: '-0.3px' }}>
              Agente Autónomo
            </div>
            <div style={{ fontSize: '11px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', marginTop: '1px' }}>
              {estado.activo ? 'OPERANDO' : 'PAUSADO'}
            </div>
          </div>
        </div>

        {/* Toggle global ON/OFF */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={estado.activo ? pausar : activar}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: '8px',
              background: estado.activo ? 'rgba(0,208,96,0.12)' : '#0b1424',
              color: estado.activo ? '#00d060' : '#486080',
              fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
              border: `1px solid ${estado.activo ? 'rgba(0,208,96,0.25)' : '#1a2840'}`,
              transition: 'all 0.2s'
            }}
          >
            <Power size={13} strokeWidth={2} />
            {estado.activo ? 'ACTIVO' : 'INACTIVO'}
          </button>
        </div>
      </div>

      {/* ── Stats del día ───────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div style={cardStyle}>
          <div style={cardLabelStyle}>Operaciones hoy</div>
          <div style={{ fontSize: '26px', fontWeight: 700, letterSpacing: '-0.5px', color: '#c8d8ec' }}>
            {estado.statsHoy.operaciones}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={cardLabelStyle}>P&L del bot</div>
          <div style={{
            fontSize: '26px', fontWeight: 700, letterSpacing: '-0.5px',
            color: estado.statsHoy.pnlBot >= 0 ? '#00d060' : '#ff3b3b'
          }}>
            {estado.statsHoy.pnlBot >= 0 ? '+' : ''}{estado.statsHoy.pnlBot.toFixed(2)}$
          </div>
        </div>
      </div>

      {/* ── Parada de emergencia ─────────────────────────────────────────── */}
      <button
        onClick={pausar}
        style={{
          width: '100%', padding: '12px', borderRadius: '10px',
          background: 'rgba(255,59,59,0.07)',
          border: '1px solid rgba(255,59,59,0.2)',
          color: '#ff3b3b', fontSize: '12px', fontWeight: 700,
          cursor: 'pointer', fontFamily: 'Inter, sans-serif',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          letterSpacing: '0.5px', transition: 'background 0.2s'
        }}
      >
        <AlertTriangle size={14} strokeWidth={2} />
        PARADA DE EMERGENCIA
      </button>

      {/* ── Configuración por símbolo ────────────────────────────────────── */}
      <div>
        <div style={sectionTitleStyle}>Símbolos monitorizados</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
          {MAIN_COINS.map(symbol => {
            const cfg: ConfigAgente = estado.configuracion[symbol] ?? { activo: false, cantidadMaxima: 100, umbralConfianza: 75 }
            const badge = badgePosicion(symbol, estado)
            const ticker = symbol.replace('USDT', '')

            return (
              <div key={symbol} style={{
                background: '#07101e', border: `1px solid ${cfg.activo ? '#1a2840' : '#0e0e0e'}`,
                borderRadius: '12px', padding: '14px 16px'
              }}>
                {/* Fila cabecera */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: cfg.activo ? '12px' : '0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {/* Toggle activo */}
                    <div
                      onClick={() => configurarSimbolo(symbol, { activo: !cfg.activo })}
                      style={{
                        width: '36px', height: '20px', borderRadius: '10px', cursor: 'pointer',
                        background: cfg.activo ? '#00d060' : '#1a2840',
                        position: 'relative', transition: 'background 0.2s', flexShrink: 0
                      }}
                    >
                      <div style={{
                        position: 'absolute', top: '3px',
                        left: cfg.activo ? '18px' : '3px',
                        width: '14px', height: '14px', borderRadius: '50%',
                        background: '#fff', transition: 'left 0.2s'
                      }} />
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: cfg.activo ? '#c8d8ec' : '#2c4268', letterSpacing: '0.2px' }}>
                      {ticker}
                    </span>
                  </div>
                  <span style={{
                    fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.8px',
                    padding: '3px 8px', borderRadius: '5px',
                    color: badge.color, background: badge.bg,
                    border: `1px solid ${badge.color}22`
                  }}>
                    {badge.label}
                  </span>
                </div>

                {/* Inputs: solo visibles cuando activo */}
                {cfg.activo && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <div style={inputLabelStyle}>Cantidad max. (USDT)</div>
                      <input
                        type="number" min="1" step="10"
                        value={cfg.cantidadMaxima}
                        onChange={e => configurarSimbolo(symbol, { cantidadMaxima: Math.max(1, parseFloat(e.target.value) || 1) })}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <div style={inputLabelStyle}>Umbral confianza ({cfg.umbralConfianza}%)</div>
                      <input
                        type="range" min="60" max="95" step="1"
                        value={cfg.umbralConfianza}
                        onChange={e => configurarSimbolo(symbol, { umbralConfianza: parseInt(e.target.value, 10) })}
                        style={{ width: '100%', accentColor: '#00d060', marginTop: '6px' }}
                      />
                    </div>
                  </div>
                )}

                {/* Posición abierta info */}
                {cfg.activo && estado.posicionesAbiertas[symbol] && (
                  <div style={{
                    marginTop: '10px', padding: '8px 10px', borderRadius: '8px',
                    background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)'
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                      {[
                        { label: 'Entrada', val: `$${formatPrice(estado.posicionesAbiertas[symbol].precio)}` },
                        { label: 'Stop', val: `$${formatPrice(estado.posicionesAbiertas[symbol].stopLoss)}` },
                        { label: 'Target', val: `$${formatPrice(estado.posicionesAbiertas[symbol].targetPrice)}` },
                      ].map(({ label, val }) => (
                        <div key={label}>
                          <div style={{ fontSize: '9px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', marginBottom: '2px' }}>{label}</div>
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#c8d8ec', fontFamily: 'JetBrains Mono, monospace' }}>{val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Log en tiempo real ───────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <Activity size={14} color="#2c4268" strokeWidth={1.75} />
          <span style={sectionTitleStyle}>Log en tiempo real</span>
        </div>
        <div style={{ background: '#07101e', border: '1px solid #0e0e0e', borderRadius: '12px', overflow: 'hidden' }}>
          {logVisible.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace' }}>
              Sin actividad aún. Activa el agente y configura símbolos.
            </div>
          ) : logVisible.map((entry, i) => {
            const esBuy = entry.accion === 'COMPRAR'
            const esSell = entry.accion === 'VENDER'
            return (
              <div key={i} style={{
                padding: '10px 14px',
                borderBottom: i < logVisible.length - 1 ? '1px solid #0a0a0a' : 'none',
                display: 'flex', alignItems: 'flex-start', gap: '10px'
              }}>
                <span style={{
                  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.5px',
                  padding: '2px 7px', borderRadius: '4px', flexShrink: 0, marginTop: '1px',
                  color: esBuy ? '#00d060' : esSell ? '#ff3b3b' : '#f59e0b',
                  background: esBuy ? 'rgba(0,208,96,0.08)' : esSell ? 'rgba(255,59,59,0.08)' : 'rgba(245,158,11,0.08)',
                  border: `1px solid ${esBuy ? 'rgba(0,208,96,0.15)' : esSell ? 'rgba(255,59,59,0.15)' : 'rgba(245,158,11,0.15)'}`
                }}>
                  {entry.accion}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#7890b0', marginBottom: '2px' }}>
                    {entry.symbol} <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#2c4268', fontWeight: 400 }}>· ${formatPrice(entry.precio)}</span>
                  </div>
                  <div style={{ fontSize: '10px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.motivo}
                  </div>
                </div>
                <span style={{ fontSize: '9px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0, marginTop: '2px' }}>
                  {formatTs(entry.timestamp)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── CSS para animación pulsante ──────────────────────────────────── */}
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(0,208,96,0.2); }
          50% { box-shadow: 0 0 0 6px rgba(0,208,96,0.05); }
        }
      `}</style>
    </div>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#07101e', border: '1px solid #0e0e0e', borderRadius: '12px', padding: '16px'
}
const cardLabelStyle: React.CSSProperties = {
  fontSize: '10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace',
  letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '6px'
}
const sectionTitleStyle: React.CSSProperties = {
  fontSize: '11px', fontWeight: 600, color: '#2c4268', letterSpacing: '0.3px'
}
const inputLabelStyle: React.CSSProperties = {
  fontSize: '9px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace', marginBottom: '4px'
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0b1424', border: '1px solid #1a1a1a',
  color: '#c8d8ec', padding: '7px 10px', borderRadius: '7px',
  fontSize: '11px', fontFamily: 'Inter, sans-serif', outline: 'none',
  boxSizing: 'border-box'
}
