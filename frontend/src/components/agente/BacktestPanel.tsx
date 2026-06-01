import { useState } from 'react'
import { Activity, Swords, Zap, Cpu, ChevronRight } from 'lucide-react'
import { useCountUp } from '../../hooks/useCountUp'

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

interface EquityPoint { ts: string; valor: number }

interface BacktestResult {
  symbol:             string
  dias:               number
  intervalo:          string
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
  elapsed_s:          number
  nota:               string
  trades:             Trade[]
  equity_curve:       EquityPoint[]
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const SIMBOLOS  = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'DOGEUSDT']
const DIAS_OPTS = [30, 60, 90, 180]
const API_AI    = import.meta.env.VITE_AI_URL || 'http://localhost:8002'

const RAZON: Record<string, { label: string; color: string }> = {
  TP:              { label: 'TAKE PROFIT',   color: '#00d060' },
  SL:              { label: 'STOP LOSS',     color: '#ff3b3b' },
  conviction_baja: { label: 'CONV. BAJA',    color: '#f97316' },
  señal_girada:    { label: 'SEÑAL GIRADA',  color: '#818cf8' },
  fin_backtest:    { label: 'CIERRE FINAL',  color: '#7890b0' },
}

const C = {
  bt:     '#818cf8',
  btGlow: 'rgba(129,140,248,0.55)',
  win:    '#00d060',
  loss:   '#ff3b3b',
  ghost:  '#3a4d6e',
}

// ─── Oscilloscope dual-equity chart ──────────────────────────────────────────

