import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FlaskConical, TrendingUp, TrendingDown, Activity, ArrowDownRight, Play, Loader2 } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Trade {
  symbol:             string
  ts_entrada:         string
  ts_salida:          string
  precio_entrada:     number
  precio_salida:      number
  pnl_pct:            number
  pnl_usd:            number
  razon:              string
  conviction_entrada: number
  duracion_h:         number
}

interface EquityPoint {
  ts:    string
  valor: number
}

interface BacktestResult {
  symbol:             string
  dias:               number
  balance_inicial:    number
  balance_final:      number
  retorno_pct:        number
  bh_retorno_pct:     number
  num_trades:         number
  win_rate_pct:       number
  sharpe:             number
  max_drawdown_pct:   number
  avg_duracion_h:     number
  candles_analizadas: number
  nota:               string
  trades:             Trade[]
  equity_curve:       EquityPoint[]
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const SIMBOLOS   = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT']
const DIAS_OPTS  = [30, 60, 90, 180]
const API_AI     = import.meta.env.VITE_AI_URL || 'http://localhost:8002'

const RAZON_LABEL: Record<string, string> = {
  TP:              'Take Profit',
  SL:              'Stop Loss',
  conviction_baja: 'Conviction baja',
  señal_girada:    'Señal girada',
  fin_backtest:    'Fin del período',
}

// ─── Equity Chart SVG ────────────────────────────────────────────────────────

function EquityChart({
  equity,
  balanceInicial,
  bhRetorno,
}: {
  equity:         EquityPoint[]
  balanceInicial: number
  bhRetorno:      number
}) {
  if (equity.length < 2) return null

  const W = 600, H = 180, PAD = 4

  const valores  = equity.map(e => e.valor)
  const minV     = Math.min(...valores, balanceInicial)
  const maxV     = Math.max(...valores, balanceInicial * (1 + Math.max(bhRetorno / 100, 0) + 0.01))
  const rng      = maxV - minV || 1

  const toX = (i: number) => PAD + ((i) / (equity.length - 1)) * (W - 2 * PAD)
  const toY = (v: number) => H - PAD - ((v - minV) / rng) * (H - 2 * PAD)

  // Línea estrategia
  const pathStrat = equity
    .map((e, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(e.valor).toFixed(1)}`)
    .join(' ')

  // Línea buy & hold
  const precioBH0 = balanceInicial
  const precioBH1 = balanceInicial * (1 + bhRetorno / 100)
  const pathBH    = `M ${PAD} ${toY(precioBH0).toFixed(1)} L ${(W - PAD).toFixed(1)} ${toY(precioBH1).toFixed(1)}`

  // Área bajo la curva de estrategia
  const areaStrat = `${pathStrat} L ${toX(equity.length - 1).toFixed(1)} ${H - PAD} L ${PAD} ${H - PAD} Z`

  // Línea base (balance inicial)
  const yBase = toY(balanceInicial)

  const color = valores[valores.length - 1] >= balanceInicial ? '#2ebd85' : '#f6465d'

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: '160px', display: 'block' }}
    >
      {/* Grid */}
      {[0.25, 0.5, 0.75].map(f => (
        <line
          key={f}
          x1={PAD} y1={PAD + f * (H - 2 * PAD)}
          x2={W - PAD} y2={PAD + f * (H - 2 * PAD)}
          stroke="rgba(255,255,255,0.05)" strokeWidth="1"
        />
      ))}

      {/* Línea base */}
      <line
        x1={PAD} y1={yBase}
        x2={W - PAD} y2={yBase}
        stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="4 4"
      />

      {/* Área estrategia */}
      <defs>
        <linearGradient id="gradStrat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.20" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={areaStrat} fill="url(#gradStrat)" />

      {/* Buy & Hold */}
      <path d={pathBH} fill="none" stroke="rgba(148,163,184,0.40)" strokeWidth="1.5" strokeDasharray="5 4" />

      {/* Estrategia */}
      <path d={pathStrat} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  )
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, positive,
}: {
  label: string; value: string; sub?: string; positive?: boolean
}) {
  const color = positive === undefined
    ? 'var(--text-1)'
    : positive ? '#2ebd85' : '#f6465d'

  return (
    <div style={{
      background:   'rgba(255,255,255,0.025)',
      border:       '1px solid rgba(255,255,255,0.06)',
      borderRadius: '10px',
      padding:      '14px 18px',
    }}>
      <div style={{ fontSize: '10px', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '10px', color: 'var(--text-4)', marginTop: '4px' }}>{sub}</div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function BacktestPanel() {
  const [symbol,   setSymbol]   = useState('BTCUSDT')
  const [dias,     setDias]     = useState(90)
  const [balance,  setBalance]  = useState(1000)
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<BacktestResult | null>(null)
  const [error,    setError]    = useState<string | null>(null)

  const ejecutar = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const url = `${API_AI}/backtest/autonomo?symbol=${symbol}&dias=${dias}&balance=${balance}`
      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: 'Error desconocido' }))
        throw new Error(body.detail || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setResult(data)
    } catch (e: any) {
      setError(e.message || 'Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '900px', margin: '0 auto' }}>

      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
        <FlaskConical size={20} color="#818cf8" />
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-1)' }}>
            Backtest — Modo Autónomo
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-4)' }}>
            Simulación histórica de la estrategia de BT sobre datos técnicos reales
          </div>
        </div>
      </div>

      {/* Controles */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '10px',
        marginBottom: '20px', alignItems: 'end',
      }}>
        {/* Símbolo */}
        <div>
          <label style={labelStyle}>Par</label>
          <select value={symbol} onChange={e => setSymbol(e.target.value)} style={selectStyle}>
            {SIMBOLOS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Días */}
        <div>
          <label style={labelStyle}>Período</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {DIAS_OPTS.map(d => (
              <button
                key={d}
                onClick={() => setDias(d)}
                style={{
                  flex: 1, padding: '7px 0', fontSize: '12px', fontWeight: 600,
                  borderRadius: '7px', border: 'none', cursor: 'pointer',
                  background:   dias === d ? '#818cf8' : 'rgba(255,255,255,0.04)',
                  color:        dias === d ? '#fff' : 'var(--text-3)',
                }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Balance */}
        <div>
          <label style={labelStyle}>Balance inicial (USD)</label>
          <input
            type="number" value={balance} min={100} step={100}
            onChange={e => setBalance(Number(e.target.value))}
            style={inputStyle}
          />
        </div>

        {/* Botón */}
        <button
          onClick={ejecutar}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '8px', border: 'none',
            background: loading ? '#4a4a6a' : '#818cf8', color: '#fff',
            fontWeight: 700, fontSize: '13px', cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading
            ? <><Loader2 size={14} className="spin" /> Simulando…</>
            : <><Play size={14} /> Ejecutar</>
          }
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.2)',
          borderRadius: '8px', padding: '12px 16px', color: '#f6465d',
          fontSize: '13px', marginBottom: '16px',
        }}>
          {error}
        </div>
      )}

      {/* Resultados */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Métricas principales */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
              <MetricCard
                label="Retorno estrategia"
                value={`${result.retorno_pct >= 0 ? '+' : ''}${result.retorno_pct.toFixed(2)}%`}
                sub={`$${result.balance_inicial} → $${result.balance_final.toFixed(0)}`}
                positive={result.retorno_pct >= 0}
              />
              <MetricCard
                label="vs Buy & Hold"
                value={`${(result.retorno_pct - result.bh_retorno_pct).toFixed(2)}%`}
                sub={`BH: ${result.bh_retorno_pct >= 0 ? '+' : ''}${result.bh_retorno_pct.toFixed(2)}%`}
                positive={result.retorno_pct >= result.bh_retorno_pct}
              />
              <MetricCard
                label="Sharpe ratio"
                value={result.sharpe.toFixed(3)}
                sub="Anualizado · señales/hora"
                positive={result.sharpe > 0}
              />
              <MetricCard
                label="Max Drawdown"
                value={`-${result.max_drawdown_pct.toFixed(2)}%`}
                positive={result.max_drawdown_pct < 15}
              />
            </div>

            {/* Métricas secundarias */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '20px' }}>
              <MetricCard label="Trades" value={String(result.num_trades)} />
              <MetricCard
                label="Win rate"
                value={`${result.win_rate_pct.toFixed(1)}%`}
                positive={result.win_rate_pct >= 50}
              />
              <MetricCard label="Duración media" value={`${result.avg_duracion_h.toFixed(1)}h`} />
              <MetricCard label="Velas analizadas" value={String(result.candles_analizadas)} />
            </div>

            {/* Gráfico de equity */}
            <div style={{
              background:   'rgba(255,255,255,0.02)',
              border:       '1px solid rgba(255,255,255,0.06)',
              borderRadius: '12px',
              padding:      '16px',
              marginBottom: '20px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-2)' }}>
                  Curva de equity · {result.symbol} · {result.dias}d
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '10px', color: 'var(--text-4)' }}>
                  <span>
                    <span style={{ display:'inline-block', width:'20px', height:'2px', background: result.retorno_pct >= 0 ? '#2ebd85' : '#f6465d', marginRight:'5px', verticalAlign:'middle' }} />
                    Estrategia
                  </span>
                  <span>
                    <span style={{ display:'inline-block', width:'20px', height:'2px', background:'rgba(148,163,184,0.4)', marginRight:'5px', verticalAlign:'middle', borderBottom:'2px dashed rgba(148,163,184,0.4)', height:'0' }} />
                    Buy &amp; Hold
                  </span>
                </div>
              </div>
              <EquityChart
                equity={result.equity_curve}
                balanceInicial={result.balance_inicial}
                bhRetorno={result.bh_retorno_pct}
              />
            </div>

            {/* Nota sobre sentimiento */}
            <div style={{
              fontSize: '10px', color: 'var(--text-4)', marginBottom: '16px',
              padding: '8px 12px', background: 'rgba(255,255,255,0.02)',
              borderRadius: '6px', borderLeft: '2px solid rgba(129,140,248,0.3)',
            }}>
              ℹ️ {result.nota}
            </div>

            {/* Tabla de trades */}
            {result.trades.length > 0 && (
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-2)', marginBottom: '10px' }}>
                  Historial de operaciones ({result.trades.length})
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-4)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        {['Entrada', 'Salida', 'Precio entrada', 'Precio salida', 'P&L %', 'P&L $', 'Razón', 'Conv.', 'Duración'].map(h => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.map((t, i) => (
                        <tr
                          key={i}
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                            background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
                          }}
                        >
                          <td style={tdStyle}>{t.ts_entrada}</td>
                          <td style={tdStyle}>{t.ts_salida}</td>
                          <td style={{ ...tdStyle, fontFamily: '"JetBrains Mono", monospace' }}>
                            ${t.precio_entrada.toLocaleString()}
                          </td>
                          <td style={{ ...tdStyle, fontFamily: '"JetBrains Mono", monospace' }}>
                            ${t.precio_salida.toLocaleString()}
                          </td>
                          <td style={{ ...tdStyle, color: t.pnl_pct >= 0 ? '#2ebd85' : '#f6465d', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
                            {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%
                          </td>
                          <td style={{ ...tdStyle, color: t.pnl_usd >= 0 ? '#2ebd85' : '#f6465d', fontFamily: '"JetBrains Mono", monospace' }}>
                            {t.pnl_usd >= 0 ? '+' : ''}${t.pnl_usd.toFixed(2)}
                          </td>
                          <td style={tdStyle}>
                            <span style={{
                              padding: '2px 7px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                              background: t.razon === 'TP'
                                ? 'rgba(46,189,133,0.12)' : t.razon === 'SL'
                                ? 'rgba(246,70,93,0.12)'  : 'rgba(129,140,248,0.10)',
                              color: t.razon === 'TP'
                                ? '#2ebd85' : t.razon === 'SL'
                                ? '#f6465d'  : '#818cf8',
                            }}>
                              {RAZON_LABEL[t.razon] ?? t.razon}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, color: 'var(--text-3)' }}>{t.conviction_entrada}</td>
                          <td style={{ ...tdStyle, color: 'var(--text-4)' }}>{t.duracion_h}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {result.trades.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-4)', fontSize: '13px' }}>
                Ningún trade ejecutado en el período con los umbrales actuales.
                <br />
                <span style={{ fontSize: '11px' }}>Prueba un período mayor o reduce el umbral de entrada.</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Estado vacío */}
      {!result && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-4)' }}>
          <Activity size={32} style={{ marginBottom: '12px', opacity: 0.3 }} />
          <div style={{ fontSize: '13px' }}>Configura los parámetros y pulsa <b>Ejecutar</b></div>
          <div style={{ fontSize: '11px', marginTop: '6px' }}>
            Umbral entrada: {72} · TP: +15% · SL: -8%
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display:      'block',
  fontSize:     '10px',
  color:        'var(--text-4)',
  marginBottom: '5px',
  fontWeight:   600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const selectStyle: React.CSSProperties = {
  width:        '100%',
  padding:      '8px 10px',
  background:   'rgba(255,255,255,0.04)',
  border:       '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  color:        'var(--text-1)',
  fontSize:     '13px',
}

const inputStyle: React.CSSProperties = {
  width:        '100%',
  padding:      '8px 10px',
  background:   'rgba(255,255,255,0.04)',
  border:       '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  color:        'var(--text-1)',
  fontSize:     '13px',
  boxSizing:    'border-box',
}

const tdStyle: React.CSSProperties = {
  padding:   '7px 10px',
  color:     'var(--text-2)',
  whiteSpace: 'nowrap',
}
