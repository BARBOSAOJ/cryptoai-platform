import { useState, useEffect } from 'react'
import { apiClient, aiClient } from '../../api'
import { ShieldCheck, Target, CheckCircle, XCircle, AlertTriangle, Zap, TrendingUp, TrendingDown, Clock } from 'lucide-react'
import ChartPanel from './ChartPanel'
import type { PosicionAbierta } from '../../hooks/useAgenteAutonomo'

interface TradingTerminalProps {
  symbol: string
  insight: any
  history: any[]
  user: { name: string; plan: string; balance: number }
  currentPrice: number
  posicionAgenteActiva: PosicionAbierta | null
  onTradeExecuted?: (trade: any) => void
}

export default function TradingTerminal({
  symbol, insight, history = [], user,
  currentPrice, posicionAgenteActiva, onTradeExecuted
}: TradingTerminalProps) {

  // ── Inversión manual ────────────────────────────────────────────────────────
  const [cantidad, setCantidad]       = useState('')
  const [executing, setExecuting]     = useState(false)
  const [execResult, setExecResult]   = useState<{ ok: boolean; msg: string } | null>(null)
  const [showConfirm, setShowConfirm] = useState<'BUY' | 'SELL' | null>(null)

  // ── Riesgo IA ───────────────────────────────────────────────────────────────
  const [aiRisk, setAiRisk]           = useState<any>(null)
  const [aiRiskLoading, setAiRiskLoading] = useState(false)
  const [stopAlert, setStopAlert]     = useState(false)

  // ── Señales ─────────────────────────────────────────────────────────────────
  const isBuy      = insight?.signal?.includes('COMPRAR') || insight?.signal?.includes('BUY')
  const confidence = (() => {
    const raw = insight?.confidence
    if (raw === undefined || raw === null) return 50
    const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace('%', ''), 10)
    return isNaN(n) ? 50 : Math.max(0, Math.min(100, n))
  })()
  const lstmActive      = insight?.lstm_active ?? false
  const convictionScore = typeof insight?.conviction_score === 'number' ? insight.conviction_score : null

  // ── P&L de posición actual ──────────────────────────────────────────────────
  const price = currentPrice > 0 ? currentPrice : (insight?.entry_price ?? 0)

  const posicion = posicionAgenteActiva
  const valorActual     = posicion ? posicion.cantidad * price : 0
  const pnlEuros        = posicion ? valorActual - posicion.invertido : 0
  const pnlPct          = posicion && posicion.invertido > 0 ? (pnlEuros / posicion.invertido) * 100 : 0
  const coinsEquivalente = cantidad && price > 0 ? (parseFloat(cantidad) / price) : 0

  // Alerta si precio <= stop de la posición abierta
  useEffect(() => {
    if (posicion) setStopAlert(price > 0 && price <= posicion.stopLoss)
  }, [price, posicion])

  const calcularConIA = async () => {
    if (price <= 0) return
    setAiRiskLoading(true)
    try {
      const res = await aiClient.get(`/risk/${symbol}`, { params: { price, saldo: user.balance } })
      setAiRisk(res.data)
      if (!cantidad) setCantidad(String(res.data.importe_riesgo?.toFixed(2) ?? ''))
    } catch {
      setExecResult({ ok: false, msg: 'Error al consultar IA de riesgo' })
      setTimeout(() => setExecResult(null), 3000)
    } finally {
      setAiRiskLoading(false)
    }
  }

  const executeOrder = async (type: 'BUY' | 'SELL') => {
    setShowConfirm(null)
    const importe = parseFloat(cantidad)
    if (!importe || importe <= 0) {
      setExecResult({ ok: false, msg: 'Introduce una cantidad válida' })
      setTimeout(() => setExecResult(null), 3000)
      return
    }
    const size = importe / price

    setExecuting(true)
    setExecResult(null)
    try {
      const res = await apiClient.post('/portfolio/execute', {
        symbol, size, price,
        type,
        signal:     insight?.signal     || (type === 'BUY' ? 'COMPRAR' : 'VENDER'),
        confidence: insight?.confidence || `${confidence}%`
      })
      setExecResult({ ok: true, msg: `Orden #${res.data.tradeId} ejecutada` })
      onTradeExecuted?.({
        id: res.data.tradeId || Date.now(), symbol, price,
        signal: type === 'BUY' ? 'COMPRAR' : 'VENDER',
        confidence: insight?.confidence,
        timestamp: new Date().toISOString()
      })
      setTimeout(() => setExecResult(null), 5000)
    } catch (e: any) {
      const msg = e.response?.status === 402
        ? 'Saldo insuficiente en cartera virtual'
        : e.response?.data?.error || 'Error al ejecutar la orden'
      setExecResult({ ok: false, msg })
      setTimeout(() => setExecResult(null), 5000)
    } finally {
      setExecuting(false)
    }
  }

  const baseAsset = symbol.replace(/USDT|BTC|ETH|BNB$/, '')

  return (
    <div style={{ display: 'flex', height: '100%', background: '#060d1a', width: '100%' }}>

      {/* ── CHART ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, borderRight: '1px solid #111e35', overflow: 'hidden' }}>
        <ChartPanel symbol={symbol} insight={insight} />
      </div>

      {/* ── SIDE PANEL ────────────────────────────────────────────────────── */}
      <aside style={asideStyle}>

        {/* ── Señal IA ──────────────────────────────────────────────────── */}
        <div style={blockStyle}>
          {!lstmActive && (
            <div style={warnBannerStyle}>
              <AlertTriangle size={10} color="#f59e0b" />
              <span style={{ fontSize: '9px', fontFamily: 'mono', color: '#f59e0b', marginLeft: '4px' }}>
                LSTM inactivo — solo sentimiento
              </span>
            </div>
          )}
          <div style={aiCardStyle(isBuy)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={microLabel}>Señal IA combinada</span>
              <span style={badgeStyle(isBuy)}>{isBuy ? 'COMPRAR' : 'MANTENER'}</span>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-0.3px', marginBottom: '8px' }}>
              {insight?.signal || 'Escaneando...'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ flex: 1, height: '3px', background: '#0d1a2e', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${confidence}%`, background: isBuy ? '#00d060' : '#486080', transition: '1s', borderRadius: '2px' }} />
              </div>
              <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: isBuy ? '#00d060' : '#486080' }}>
                {confidence}%
              </span>
            </div>
            {convictionScore !== null && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={microLabel}>Convicción</span>
                  <span style={{
                    fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
                    color: convictionScore >= 65 ? '#00d060' : convictionScore >= 45 ? '#f59e0b' : '#ff3b3b'
                  }}>{convictionScore}/100</span>
                </div>
                <div style={{ height: '4px', background: '#0d1a2e', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: '2px', transition: '1s',
                    width: `${convictionScore}%`,
                    background: convictionScore >= 65 ? '#00d060' : convictionScore >= 45 ? '#f59e0b' : '#ff3b3b'
                  }} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={divider} />

        {/* ── Posición abierta (agente o manual) ───────────────────────── */}
        {posicion ? (
          <div style={blockStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={sectionTitle}>Posición abierta</span>
              {stopAlert && (
                <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#ff3b3b', background: 'rgba(255,59,59,0.1)', border: '1px solid rgba(255,59,59,0.3)', padding: '2px 7px', borderRadius: '4px' }}>
                  ⚠ STOP
                </span>
              )}
            </div>

            {/* Resumen P&L */}
            <div style={{ background: '#0b1424', borderRadius: '10px', padding: '12px', marginBottom: '10px', border: `1px solid ${pnlEuros >= 0 ? 'rgba(0,208,96,0.15)' : 'rgba(255,59,59,0.15)'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <div style={microLabel}>Valor actual</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.5px', color: '#c8d8ec' }}>
                    €{valorActual.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={microLabel}>P&L</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                    {pnlEuros >= 0
                      ? <TrendingUp size={14} color="#00d060" />
                      : <TrendingDown size={14} color="#ff3b3b" />}
                    <span style={{ fontSize: '16px', fontWeight: 700, color: pnlEuros >= 0 ? '#00d060' : '#ff3b3b' }}>
                      {pnlEuros >= 0 ? '+' : ''}{pnlEuros.toFixed(2)}€
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: pnlEuros >= 0 ? '#00d060' : '#ff3b3b', fontFamily: 'JetBrains Mono, monospace' }}>
                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Datos de la posición */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
              {[
                { label: 'Invertido', val: `€${posicion.invertido.toFixed(2)}` },
                { label: `${baseAsset} equiv.`, val: posicion.cantidad.toFixed(6) },
                { label: 'Entrada', val: `$${posicion.precio.toLocaleString(undefined, { maximumFractionDigits: 4 })}` },
                { label: 'Precio actual', val: `$${price.toLocaleString(undefined, { maximumFractionDigits: 4 })}` },
                { label: 'Stop loss', val: `$${posicion.stopLoss.toLocaleString(undefined, { maximumFractionDigits: 4 })}` },
                { label: 'Target', val: `$${posicion.targetPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}` },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: '#091220', borderRadius: '7px', padding: '7px 9px', border: '1px solid #111e35' }}>
                  <div style={microLabel}>{label}</div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#c8d8ec', fontFamily: 'JetBrains Mono, monospace', marginTop: '2px' }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Barra de progreso hacia target */}
            {posicion.precio > 0 && posicion.targetPrice > posicion.precio && (
              <div style={{ marginBottom: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={microLabel}>Stop</span>
                  <span style={microLabel}>Progreso target</span>
                  <span style={microLabel}>Target</span>
                </div>
                <div style={{ height: '4px', background: '#111e35', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.max(0, Math.min(100, ((price - posicion.stopLoss) / (posicion.targetPrice - posicion.stopLoss)) * 100))}%`,
                    background: pnlEuros >= 0 ? '#00d060' : '#ff3b3b',
                    borderRadius: '2px', transition: '0.5s'
                  }} />
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Placeholder si no hay posición */
          <div style={{ ...blockStyle, padding: '10px 14px' }}>
            <span style={sectionTitle}>Sin posición abierta</span>
            <div style={{ fontSize: '10px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace', marginTop: '4px' }}>
              Introduce una cantidad y opera o activa el agente autónomo.
            </div>
          </div>
        )}

        <div style={divider} />

        {/* ── Nueva operación ──────────────────────────────────────────── */}
        <div style={blockStyle}>
          <span style={sectionTitle}>Nueva operación</span>

          {/* Input de cantidad */}
          <div style={{ marginTop: '10px', marginBottom: '8px' }}>
            <label style={microLabel}>Cantidad a invertir (€)</label>
            <input
              type="number" min="1" step="1" placeholder="100"
              value={cantidad}
              onChange={e => setCantidad(e.target.value)}
              style={inputStyle}
            />
            {cantidad && price > 0 && (
              <div style={{ fontSize: '10px', color: '#486080', fontFamily: 'JetBrains Mono, monospace', marginTop: '4px' }}>
                ≈ {coinsEquivalente.toFixed(6)} {baseAsset}
              </div>
            )}
          </div>

          {/* Botón calcular con IA */}
          <button onClick={calcularConIA} disabled={aiRiskLoading} style={iaBtn}>
            <Zap size={11} />
            {aiRiskLoading ? 'Calculando...' : 'Calcular con IA'}
          </button>

          {/* Info riesgo IA */}
          {aiRisk && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px', marginBottom: '8px' }}>
              {[
                { label: 'ATR', val: aiRisk.atr?.toFixed(4) ?? '—' },
                { label: 'Ratio R/B', val: `1:${aiRisk.ratio_rb?.toFixed(1) ?? '—'}` },
                { label: 'Stop loss', val: aiRisk.stop_loss ? `$${aiRisk.stop_loss.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : '—' },
                { label: 'Target', val: aiRisk.take_profit ? `$${aiRisk.take_profit.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : '—' },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: '#091220', borderRadius: '7px', padding: '6px 9px', border: '1px solid #111e35' }}>
                  <div style={microLabel}>{label}</div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#c8d8ec', fontFamily: 'JetBrains Mono, monospace', marginTop: '2px' }}>{val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Feedback ejecución */}
          {execResult && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px',
              padding: '8px 10px', borderRadius: '7px',
              background: execResult.ok ? 'rgba(0,208,96,0.07)' : 'rgba(255,59,59,0.07)',
              border: `1px solid ${execResult.ok ? 'rgba(0,208,96,0.15)' : 'rgba(255,59,59,0.15)'}`
            }}>
              {execResult.ok ? <CheckCircle size={12} color="#00d060" /> : <XCircle size={12} color="#ff3b3b" />}
              <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: execResult.ok ? '#00d060' : '#ff3b3b' }}>
                {execResult.msg}
              </span>
            </div>
          )}

          {/* Botones Comprar / Vender */}
          {showConfirm ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => setShowConfirm(null)} style={cancelBtn}>Cancelar</button>
              <button onClick={() => executeOrder(showConfirm)} style={confirmBtn(showConfirm === 'BUY')}>
                {executing ? 'Procesando...' : `Confirmar ${showConfirm === 'BUY' ? 'Compra' : 'Venta'}`}
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <button onClick={() => setShowConfirm('BUY')} disabled={executing} style={buyBtn}>
                <TrendingUp size={12} /> Comprar
              </button>
              <button onClick={() => setShowConfirm('SELL')} disabled={executing} style={sellBtn}>
                <TrendingDown size={12} /> Vender
              </button>
            </div>
          )}
        </div>

        <div style={divider} />

        {/* ── Historial reciente ───────────────────────────────────────── */}
        <div style={{ ...blockStyle, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <Clock size={11} color="#1e3050" />
            <span style={sectionTitle}>Historial reciente</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {history.length === 0 ? (
              <div style={{ fontSize: '10px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', padding: '10px 0' }}>
                Sin operaciones aún
              </div>
            ) : history.slice(0, 8).map((h: any) => (
              <div key={h.id} style={{ borderLeft: '2px solid #111e35', paddingLeft: '8px', marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color: h.signal?.includes('COMPRAR') ? '#00d060' : '#7890b0' }}>
                  {h.symbol} · {h.signal}
                </div>
                <div style={{ fontSize: '9px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', marginTop: '2px' }}>
                  ${parseFloat(h.price).toLocaleString()} · {h.confidence}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Noticias ─────────────────────────────────────────────────── */}
        {insight?.news_details?.length > 0 && (
          <>
            <div style={divider} />
            <div style={{ ...blockStyle, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '200px' }}>
              <span style={{ ...sectionTitle, marginBottom: '8px' }}>Noticias en vivo</span>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {insight.news_details.slice(0, 4).map((item: any, i: number) => {
                  const bull = item.label === 'BULLISH'
                  const bear = item.label === 'BEARISH'
                  return (
                    <div key={i} style={{ paddingBottom: '8px', marginBottom: '8px', borderBottom: '1px solid #0a0a0a' }}>
                      <div style={{ fontSize: '10px', color: '#7890b0', lineHeight: 1.5, marginBottom: '4px' }}>{item.title}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '9px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace' }}>{item.source}</span>
                        <span style={{
                          fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', padding: '1px 6px', borderRadius: '3px',
                          color: bull ? '#00d060' : bear ? '#ff3b3b' : '#2c4268',
                          background: bull ? 'rgba(0,208,96,0.07)' : bear ? 'rgba(255,59,59,0.07)' : '#0b1424',
                          border: `1px solid ${bull ? 'rgba(0,208,96,0.15)' : bear ? 'rgba(255,59,59,0.15)' : '#111e35'}`
                        }}>{item.label}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid #0e0e0e', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <ShieldCheck size={11} color="#00d060" strokeWidth={1.75} />
          <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#1a2840', letterSpacing: '1px' }}>RSA-2048 ACTIVO</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Target size={10} color="#1e3050" />
            <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#1e3050' }}>
              {symbol}
            </span>
          </div>
        </div>
      </aside>
    </div>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const asideStyle: React.CSSProperties = {
  width: '300px', background: '#07101e', display: 'flex', flexDirection: 'column',
  borderLeft: '1px solid #111e35', overflowY: 'auto'
}
const blockStyle: React.CSSProperties = {
  padding: '12px 14px'
}
const divider: React.CSSProperties = {
  height: '1px', background: '#0e0e0e', margin: '0'
}
const sectionTitle: React.CSSProperties = {
  fontSize: '10px', fontWeight: 600, color: '#2c4268',
  fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1px', textTransform: 'uppercase'
}
const microLabel: React.CSSProperties = {
  fontSize: '9px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace',
  letterSpacing: '0.5px', textTransform: 'uppercase'
}
const aiCardStyle = (isBuy: boolean): React.CSSProperties => ({
  background: '#0b1424',
  border: `1px solid ${isBuy ? 'rgba(0,208,96,0.15)' : '#111e35'}`,
  borderRadius: '10px', padding: '12px', marginTop: '8px'
})
const badgeStyle = (isBuy: boolean): React.CSSProperties => ({
  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
  color: isBuy ? '#00d060' : '#2c4268',
  background: isBuy ? 'rgba(0,208,96,0.08)' : '#111e35',
  border: `1px solid ${isBuy ? 'rgba(0,208,96,0.18)' : '#1a2840'}`,
  padding: '3px 8px', borderRadius: '5px'
})
const warnBannerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', background: 'rgba(245,158,11,0.07)',
  border: '1px solid rgba(245,158,11,0.2)', borderRadius: '7px',
  padding: '5px 8px', marginBottom: '8px'
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0b1424', border: '1px solid #1a1a1a', color: '#fff',
  padding: '9px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
  fontFamily: 'JetBrains Mono, monospace', outline: 'none', boxSizing: 'border-box',
  marginTop: '5px'
}
const iaBtn: React.CSSProperties = {
  width: '100%', padding: '8px', borderRadius: '8px',
  border: '1px solid rgba(0,208,96,0.2)', background: 'rgba(0,208,96,0.06)',
  color: '#00d060', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
  fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center',
  justifyContent: 'center', gap: '6px', marginBottom: '4px'
}
const buyBtn: React.CSSProperties = {
  padding: '10px', borderRadius: '8px', border: 'none',
  background: 'rgba(0,208,96,0.15)', color: '#00d060',
  fontSize: '12px', fontWeight: 700, cursor: 'pointer',
  fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center',
  justifyContent: 'center', gap: '5px'
}
const sellBtn: React.CSSProperties = {
  padding: '10px', borderRadius: '8px', border: 'none',
  background: 'rgba(255,59,59,0.12)', color: '#ff3b3b',
  fontSize: '12px', fontWeight: 700, cursor: 'pointer',
  fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center',
  justifyContent: 'center', gap: '5px'
}
const cancelBtn: React.CSSProperties = {
  flex: 1, padding: '9px', borderRadius: '8px', border: '1px solid #1a1a1a',
  background: '#0b1424', color: '#486080', fontSize: '11px', fontWeight: 600,
  cursor: 'pointer', fontFamily: 'Inter, sans-serif'
}
const confirmBtn = (isBuy: boolean): React.CSSProperties => ({
  flex: 2, padding: '9px', borderRadius: '8px', border: 'none',
  background: isBuy ? '#00d060' : '#ff3b3b',
  color: isBuy ? '#000' : '#fff',
  fontSize: '11px', fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif'
})