function Oscilloscope({ result }: { result: BacktestResult }) {
  const eq = result.equity_curve
  if (eq.length < 2) return null

  const W = 640, H = 230, PX = 8, PY = 16

  // Serie BT en % de retorno
  const bi      = result.balance_inicial
  const btPct   = eq.map(e => (e.valor - bi) / bi * 100)
  // Serie mercado: interpolación lineal del BH a lo largo del período
  const mkPct   = eq.map((_, i) => (result.bh_retorno_pct * i) / (eq.length - 1))

  const all = [...btPct, ...mkPct, 0]
  const lo  = Math.min(...all)
  const hi  = Math.max(...all)
  const pad = (hi - lo) * 0.12 || 1
  const min = lo - pad, max = hi + pad
  const rng = max - min || 1

  const X = (i: number) => PX + (i / (eq.length - 1)) * (W - 2 * PX)
  const Y = (v: number) => H - PY - ((v - min) / rng) * (H - 2 * PY)

  const toPath = (arr: number[]) =>
    arr.map((v, i) => `${i === 0 ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')

  const btPath = toPath(btPct)
  const mkPath = toPath(mkPct)
  const y0     = Y(0)
  const btWin  = result.retorno_pct >= result.bh_retorno_pct
  const lineCol = btWin ? C.win : C.loss
  const endX   = X(eq.length - 1)
  const endY   = Y(btPct[btPct.length - 1])

  const area = `${btPath} L ${endX.toFixed(1)} ${y0.toFixed(1)} L ${X(0).toFixed(1)} ${y0.toFixed(1)} Z`

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
           style={{ width: '100%', height: '230px', display: 'block' }}>
        <defs>
          <linearGradient id="bt-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={lineCol} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lineCol} stopOpacity="0" />
          </linearGradient>
          <filter id="bt-glow">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Rejilla blueprint */}
        {[0.2, 0.4, 0.6, 0.8].map(f => (
          <line key={f} x1={PX} x2={W - PX} y1={PY + f * (H - 2 * PY)} y2={PY + f * (H - 2 * PY)}
                stroke="rgba(129,140,248,0.06)" strokeWidth="1" />
        ))}
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} y1={PY} y2={H - PY} x1={PX + f * (W - 2 * PX)} x2={PX + f * (W - 2 * PX)}
                stroke="rgba(129,140,248,0.04)" strokeWidth="1" />
        ))}

        {/* Línea cero */}
        <line x1={PX} x2={W - PX} y1={y0} y2={y0}
              stroke="rgba(200,216,236,0.18)" strokeWidth="1" strokeDasharray="2 5" />

        {/* Mercado (ghost) */}
        <path d={mkPath} fill="none" stroke={C.ghost} strokeWidth="1.5"
              strokeDasharray="6 5" className="bt-trace"
              style={{ ['--trace-len' as any]: 4000, animationDelay: '0.1s' }} />

        {/* BT (trazo glow) */}
        <path d={area} fill="url(#bt-fill)" style={{ opacity: 0, animation: 'fade-in 0.6s ease 1.2s forwards' }} />
        <path d={btPath} fill="none" stroke={lineCol} strokeWidth="2.4"
              strokeLinejoin="round" filter="url(#bt-glow)"
              className="bt-trace" style={{ ['--trace-len' as any]: 4000 }} />

        {/* Blip del punto final */}
        <circle cx={endX} cy={endY} r="3" fill={lineCol} className="bt-blip"
                style={{ opacity: 0, animation: 'fade-in 0.3s ease 1.4s forwards, bt-blip 1.6s ease-in-out 1.4s infinite' }} />
      </svg>

      {/* Leyenda */}
      <div style={{ position: 'absolute', top: 8, right: 12, display: 'flex', gap: 14, fontSize: 9,
                    fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.04em' }}>
        <span style={{ color: lineCol }}>━ BT</span>
        <span style={{ color: C.ghost }}>╌ MERCADO</span>
      </div>
    </div>
  )
}

// ─── Tug-of-war: BT vs Mercado ───────────────────────────────────────────────

function Duel({ result }: { result: BacktestResult }) {
  const alpha   = result.retorno_pct - result.bh_retorno_pct
  const btWin   = alpha >= 0
  const alphaCU = useCountUp(alpha, 1100, 2)
  const btCU    = useCountUp(result.retorno_pct, 1100, 2)
  const mkCU    = useCountUp(result.bh_retorno_pct, 1100, 2)

  // Escala compartida para las barras (desde el centro)
  const mag = Math.max(Math.abs(result.retorno_pct), Math.abs(result.bh_retorno_pct), 1)
  const btW = Math.abs(result.retorno_pct) / mag * 50
  const mkW = Math.abs(result.bh_retorno_pct) / mag * 50

  const lane = (label: string, val: number, cu: number, w: number, accent: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 34 }}>
      <div style={{ width: 78, fontSize: 10, fontFamily: '"JetBrains Mono", monospace',
                    color: 'var(--text-3)', letterSpacing: '0.06em', textAlign: 'right' }}>
        {label}
      </div>
      {/* Arena: centro = 0 */}
      <div style={{ flex: 1, position: 'relative', height: 22 }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1,
                      background: 'rgba(200,216,236,0.18)' }} />
        <div style={{
          position: 'absolute', top: 3, height: 16, borderRadius: 3,
          left:  val >= 0 ? '50%' : `${50 - w}%`,
          width: `${w}%`,
          background: `linear-gradient(90deg, ${accent}22, ${accent}cc)`,
          border: `1px solid ${accent}`,
          boxShadow: `0 0 12px ${accent}55`,
          transition: 'width 1.1s cubic-bezier(0.16,1,0.3,1), left 1.1s cubic-bezier(0.16,1,0.3,1)',
        }} />
      </div>
      <div style={{ width: 86, fontSize: 15, fontWeight: 700, textAlign: 'right',
                    fontFamily: '"JetBrains Mono", monospace', color: accent }}>
        {cu >= 0 ? '+' : ''}{cu.toFixed(2)}%
      </div>
    </div>
  )

  return (
    <div className="bt-rise" style={{
      background: 'linear-gradient(135deg, rgba(129,140,248,0.06), rgba(7,16,30,0.4))',
      border: '1px solid rgba(129,140,248,0.18)', borderRadius: 16, padding: '22px 26px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Glow de fondo según veredicto */}
      <div style={{ position: 'absolute', top: -60, right: -40, width: 200, height: 200,
                    borderRadius: '50%', filter: 'blur(60px)', pointerEvents: 'none',
                    background: btWin ? 'rgba(0,208,96,0.12)' : 'rgba(255,59,59,0.10)' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Swords size={16} color={C.bt} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em',
                         color: 'var(--text-1)', fontFamily: '"JetBrains Mono", monospace' }}>
            BT&nbsp; vs &nbsp;EL MERCADO
          </span>
        </div>
        {/* Veredicto */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 20,
          background: btWin ? 'rgba(0,208,96,0.1)' : 'rgba(255,59,59,0.1)',
          border: `1px solid ${btWin ? 'rgba(0,208,96,0.35)' : 'rgba(255,59,59,0.3)'}`,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%',
                         background: btWin ? C.win : C.loss, boxShadow: `0 0 8px ${btWin ? C.win : C.loss}` }} />
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em',
                         color: btWin ? C.win : C.loss, fontFamily: '"JetBrains Mono", monospace' }}>
            {btWin ? 'BT GANA' : 'BT PIERDE'}
          </span>
        </div>
      </div>

      {/* Headline: alpha */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em',
                       fontFamily: '"JetBrains Mono", monospace', color: btWin ? C.win : C.loss }}>
          {alphaCU >= 0 ? '+' : ''}{alphaCU.toFixed(2)}
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: btWin ? C.win : C.loss }}>pts</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>
          de alpha sobre comprar y mantener
        </span>
      </div>

      {/* Las dos lanes */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {lane('BT', result.retorno_pct, btCU, btW, btWin ? C.win : C.loss)}
        {lane('MERCADO', result.bh_retorno_pct, mkCU, mkW, C.ghost)}
      </div>
    </div>
  )
}

// ─── Instrument readout (métrica monospace con count-up) ─────────────────────

function Readout({ label, value, decimals = 2, suffix = '', prefix = '', accent, delay = 0 }: {
  label: string; value: number; decimals?: number; suffix?: string; prefix?: string
  accent?: string; delay?: number
}) {
  const cu = useCountUp(value, 900, decimals)
  return (
    <div className="bt-rise" style={{
      background: 'rgba(255,255,255,0.018)', border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: 11, padding: '13px 16px', animationDelay: `${delay}ms`,
      display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      <div style={{ fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.1em',
                    fontFamily: '"JetBrains Mono", monospace' }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1,
                    fontFamily: '"JetBrains Mono", monospace',
                    color: accent || 'var(--text-1)' }}>
        {prefix}{cu.toFixed(decimals)}{suffix}
      </div>
    </div>
  )
}

// ─── Trade ledger (timeline) ─────────────────────────────────────────────────

function Ledger({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) return null
  return (
    <div className="bt-rise" style={{ animationDelay: '300ms' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Activity size={14} color={C.bt} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                       color: 'var(--text-2)', fontFamily: '"JetBrains Mono", monospace' }}>
          REGISTRO DE OPERACIONES · {trades.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {trades.map((t, i) => {
          const win   = t.pnl_pct >= 0
          const rcol  = win ? C.win : C.loss
          const razon = RAZON[t.razon] ?? { label: t.razon.toUpperCase(), color: C.ghost }
          return (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '4px 1fr auto auto auto',
              gap: 16, alignItems: 'center',
              background: 'rgba(255,255,255,0.015)',
              borderRadius: 10, padding: '11px 16px 11px 0',
            }}>
              {/* Rail de color */}
              <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 4,
                            background: rcol, boxShadow: `0 0 8px ${rcol}66` }} />
              {/* Fechas */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: '"JetBrains Mono", monospace',
                              display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t.ts_entrada}
                  <ChevronRight size={11} color="var(--text-4)" />
                  {t.ts_salida}
                </div>
                <div style={{ fontSize: 9.5, color: 'var(--text-4)', marginTop: 3,
                              fontFamily: '"JetBrains Mono", monospace' }}>
                  ${t.precio_entrada.toLocaleString()} → ${t.precio_salida.toLocaleString()}
                  &nbsp;·&nbsp; {t.duracion_h}h &nbsp;·&nbsp; conv {t.conviction_entrada}
                </div>
              </div>
              {/* Razón */}
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                             padding: '3px 9px', borderRadius: 5,
                             color: razon.color, background: `${razon.color}18`,
                             border: `1px solid ${razon.color}33`,
                             fontFamily: '"JetBrains Mono", monospace', whiteSpace: 'nowrap' }}>
                {razon.label}
              </span>
              {/* P&L % */}
              <div style={{ fontSize: 14, fontWeight: 700, textAlign: 'right', minWidth: 64,
                            color: rcol, fontFamily: '"JetBrains Mono", monospace' }}>
                {win ? '+' : ''}{t.pnl_pct.toFixed(2)}%
              </div>
              {/* P&L $ */}
              <div style={{ fontSize: 11, textAlign: 'right', minWidth: 70,
                            color: 'var(--text-3)', fontFamily: '"JetBrains Mono", monospace' }}>
                {win ? '+' : ''}${t.pnl_usd.toFixed(2)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Loading oscilloscope ────────────────────────────────────────────────────

function Scanning({ symbol, dias }: { symbol: string; dias: number }) {
  return (
    <div style={{
      position: 'relative', overflow: 'hidden', borderRadius: 16, height: 280,
      background: 'rgba(7,16,30,0.5)', border: '1px solid rgba(129,140,248,0.15)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
    }}>
      {/* Rejilla */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.4,
        backgroundImage: 'linear-gradient(rgba(129,140,248,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(129,140,248,0.06) 1px, transparent 1px)',
        backgroundSize: '32px 32px' }} />
      {/* Barrido */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, width: 80,
        background: 'linear-gradient(90deg, transparent, rgba(129,140,248,0.22), transparent)',
        animation: 'bt-sweep 1.4s ease-in-out infinite' }} />
      {/* Anillo pulsante */}
      <div style={{ position: 'relative', width: 46, height: 46 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%',
          border: `2px solid ${C.bt}`, animation: 'bt-ring 1.6s ease-out infinite' }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Cpu size={20} color={C.bt} />
        </div>
      </div>
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12, color: 'var(--text-2)',
                    letterSpacing: '0.1em', zIndex: 1 }}>
        ANALIZANDO {symbol} · {dias}d
        <span className="bt-caret" style={{ color: C.bt }}>▋</span>
      </div>
      <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9.5, color: 'var(--text-4)',
                    letterSpacing: '0.06em', zIndex: 1 }}>
        LSTM batch · indicadores · simulación de ciclo
      </div>
    </div>
  )
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function BacktestPanel() {
  const [symbol,  setSymbol]  = useState('BTCUSDT')
  const [dias,    setDias]    = useState(90)
  const [balance, setBalance] = useState(1000)
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<BacktestResult | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const ejecutar = async () => {
    setLoading(true); setError(null); setResult(null)
    try {
      const res = await fetch(`${API_AI}/backtest/autonomo?symbol=${symbol}&dias=${dias}&balance=${balance}`)
      if (!res.ok) {
        const b = await res.json().catch(() => ({ detail: 'Error desconocido' }))
        throw new Error(b.detail || `HTTP ${res.status}`)
      }
      setResult(await res.json())
    } catch (e: any) {
      setError(e.message || 'Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '26px 30px', maxWidth: 940, margin: '0 auto', position: 'relative' }}>

      {/* Blueprint background */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none', zIndex: 0,
        backgroundImage: 'radial-gradient(rgba(129,140,248,0.04) 1px, transparent 1px)',
        backgroundSize: '22px 22px' }} />

      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ── Header terminal ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 22 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                        background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.28)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 0 16px rgba(129,140,248,0.18)' }}>
            <Zap size={18} color={C.bt} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '0.02em' }}>
              BT&nbsp;LAB
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-4)', marginLeft: 9,
                             fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.08em' }}>
                BACKTEST · MODO AUTÓNOMO
              </span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text-3)', fontFamily: '"JetBrains Mono", monospace' }}>
              ¿Habría batido BT al mercado? Simulación sobre datos reales.
            </div>
          </div>
        </div>

        {/* ── Control deck ── */}
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 22, flexWrap: 'wrap',
          background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 12, padding: '14px 16px',
        }}>
          <Field label="PAR">
            <select value={symbol} onChange={e => setSymbol(e.target.value)} style={selectStyle}>
              {SIMBOLOS.map(s => <option key={s} value={s}>{s.replace('USDT', '')}</option>)}
            </select>
          </Field>

          <Field label="PERÍODO">
            <div style={{ display: 'flex', gap: 4, background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: 3 }}>
              {DIAS_OPTS.map(d => (
                <button key={d} onClick={() => setDias(d)} style={{
                  padding: '6px 13px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: 'none',
                  cursor: 'pointer', fontFamily: '"JetBrains Mono", monospace',
                  background: dias === d ? C.bt : 'transparent',
                  color: dias === d ? '#0a0f1e' : 'var(--text-3)',
                  transition: 'all 0.15s ease',
                }}>{d}d</button>
              ))}
            </div>
          </Field>

          <Field label="CAPITAL USD">
            <input type="number" value={balance} min={100} step={100}
                   onChange={e => setBalance(Number(e.target.value))} style={inputStyle} />
          </Field>

          <button onClick={ejecutar} disabled={loading} style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 22px', borderRadius: 9, border: 'none',
            background: loading ? '#2a3550' : `linear-gradient(135deg, ${C.bt}, #6366f1)`,
            color: loading ? 'var(--text-3)' : '#0a0f1e', fontWeight: 800, fontSize: 13,
            fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.04em',
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: loading ? 'none' : '0 0 20px rgba(129,140,248,0.35)',
            transition: 'all 0.2s ease',
          }}>
            <Zap size={15} /> {loading ? 'SIMULANDO' : 'EJECUTAR'}
          </button>
        </div>

        {/* ── Error ── */}
        {error && (
          <div style={{ background: 'rgba(255,59,59,0.08)', border: '1px solid rgba(255,59,59,0.25)',
                        borderRadius: 10, padding: '12px 16px', color: C.loss, fontSize: 13,
                        marginBottom: 16, fontFamily: '"JetBrains Mono", monospace' }}>
            ⚠ {error}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && <Scanning symbol={symbol} dias={dias} />}

        {/* ── Resultados ── */}
        {result && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Duelo */}
            <Duel result={result} />

            {/* Osciloscopio + readouts (layout asimétrico) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 16 }}>
              {/* Osciloscopio */}
              <div className="bt-rise" style={{
                background: 'rgba(7,16,30,0.4)', border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: 14, padding: '14px 16px', animationDelay: '120ms',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-3)',
                              fontFamily: '"JetBrains Mono", monospace', marginBottom: 4 }}>
                  CURVA DE CAPITAL · {result.symbol.replace('USDT','')} · {result.intervalo}
                </div>
                <Oscilloscope result={result} />
              </div>

              {/* Readouts verticales */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Readout label="SHARPE RATIO" value={result.sharpe} decimals={3} delay={150}
                         accent={result.sharpe > 0 ? C.win : C.loss} />
                <Readout label="MAX DRAWDOWN" value={result.max_drawdown_pct} suffix="%" prefix="-"
                         delay={210} accent={result.max_drawdown_pct < 15 ? 'var(--text-1)' : C.loss} />
                <Readout label="WIN RATE" value={result.win_rate_pct} suffix="%" decimals={1}
                         delay={270} accent={result.win_rate_pct >= 50 ? C.win : 'var(--text-1)'} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Readout label="TRADES" value={result.num_trades} decimals={0} delay={330} />
                  <Readout label="DURACIÓN" value={result.avg_duracion_h} suffix="h" decimals={1} delay={360} />
                </div>
              </div>
            </div>

            {/* Footer técnico */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          fontSize: 9.5, color: 'var(--text-4)', fontFamily: '"JetBrains Mono", monospace',
                          padding: '0 4px' }}>
              <span>◷ {result.candles_analizadas} velas · {result.elapsed_s}s de cómputo</span>
              <span>sentimiento neutro · solo señales técnicas + LSTM</span>
            </div>

            {/* Ledger */}
            {result.num_trades > 0
              ? <Ledger trades={result.trades} />
              : (
                <div className="bt-rise" style={{ textAlign: 'center', padding: '28px',
                  color: 'var(--text-3)', fontSize: 13, fontFamily: '"JetBrains Mono", monospace',
                  background: 'rgba(255,255,255,0.015)', borderRadius: 12, animationDelay: '300ms' }}>
                  BT no abrió ninguna posición — la convicción nunca superó el umbral 72.
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 6 }}>
                    Mantenerse fuera también es una decisión. Prueba un período más largo.
                  </div>
                </div>
              )}
          </div>
        )}

        {/* ── Idle ── */}
        {!result && !loading && !error && (
          <div style={{ textAlign: 'center', padding: '52px 0', color: 'var(--text-4)' }}>
            <Swords size={30} style={{ opacity: 0.25, marginBottom: 14 }} />
            <div style={{ fontSize: 13, fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-3)' }}>
              Configura el experimento y pulsa <b style={{ color: C.bt }}>EJECUTAR</b>
            </div>
            <div style={{ fontSize: 10.5, marginTop: 8, fontFamily: '"JetBrains Mono", monospace' }}>
              entrada conv ≥72 · take profit +15% · stop loss −8%
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: 'var(--text-4)', marginBottom: 6, letterSpacing: '0.1em',
                    fontFamily: '"JetBrains Mono", monospace' }}>{label}</div>
      {children}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '8px 12px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8, color: 'var(--text-1)', fontSize: 13, fontWeight: 600,
  fontFamily: '"JetBrains Mono", monospace', cursor: 'pointer', minWidth: 90,
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8, color: 'var(--text-1)', fontSize: 13, fontWeight: 600, width: 110,
  fontFamily: '"JetBrains Mono", monospace', boxSizing: 'border-box',
}
