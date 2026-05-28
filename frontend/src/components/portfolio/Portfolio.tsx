import { useState, useEffect, useMemo } from 'react'
import { TrendingUp, TrendingDown, RefreshCw, AlertCircle, Download } from 'lucide-react'
import { apiClient } from '../../api'
import WalletPanel from './WalletPanel'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PortfolioStats {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  positions: Position[]
  mejorTrade?: number
  peorTrade?: number
  rachaGanadora?: number
  diasActivo?: number
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

interface EquityPoint {
  fecha: string
  valor: number
}

interface PortfolioProps {
  user: any
  refreshTrigger?: number
  marketData?: Record<string, any>
}

type Tab = 'Resumen' | 'Posiciones' | 'Estadísticas' | 'Historial'

// ─── Component ───────────────────────────────────────────────────────────────

export default function Portfolio({ user, refreshTrigger = 0, marketData = {} }: PortfolioProps) {
  const [activeTab, setActiveTab]     = useState<Tab>('Resumen')
  const [stats, setStats]             = useState<PortfolioStats | null>(null)
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const [lastUpdate, setLastUpdate]   = useState<Date | null>(null)
  const [saldoCartera, setSaldoCartera] = useState<number | null>(null)
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null)

  const fetchStats = async () => {
    const token = localStorage.getItem('token')
    if (!token) { setError('No autenticado'); setLoading(false); return }

    setLoading(true)
    setError('')
    try {
      const [statsRes, equityRes] = await Promise.all([
        apiClient.get('/portfolio/stats'),
        apiClient.get('/portfolio/equity-curve').catch(() => ({ data: [] }))
      ])
      setStats(statsRes.data)
      setEquityCurve(equityRes.data || [])
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

  useEffect(() => { fetchStats() }, [refreshTrigger])

  // Recalcular posiciones con precios en tiempo real desde marketData
  const posicionesEnTiempoReal = useMemo(() => {
    if (!stats?.positions?.length) return []
    return stats.positions
      .map(pos => {
        const tick = marketData[pos.symbol]
        const precioActual = tick?.price ?? pos.currentPrice
        const pnlDolar = (precioActual - pos.avgBuyPrice) * pos.quantity
        const pnlPct = pos.avgBuyPrice > 0
          ? ((precioActual - pos.avgBuyPrice) / pos.avgBuyPrice) * 100 : 0
        const valorTotal = precioActual * pos.quantity
        return {
          ...pos,
          currentPrice: precioActual,
          pnlDolar: Math.round(pnlDolar * 100) / 100,
          pct: Math.round(pnlPct * 100) / 100,
          value: Math.round(valorTotal * 100) / 100
        }
      })
      .sort((a, b) => b.value - a.value)
  }, [stats?.positions, marketData])

  const handleCerrarPosicion = async (pos: typeof posicionesEnTiempoReal[0]) => {
    setClosingSymbol(pos.symbol)
    try {
      await apiClient.post('/portfolio/execute', {
        symbol:     pos.symbol,
        type:       'SELL',
        size:       pos.quantity,
        price:      pos.currentPrice,
        signal:     'MANUAL_CLOSE',
        confidence: '1.0'
      })
      await fetchStats()
    } catch (e: any) {
      setError('Error al cerrar posición: ' + (e.response?.data?.error || e.message))
    } finally {
      setClosingSymbol(null)
    }
  }

  const handleExportarCSV = async () => {
    try {
      const res = await apiClient.get('/portfolio/trades?limit=200')
      const trades: any[] = res.data
      if (!trades.length) return

      const headers = ['ID', 'Symbol', 'Side', 'Quantity', 'EntryPrice', 'Total', 'Signal', 'Confidence', 'Timestamp']
      const rows = trades.map(t => [
        t.id, t.symbol, t.side,
        t.quantity, t.entryPrice, t.total,
        t.signal || '', t.confidence || '', t.timestamp
      ])
      const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `trades_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError('Error al exportar: ' + (e.response?.data?.error || e.message))
    }
  }

  // Comparativa BTC
  const btcComparativa = useMemo(() => {
    const hist = marketData['BTCUSDT']?.history
    if (!hist || hist.length < 2) return null
    const inicio = hist[0]
    const fin    = hist[hist.length - 1]
    if (!inicio || !fin || inicio === 0) return null
    const pct = ((fin - inicio) / inicio) * 100
    return Math.round(pct * 100) / 100
  }, [marketData])

  const portfolioVariacion = useMemo(() => {
    if (equityCurve.length < 2) return null
    const inicio = equityCurve[0].valor
    const fin    = equityCurve[equityCurve.length - 1].valor
    if (!inicio) return null
    const pct = ((fin - inicio) / inicio) * 100
    return Math.round(pct * 100) / 100
  }, [equityCurve])

  const totalValue = posicionesEnTiempoReal.reduce((acc, p) => acc + p.value, 0)
  const balance = saldoCartera !== null ? saldoCartera : (user.balance || 0)

  return (
    <div style={wrapStyle}>
      <WalletPanel onSaldoActualizado={setSaldoCartera} />

      {/* Header con tabs y botón refresh */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['Resumen', 'Posiciones', 'Estadísticas', 'Historial'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                ...tabBtnStyle,
                background:  activeTab === tab ? '#111e35' : 'transparent',
                color:       activeTab === tab ? '#c8d8ec' : '#2c4268',
                borderColor: activeTab === tab ? '#1a2f50' : 'transparent'
              }}
            >
              {tab}
            </button>
          ))}
        </div>
        <button onClick={fetchStats} disabled={loading} style={refreshBtnStyle} title="Actualizar">
          <RefreshCw size={12} color={loading ? '#1a2840' : '#2c4268'} strokeWidth={1.75}
            style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
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

      {loading && !stats && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: '72px', background: '#091220', border: '1px solid #111e35', borderRadius: '12px', animation: 'pulse 1.4s ease-in-out infinite', opacity: 0.7 }} />
          ))}
          <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.8} } @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
        </div>
      )}

      {/* ── TAB: Resumen ── */}
      {activeTab === 'Resumen' && (
        <>
          <div style={{ ...statsGridStyle, opacity: loading && stats ? 0.5 : 1, transition: 'opacity 0.2s' }}>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>Saldo disponible</div>
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

          <DonutChart positions={posicionesEnTiempoReal} balance={balance} />

          <p style={{ ...sectionLabel, marginTop: '16px', marginBottom: '12px' }}>Posiciones abiertas</p>
          <PositionsTable
            positions={posicionesEnTiempoReal}
            loading={loading}
            stats={stats}
            closingSymbol={closingSymbol}
            onCerrar={handleCerrarPosicion}
            compact
          />
        </>
      )}

      {/* ── TAB: Posiciones ── */}
      {activeTab === 'Posiciones' && (
        <>
          <p style={{ ...sectionLabel, marginBottom: '12px' }}>Posiciones abiertas en tiempo real</p>
          <PositionsTable
            positions={posicionesEnTiempoReal}
            loading={loading}
            stats={stats}
            closingSymbol={closingSymbol}
            onCerrar={handleCerrarPosicion}
            compact={false}
          />
        </>
      )}

      {/* ── TAB: Estadísticas ── */}
      {activeTab === 'Estadísticas' && (
        <TabEstadisticas
          stats={stats}
          equityCurve={equityCurve}
          btcComparativa={btcComparativa}
          portfolioVariacion={portfolioVariacion}
          loading={loading}
          onExportarCSV={handleExportarCSV}
        />
      )}

      {/* ── TAB: Historial ── */}
      {activeTab === 'Historial' && <TabHistorial />}
    </div>
  )
}

// ─── Tab Historial ────────────────────────────────────────────────────────────

interface TradeRecord {
  symbol:    string
  side:      'BUY' | 'SELL'
  quantity:  number
  price:     number
  total:     number
  timestamp: string
  pnl?:      number
}

const PAGE_SIZE = 25

function TabHistorial() {
  const [trades, setTrades]     = useState<TradeRecord[]>([])
  const [loading, setLoading]   = useState(true)
  const [filterSym, setFilterSym] = useState('ALL')
  const [filterSide, setFilterSide] = useState<'ALL' | 'BUY' | 'SELL'>('ALL')
  const [page, setPage]         = useState(0)

  useEffect(() => {
    apiClient.get('/portfolio/trades?limit=200')
      .then(res => setTrades(res.data ?? []))
      .catch(() => setTrades([]))
      .finally(() => setLoading(false))
  }, [])

  const symbols = ['ALL', ...Array.from(new Set(trades.map(t => t.symbol.replace('USDT',''))))]

  const filtered = trades.filter(t => {
    const sym = t.symbol.replace('USDT','')
    if (filterSym  !== 'ALL' && sym !== filterSym)          return false
    if (filterSide !== 'ALL' && t.side !== filterSide)      return false
    return true
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const page_trades = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handleExport = () => {
    const header = 'Fecha,Símbolo,Lado,Cantidad,Precio,Total\n'
    const rows = filtered.map(t =>
      `${t.timestamp},${t.symbol},${t.side},${t.quantity},${t.price},${t.total}`
    ).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([header + rows], { type: 'text/csv' }))
    a.download = `historial_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  if (loading) return <div style={emptyStyle}>Cargando historial…</div>
  if (!trades.length) return <div style={emptyStyle}>Sin trades registrados todavía.</div>

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={filterSym}
          onChange={e => { setFilterSym(e.target.value); setPage(0) }}
          style={filterSelectStyle}
        >
          {symbols.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(['ALL','BUY','SELL'] as const).map(s => (
          <button
            key={s}
            onClick={() => { setFilterSide(s); setPage(0) }}
            style={{
              ...filterBtnStyle,
              background:   filterSide === s ? '#111e35' : 'transparent',
              color:        filterSide === s ? (s === 'BUY' ? '#2ebd85' : s === 'SELL' ? '#f6465d' : '#c8d8ec') : '#2c4268',
              borderColor:  filterSide === s ? '#1a2f50' : 'transparent',
            }}
          >
            {s === 'ALL' ? 'Todos' : s}
          </button>
        ))}
        <button onClick={handleExport} style={{ ...filterBtnStyle, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Download size={11} strokeWidth={2} />CSV
        </button>
        <span style={{ fontSize: 10, color: '#1e3050', fontFamily: 'JetBrains Mono, monospace' }}>
          {filtered.length} operaciones
        </span>
      </div>

      {/* Table */}
      <div style={{ background: '#091220', border: '1px solid #111e35', borderRadius: 12, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px 100px', padding: '8px 16px', borderBottom: '1px solid #111e35' }}>
          {['FECHA', 'LADO', 'PRECIO', 'CANTIDAD', 'TOTAL'].map(h => (
            <div key={h} style={{ fontSize: 9, color: '#1e3050', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.8px', textAlign: h !== 'FECHA' ? 'right' : 'left' }}>{h}</div>
          ))}
        </div>
        {/* Rows */}
        {page_trades.map((t, i) => {
          const isBuy = t.side === 'BUY'
          const sym   = t.symbol.replace('USDT','')
          const date  = new Date(t.timestamp)
          const dateStr = `${date.toLocaleDateString('es', { day:'2-digit', month:'2-digit' })} ${date.toLocaleTimeString('es', { hour:'2-digit', minute:'2-digit' })}`
          return (
            <div
              key={i}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px 100px',
                padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.03)',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#ddeeff' }}>{sym}</div>
                <div style={{ fontSize: 9, color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>{dateStr}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                  color: isBuy ? '#2ebd85' : '#f6465d',
                  background: isBuy ? 'rgba(46,189,133,0.1)' : 'rgba(246,70,93,0.1)',
                  border: `1px solid ${isBuy ? 'rgba(46,189,133,0.25)' : 'rgba(246,70,93,0.25)'}`,
                  padding: '2px 6px', borderRadius: 4,
                }}>
                  {t.side}
                </span>
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#8baabf' }}>
                ${t.price >= 1000 ? t.price.toLocaleString('en', { maximumFractionDigits: 2 }) : t.price.toFixed(4)}
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#3d5470' }}>
                {t.quantity.toFixed(6)}
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color: isBuy ? '#2ebd85' : '#f6465d' }}>
                ${t.total.toFixed(2)}
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={paginBtnStyle}>‹ Anterior</button>
          <span style={{ fontSize: 10, color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>
            {page + 1} / {totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={paginBtnStyle}>Siguiente ›</button>
        </div>
      )}
    </div>
  )
}

const filterSelectStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', color: '#8baabf',
  padding: '5px 10px', borderRadius: 8, fontSize: 11,
  fontFamily: 'Inter, sans-serif', cursor: 'pointer', outline: 'none',
}
const filterBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid transparent', color: '#2c4268',
  padding: '5px 12px', borderRadius: 8, fontSize: 11,
  fontFamily: 'Inter, sans-serif', cursor: 'pointer',
}
const paginBtnStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', color: '#2c4268',
  padding: '5px 14px', borderRadius: 8, fontSize: 11,
  fontFamily: 'Inter, sans-serif', cursor: 'pointer',
}

// ─── Donut Chart ─────────────────────────────────────────────────────────────

const DONUT_COLORS = ['#818cf8','#2ebd85','#f6465d','#fb923c','#38bdf8','#a78bfa','#34d399','#f472b6']

function DonutChart({ positions, balance }: {
  positions: Array<{ symbol: string; coin: string; value: number }>
  balance: number
}) {
  const total = positions.reduce((s, p) => s + p.value, 0) + balance
  if (total <= 0 || positions.length === 0) return null

  const size   = 140
  const stroke = 18
  const r      = (size - stroke) / 2
  const cx     = size / 2
  const cy     = size / 2
  const circum = 2 * Math.PI * r

  const slices: Array<{ symbol: string; coin: string; value: number; pct: number; color: string }> = []
  if (balance > 0) {
    slices.push({ symbol: 'USDT', coin: 'USD', value: balance, pct: balance / total, color: '#2c4268' })
  }
  positions.forEach((p, i) => {
    slices.push({ ...p, pct: p.value / total, color: DONUT_COLORS[i % DONUT_COLORS.length] })
  })

  let offset = 0
  const paths = slices.map(s => {
    const dash    = s.pct * circum
    const current = offset
    offset += dash
    return { ...s, dash, gap: circum - dash, current }
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '20px 0 8px' }}>
      {/* SVG donut */}
      <div style={{ flexShrink: 0, position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {/* Background ring */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0d1a2e" strokeWidth={stroke} />
          {paths.map((s, i) => (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${s.dash} ${s.gap}`}
              strokeDashoffset={-s.current}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        {/* Center label */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 9, color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', marginBottom: 2 }}>TOTAL</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#ddeeff', fontFamily: 'JetBrains Mono, monospace' }}>
            ${total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {paths.map(s => (
          <div key={s.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#8baabf', flex: 1 }}>{s.coin}</span>
            <span style={{ fontSize: 10, color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>
              {(s.pct * 100).toFixed(1)}%
            </span>
            <span style={{ fontSize: 10, color: '#3d5470', fontFamily: 'JetBrains Mono, monospace', width: 60, textAlign: 'right' }}>
              ${s.value >= 1000 ? (s.value / 1000).toFixed(1) + 'k' : s.value.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tabla de Posiciones ──────────────────────────────────────────────────────

interface PositionsTableProps {
  positions: Array<{
    symbol: string; coin: string; quantity: number; avgBuyPrice: number;
    currentPrice: number; pnlDolar: number; pct: number; value: number
  }>
  loading: boolean
  stats: PortfolioStats | null
  closingSymbol: string | null
  onCerrar: (pos: any) => void
  compact: boolean
}

function PositionsTable({ positions, loading, stats, closingSymbol, onCerrar, compact }: PositionsTableProps) {
  if (loading && !stats) return <div style={emptyStyle}>Cargando posiciones...</div>
  if (!positions.length) return (
    <div style={emptyStyle}>
      Sin posiciones abiertas. Ejecuta tu primera orden desde el terminal de trading.
    </div>
  )

  return (
    <div style={tableStyle}>
      {!compact && (
        <div style={{ ...tableRowStyle, background: '#071019', borderBottom: '1px solid #111e35', fontSize: '9px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1px', textTransform: 'uppercase' }}>
          <span style={{ flex: 2 }}>Activo</span>
          <span style={{ flex: 1, textAlign: 'right' }}>Precio entrada</span>
          <span style={{ flex: 1, textAlign: 'right' }}>Precio actual</span>
          <span style={{ flex: 1, textAlign: 'right' }}>P&L $</span>
          <span style={{ flex: 1, textAlign: 'right' }}>P&L %</span>
          <span style={{ flex: 1, textAlign: 'right' }}>Valor total</span>
          <span style={{ flex: 1, textAlign: 'right' }}>Acción</span>
        </div>
      )}
      {positions.map((pos, i) => {
        const ganando = pos.pnlDolar >= 0
        const rowBg   = ganando ? 'rgba(0,208,96,0.03)' : 'rgba(255,59,59,0.03)'
        return (
          <div
            key={pos.symbol}
            style={{
              ...tableRowStyle,
              background: rowBg,
              borderBottom: i < positions.length - 1 ? '1px solid #0e0e0e' : 'none',
              flexWrap: 'wrap',
              gap: '8px'
            }}
          >
            <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: '10px', minWidth: '120px' }}>
              <div style={coinDotStyle}>{pos.coin.slice(0, 1)}</div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>{pos.coin}</div>
                <div style={{ fontSize: '10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', marginTop: '2px' }}>
                  {pos.quantity.toLocaleString(undefined, { maximumSignificantDigits: 6 })} {pos.coin}
                </div>
              </div>
            </div>
            {!compact ? (
              <>
                <div style={{ flex: 1, textAlign: 'right', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: '#486080' }}>
                  ${pos.avgBuyPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div style={{ flex: 1, textAlign: 'right', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }}>
                  ${pos.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div style={{ flex: 1, textAlign: 'right', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: ganando ? '#00d060' : '#ff3b3b', fontWeight: 600 }}>
                  {ganando ? '+' : ''}${pos.pnlDolar.toFixed(2)}
                </div>
                <div style={{ flex: 1, textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                  {ganando ? <TrendingUp size={10} color="#00d060" /> : <TrendingDown size={10} color="#ff3b3b" />}
                  <span style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: ganando ? '#00d060' : '#ff3b3b' }}>
                    {pos.pct >= 0 ? '+' : ''}{pos.pct}%
                  </span>
                </div>
                <div style={{ flex: 1, textAlign: 'right', fontSize: '12px', fontFamily: 'JetBrains Mono, monospace' }}>
                  ${pos.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <button
                    onClick={() => onCerrar(pos)}
                    disabled={closingSymbol === pos.symbol}
                    style={closeBtnStyle}
                  >
                    {closingSymbol === pos.symbol ? '...' : 'Cerrar'}
                  </button>
                </div>
              </>
            ) : (
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
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Tab Estadísticas ─────────────────────────────────────────────────────────

interface TabEstadisticasProps {
  stats: PortfolioStats | null
  equityCurve: EquityPoint[]
  btcComparativa: number | null
  portfolioVariacion: number | null
  loading: boolean
  onExportarCSV: () => void
}

function TabEstadisticas({ stats, equityCurve, btcComparativa, portfolioVariacion, loading, onExportarCSV }: TabEstadisticasProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Métricas */}
      <div>
        <p style={{ ...sectionLabel, marginBottom: '12px' }}>Métricas avanzadas</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
          <MetricCard label="Mejor trade" value={loading ? '—' : stats ? `+$${stats.mejorTrade?.toFixed(2) ?? '0.00'}` : '—'} color="#00d060" />
          <MetricCard label="Peor trade"  value={loading ? '—' : stats ? `$${stats.peorTrade?.toFixed(2) ?? '0.00'}` : '—'}  color="#ff3b3b" />
          <MetricCard label="Racha ganadora" value={loading ? '—' : stats ? `${stats.rachaGanadora ?? 0}` : '—'} color="#c8d8ec" />
          <MetricCard label="Días activo" value={loading ? '—' : stats ? `${stats.diasActivo ?? 0}` : '—'} color="#c8d8ec" />
        </div>
      </div>

      {/* Comparativa BTC */}
      {(portfolioVariacion !== null || btcComparativa !== null) && (
        <div style={{ background: '#091220', border: '1px solid #111e35', borderRadius: '14px', padding: '16px 20px' }}>
          <p style={{ ...sectionLabel, marginBottom: '12px' }}>Comparativa vs BTC</p>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {portfolioVariacion !== null && (
              <div>
                <div style={{ fontSize: '10px', color: '#2c4268', marginBottom: '4px', fontFamily: 'JetBrains Mono, monospace' }}>Tu portfolio</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: portfolioVariacion >= 0 ? '#00d060' : '#ff3b3b' }}>
                  {portfolioVariacion >= 0 ? '+' : ''}{portfolioVariacion}%
                </div>
              </div>
            )}
            {btcComparativa !== null && (
              <div>
                <div style={{ fontSize: '10px', color: '#2c4268', marginBottom: '4px', fontFamily: 'JetBrains Mono, monospace' }}>BTC (en sesión)</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: btcComparativa >= 0 ? '#00d060' : '#ff3b3b' }}>
                  {btcComparativa >= 0 ? '+' : ''}{btcComparativa}%
                </div>
              </div>
            )}
            {portfolioVariacion !== null && btcComparativa !== null && (
              <div style={{ borderLeft: '1px solid #111e35', paddingLeft: '24px' }}>
                <div style={{ fontSize: '10px', color: '#2c4268', marginBottom: '4px', fontFamily: 'JetBrains Mono, monospace' }}>Diferencia</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: (portfolioVariacion - btcComparativa) >= 0 ? '#00d060' : '#ff3b3b' }}>
                  {(portfolioVariacion - btcComparativa) >= 0 ? '+' : ''}{Math.round((portfolioVariacion - btcComparativa) * 100) / 100}%
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Curva de equity SVG */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <p style={sectionLabel}>Curva de equity</p>
          <button onClick={onExportarCSV} style={exportBtnStyle}>
            <Download size={11} color="#2c4268" strokeWidth={1.75} />
            <span style={{ fontSize: '10px', color: '#2c4268', marginLeft: '5px', fontFamily: 'JetBrains Mono, monospace' }}>Exportar CSV</span>
          </button>
        </div>
        {equityCurve.length < 2 ? (
          <div style={emptyStyle}>Sin suficientes datos para mostrar la curva de equity.</div>
        ) : (
          <EquitySVGChart data={equityCurve} />
        )}
      </div>
    </div>
  )
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={statCardStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={{ ...statValueStyle, fontSize: '20px', color }}>{value}</div>
    </div>
  )
}

// ─── Equity SVG Chart ─────────────────────────────────────────────────────────

function EquitySVGChart({ data }: { data: EquityPoint[] }) {
  const W = 600
  const H = 160
  const PAD = { top: 12, right: 20, bottom: 32, left: 60 }

  const valores = data.map(d => d.valor)
  const minV = Math.min(...valores)
  const maxV = Math.max(...valores)
  const rangoV = maxV - minV || 1

  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * (W - PAD.left - PAD.right)
  const toY = (v: number) => PAD.top + ((maxV - v) / rangoV) * (H - PAD.top - PAD.bottom)

  const puntos = data.map((d, i) => `${toX(i)},${toY(d.valor)}`).join(' ')
  const areaPath = `M${toX(0)},${toY(data[0].valor)} ${data.map((d, i) => `L${toX(i)},${toY(d.valor)}`).join(' ')} L${toX(data.length - 1)},${H - PAD.bottom} L${toX(0)},${H - PAD.bottom} Z`

  const isUp = data[data.length - 1].valor >= data[0].valor
  const lineColor = isUp ? '#00d060' : '#ff3b3b'
  const areaColor = isUp ? 'rgba(0,208,96,0.08)' : 'rgba(255,59,59,0.08)'

  // Etiquetas eje X: mostrar hasta 5 fechas
  const xLabels: number[] = []
  const step = Math.max(1, Math.floor(data.length / 4))
  for (let i = 0; i < data.length; i += step) xLabels.push(i)
  if (xLabels[xLabels.length - 1] !== data.length - 1) xLabels.push(data.length - 1)

  // Etiquetas eje Y: 4 niveles
  const yLevels = [minV, minV + rangoV / 3, minV + (rangoV * 2) / 3, maxV]

  return (
    <div style={{ background: '#091220', border: '1px solid #111e35', borderRadius: '14px', padding: '16px', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Grid lines */}
        {yLevels.map((v, i) => (
          <line key={i} x1={PAD.left} x2={W - PAD.right} y1={toY(v)} y2={toY(v)}
            stroke="#0e1e32" strokeWidth={1} strokeDasharray="4,4" />
        ))}

        {/* Area fill */}
        <path d={areaPath} fill={areaColor} />

        {/* Line */}
        <polyline points={puntos} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinejoin="round" />

        {/* Dots */}
        {data.map((d, i) => (
          <circle key={i} cx={toX(i)} cy={toY(d.valor)} r={data.length > 20 ? 1.5 : 3}
            fill={lineColor} />
        ))}

        {/* Y axis labels */}
        {yLevels.map((v, i) => (
          <text key={i} x={PAD.left - 6} y={toY(v) + 4}
            textAnchor="end" fontSize={9} fill="#2c4268" fontFamily="JetBrains Mono, monospace">
            ${Math.round(v).toLocaleString()}
          </text>
        ))}

        {/* X axis labels */}
        {xLabels.map(i => (
          <text key={i} x={toX(i)} y={H - 6}
            textAnchor="middle" fontSize={9} fill="#2c4268" fontFamily="JetBrains Mono, monospace">
            {data[i].fecha.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px'
}
const coinDotStyle: React.CSSProperties = {
  width: '34px', height: '34px', borderRadius: '50%', background: '#111e35',
  border: '1px solid #1a1a1a', display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontSize: '11px', fontWeight: 600, color: '#486080',
  flexShrink: 0
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
const tabBtnStyle: React.CSSProperties = {
  fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', padding: '6px 14px',
  borderRadius: '8px', border: '1px solid transparent', cursor: 'pointer', transition: 'all 0.15s'
}
const closeBtnStyle: React.CSSProperties = {
  background: 'rgba(255,59,59,0.08)', border: '1px solid rgba(255,59,59,0.2)',
  borderRadius: '6px', padding: '4px 10px', fontSize: '10px', color: '#ff6b6b',
  cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace'
}
const exportBtnStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', borderRadius: '8px',
  padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center'
}
