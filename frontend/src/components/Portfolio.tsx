import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle } from 'lucide-react'
import { apiClient } from '../api'

interface PortfolioStats {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  positions: Position[]
}

interface Position {
  symbol: string
  coin: string
  quantity: number
  avgBuyPrice: number
  currentPrice: number
  pct: number
  value: number
}

interface PortfolioProps {
  user: any
  refreshTrigger?: number
}

export default function Portfolio({ user, refreshTrigger = 0 }: PortfolioProps) {
  const [stats, setStats]     = useState<PortfolioStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const fetchStats = async () => {
    const token = localStorage.getItem('token')
    if (!token) { setError('No autenticado'); setLoading(false); return }

    setLoading(true)
    setError('')
    try {
      const res = await apiClient.get('/portfolio/stats')
      setStats(res.data)
      setLastUpdate(new Date())
    } catch (e: any) {
      if (e.response?.status === 401) {
        setError('Sesión expirada. Vuelve a iniciar sesión.')
      } else if (e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED') {
        setError('Sin conexión con el servidor. Verifica que market-service está activo.')
      } else {
        setError('Error al cargar el portfolio.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Carga inicial y refresco cuando se ejecuta un trade
  useEffect(() => { fetchStats() }, [refreshTrigger])

  const balance = user.balance || 12500.50
  const totalValue = stats?.positions?.reduce((acc, p) => acc + p.value, 0) ?? 0

  return (
    <div style={wrapStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <p style={sectionLabel}>Resumen</p>
        <button onClick={fetchStats} disabled={loading} style={refreshBtnStyle} title="Actualizar">
          <RefreshCw size={12} color={loading ? '#1a2840' : '#2c4268'} strokeWidth={1.75} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {lastUpdate && (
            <span style={{ fontSize: '9px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace', marginLeft: '6px' }}>
              {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div style={errorBoxStyle}>
          <AlertCircle size={13} color="#ff3b3b" strokeWidth={1.75} />
          <span style={{ fontSize: '11px', color: '#ff3b3b', marginLeft: '8px' }}>{error}</span>
        </div>
      )}

      <div style={statsGridStyle}>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>Patrimonio total</div>
          <div style={statValueStyle}>${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          {totalValue > 0 && (
            <div style={{ fontSize: '11px', color: '#486080', marginTop: '4px', fontFamily: 'JetBrains Mono, monospace' }}>
              +${totalValue.toFixed(2)} en posiciones
            </div>
          )}
        </div>

        <div style={statCardStyle}>
          <div style={statLabelStyle}>P&L total</div>
          {loading ? (
            <div style={{ ...statValueStyle, color: '#1e3050' }}>—</div>
          ) : (
            <div style={{ ...statValueStyle, color: stats && stats.totalPnl >= 0 ? '#00d060' : '#ff3b3b' }}>
              {stats ? `${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}` : '—'}
            </div>
          )}
          <div style={{ fontSize: '11px', color: '#2c4268', marginTop: '4px', fontFamily: 'JetBrains Mono, monospace' }}>
            {stats ? `${stats.totalTrades} operaciones` : 'Cargando...'}
          </div>
        </div>

        <div style={statCardStyle}>
          <div style={statLabelStyle}>Win rate</div>
          {loading ? (
            <div style={{ ...statValueStyle, color: '#1e3050' }}>—</div>
          ) : (
            <div style={statValueStyle}>{stats ? `${stats.winRate}%` : '—'}</div>
          )}
          <div style={{ fontSize: '11px', color: '#2c4268', marginTop: '4px', fontFamily: 'JetBrains Mono, monospace' }}>
            {stats ? `${stats.wins} / ${stats.wins + stats.losses} ganadoras` : 'Sin trades aún'}
          </div>
        </div>
      </div>

      <p style={{ ...sectionLabel, marginTop: '28px', marginBottom: '12px' }}>Posiciones abiertas</p>

      {loading ? (
        <div style={emptyStyle}>Cargando posiciones...</div>
      ) : !stats?.positions?.length ? (
        <div style={emptyStyle}>
          Sin posiciones abiertas. Ejecuta tu primera orden desde el terminal de trading.
        </div>
      ) : (
        <div style={tableStyle}>
          {stats.positions.map((pos, i) => (
            <div
              key={pos.symbol}
              style={{ ...tableRowStyle, borderBottom: i < stats.positions.length - 1 ? '1px solid #0e0e0e' : 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={coinDotStyle}>{pos.coin.slice(0, 1)}</div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{pos.coin}</div>
                  <div style={{ fontSize: '10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', marginTop: '2px' }}>
                    {pos.quantity.toLocaleString(undefined, { maximumSignificantDigits: 6 })} {pos.coin}
                  </div>
                  <div style={{ fontSize: '9px', color: '#1c2c44', fontFamily: 'JetBrains Mono, monospace', marginTop: '1px' }}>
                    Entrada: ${pos.avgBuyPrice.toLocaleString()}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', marginBottom: '4px' }}>
                  ${pos.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                  {pos.pct >= 0
                    ? <TrendingUp size={12} color="#00d060" strokeWidth={2} />
                    : <TrendingDown size={12} color="#ff3b3b" strokeWidth={2} />}
                  <span style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: pos.pct >= 0 ? '#00d060' : '#ff3b3b' }}>
                    {pos.pct >= 0 ? '+' : ''}{pos.pct}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const wrapStyle: React.CSSProperties = {
  padding: '32px 36px', background: '#060d1a', height: '100%',
  overflowY: 'auto', fontFamily: 'Inter, sans-serif', color: '#fff'
}
const sectionLabel: React.CSSProperties = {
  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#1e3050',
  letterSpacing: '2px', textTransform: 'uppercase', margin: 0
}
const statsGridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px'
}
const statCardStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', borderRadius: '14px', padding: '18px 20px'
}
const statLabelStyle: React.CSSProperties = {
  fontSize: '10px', color: '#2c4268', textTransform: 'uppercase',
  letterSpacing: '0.5px', marginBottom: '10px', fontWeight: 500
}
const statValueStyle: React.CSSProperties = {
  fontSize: '24px', fontWeight: 700, letterSpacing: '-1px'
}
const tableStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', borderRadius: '14px', overflow: 'hidden'
}
const tableRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px'
}
const coinDotStyle: React.CSSProperties = {
  width: '34px', height: '34px', borderRadius: '50%', background: '#111e35',
  border: '1px solid #1a1a1a', display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontSize: '11px', fontWeight: 600, color: '#486080'
}
const emptyStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', borderRadius: '14px',
  padding: '28px 24px', fontSize: '11px', color: '#2c4268',
  fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', lineHeight: 1.6
}
const errorBoxStyle: React.CSSProperties = {
  background: 'rgba(255,59,59,0.05)', border: '1px solid rgba(255,59,59,0.15)',
  borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', display: 'flex', alignItems: 'center'
}
const refreshBtnStyle: React.CSSProperties = {
  background: '#0b1424', border: '1px solid #111e35', borderRadius: '8px',
  padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center'
}
