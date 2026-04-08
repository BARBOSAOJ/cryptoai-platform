import { useState } from 'react'
import { apiClient } from '../api'
import { ChevronDown, ChevronUp, ShieldCheck, Clock, Target, Play, BarChart3, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import ChartPanel from './ChartPanel'

interface TradingTerminalProps {
  symbol: string
  insight: any
  history: any[]
  user: { name: string; plan: string; balance: number }
  onTradeExecuted?: (trade: any) => void
}

export default function TradingTerminal({ symbol, insight, history = [], user, onTradeExecuted }: TradingTerminalProps) {
  const [expanded, setExpanded]       = useState({ console: true, log: false, risk: true, auto: true })
  const [riskParams, setRiskParams]   = useState({ risk: 1, entry: 0, stop: 0 })
  const [calcResult, setCalcResult]   = useState({ size: 0, amount: 0 })
  const [executing, setExecuting]     = useState(false)
  const [execResult, setExecResult]   = useState<{ ok: boolean; msg: string } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const isBuy      = insight?.signal?.includes('COMPRAR') || insight?.signal?.includes('BUY')
  const confidence = (() => {
    const raw = insight?.confidence
    if (raw === undefined || raw === null) return 50
    const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace('%', ''), 10)
    return isNaN(n) ? 50 : Math.max(0, Math.min(100, n))
  })()
  const lstmActive = insight?.lstm_active ?? false
  const toggle = (k: keyof typeof expanded) => setExpanded(p => ({ ...p, [k]: !p[k] }))

  const syncRisk = async (params: typeof riskParams) => {
    if (params.entry > 0 && params.stop > 0 && params.entry !== params.stop) {
      try {
        const res = await apiClient.post('/risk/calculate', {
          balance: user.balance, riskPercentage: params.risk,
          entryPrice: params.entry, stopLoss: params.stop
        })
        setCalcResult({ size: res.data.positionSize, amount: res.data.riskAmount })
      } catch { /* error no crítico */ }
    }
  }

  const handleInput = (field: string, value: string) => {
    const num = parseFloat(value)
    const p = { ...riskParams, [field]: isNaN(num) ? 0 : num }
    setRiskParams(p)
    syncRisk(p)
  }

  const initiateOrder = () => {
    const token = localStorage.getItem('token')
    if (!token) {
      setExecResult({ ok: false, msg: 'No autenticado. Inicia sesión de nuevo.' })
      return
    }
    if (riskParams.entry <= 0) {
      setExecResult({ ok: false, msg: 'Introduce un precio de entrada en Gestión de riesgo.' })
      setTimeout(() => setExecResult(null), 4000)
      return
    }
    setShowConfirm(true)
  }

  const executeOrder = async () => {
    setShowConfirm(false)
    const currentPrice = riskParams.entry
    const size = calcResult.size > 0 ? calcResult.size : 0.001

    setExecuting(true)
    setExecResult(null)
    try {
      const res = await apiClient.post('/portfolio/execute', {
        symbol,
        size,
        price: currentPrice,
        type:       'BUY',
        signal:     insight?.signal     || 'COMPRAR',
        confidence: insight?.confidence || `${confidence}%`
      })

      setExecResult({ ok: true, msg: `Orden #${res.data.tradeId} ejecutada correctamente` })

      onTradeExecuted?.({
        id:         res.data.tradeId || Date.now(),
        symbol,
        price:      currentPrice,
        signal:     insight?.signal,
        confidence: insight?.confidence,
        timestamp:  new Date().toISOString()
      })

      setTimeout(() => setExecResult(null), 5000)
    } catch (e: any) {
      // El interceptor de axios gestiona el 401 global (logout automático)
      const msg = e.response?.status === 401
        ? 'Sesión expirada. Vuelve a iniciar sesión.'
        : e.response?.status === 400
          ? (e.response.data?.error || 'Parámetros de orden inválidos.')
          : e.code === 'ECONNABORTED'
            ? 'Tiempo de espera agotado. Verifica que el servidor está activo.'
            : 'Error al ejecutar la orden. Verifica que el servidor está activo.'
      setExecResult({ ok: false, msg })
      setTimeout(() => setExecResult(null), 5000)
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', background: '#060d1a', width: '100%' }}>

      {/* CHART */}
      <div style={{ flex: 1, borderRight: '1px solid #111e35', overflow: 'hidden' }}>
        <ChartPanel symbol={symbol} insight={insight} />
      </div>

      {/* SIDE PANEL */}
      <aside style={asideStyle}>

        {/* AI CONSOLE */}
        <div style={sectionStyle}>
          <div onClick={() => toggle('console')} style={sectionHeaderStyle}>
            <span style={sectionTitleStyle}>Análisis IA</span>
            {expanded.console ? <ChevronUp size={13} color="#1e3050" /> : <ChevronDown size={13} color="#1e3050" />}
          </div>
          {expanded.console && (
            <div style={{ padding: '0 16px 16px' }}>
              {!lstmActive && (
                <div style={warningBannerStyle}>
                  <AlertTriangle size={11} color="#f59e0b" strokeWidth={2} />
                  <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#f59e0b', marginLeft: '5px' }}>
                    Solo sentimiento — LSTM no disponible
                  </span>
                </div>
              )}
              <div style={aiCardStyle(isBuy)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#2c4268', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                    Señal combinada
                  </span>
                  <span style={badgeStyle(isBuy)}>{isBuy ? 'Comprar' : 'Monitorizar'}</span>
                </div>
                <div style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.5px', marginBottom: '3px' }}>
                  {insight?.signal || 'Escaneando'}
                </div>
                <div style={{ fontSize: '10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', marginBottom: '12px' }}>
                  {lstmActive ? 'LSTM + FinBERT' : 'FinBERT'} · {confidence}% confianza
                </div>
                <div style={{ height: '2px', background: '#111e35', borderRadius: '1px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${confidence}%`, background: isBuy ? '#00d060' : '#fff', borderRadius: '1px', transition: '1s' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* LOG */}
        <div style={sectionStyle}>
          <div onClick={() => toggle('log')} style={sectionHeaderStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={13} color="#1e3050" strokeWidth={1.75} />
              <span style={sectionTitleStyle}>Historial</span>
            </div>
            {expanded.log ? <ChevronUp size={13} color="#1e3050" /> : <ChevronDown size={13} color="#1e3050" />}
          </div>
          {expanded.log && (
            <div style={{ padding: '0 16px 16px', maxHeight: '180px', overflowY: 'auto' }}>
              {history.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#1e3050', textAlign: 'center', padding: '12px 0', fontFamily: 'JetBrains Mono, monospace' }}>
                  Sin señales aún
                </div>
              ) : history.map((h: any) => (
                <div key={h.id} style={logItemStyle}>
                  <div style={{ fontSize: '11px', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                    {h.symbol} <span style={{ color: '#00d060' }}>· {h.signal}</span>
                  </div>
                  <div style={{ fontSize: '10px', color: '#2c4268', marginTop: '2px' }}>
                    ${parseFloat(h.price).toLocaleString()} · {h.confidence}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RISK */}
        <div style={sectionStyle}>
          <div onClick={() => toggle('risk')} style={sectionHeaderStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Target size={13} color="#1e3050" strokeWidth={1.75} />
              <span style={sectionTitleStyle}>Gestión de riesgo</span>
            </div>
            {expanded.risk ? <ChevronUp size={13} color="#1e3050" /> : <ChevronDown size={13} color="#1e3050" />}
          </div>
          {expanded.risk && (
            <div style={{ padding: '0 16px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                <input
                  type="number" placeholder="Entrada $" min="0" step="any"
                  onChange={e => handleInput('entry', e.target.value)}
                  style={riskInputStyle}
                />
                <input
                  type="number" placeholder="Stop loss $" min="0" step="any"
                  onChange={e => handleInput('stop', e.target.value)}
                  style={riskInputStyle}
                />
              </div>
              <div style={riskResultStyle}>
                <div style={{ fontSize: '9px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1px', marginBottom: '6px', textTransform: 'uppercase' }}>
                  Tamaño recomendado
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.5px' }}>
                  {calcResult.size.toFixed(4)}<span style={{ fontSize: '11px', color: '#2c4268', fontWeight: 400, marginLeft: '4px' }}>{symbol.replace('USDT', '')}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* AUTO-TRADE */}
        <div style={sectionStyle}>
          <div onClick={() => toggle('auto')} style={sectionHeaderStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Play size={13} color="#1e3050" strokeWidth={1.75} />
              <span style={sectionTitleStyle}>Auto-trade</span>
            </div>
            {expanded.auto ? <ChevronUp size={13} color="#1e3050" /> : <ChevronDown size={13} color="#1e3050" />}
          </div>
          {expanded.auto && (
            <div style={{ padding: '0 16px 16px' }}>
              <div style={{ ...riskResultStyle, borderColor: isBuy ? 'rgba(0,208,96,0.2)' : '#111e35' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '10px', color: '#2c4268' }}>Estrategia IA</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00d060' }} />
                    <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#00d060' }}>Activa</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '9px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace', marginBottom: '4px' }}>Proyección</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#00d060', letterSpacing: '-0.5px' }}>
                      +${(user.balance * (confidence / 1000)).toFixed(2)}
                    </div>
                  </div>
                  <BarChart3 size={20} color="#111e35" />
                </div>

                {/* Feedback de ejecución */}
                {execResult && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px',
                    padding: '8px 10px', borderRadius: '7px',
                    background: execResult.ok ? 'rgba(0,208,96,0.07)' : 'rgba(255,59,59,0.07)',
                    border: `1px solid ${execResult.ok ? 'rgba(0,208,96,0.15)' : 'rgba(255,59,59,0.15)'}`
                  }}>
                    {execResult.ok
                      ? <CheckCircle size={12} color="#00d060" strokeWidth={1.75} />
                      : <XCircle size={12} color="#ff3b3b" strokeWidth={1.75} />}
                    <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: execResult.ok ? '#00d060' : '#ff3b3b' }}>
                      {execResult.msg}
                    </span>
                  </div>
                )}

                {/* Confirmación de orden */}
                {showConfirm ? (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => setShowConfirm(false)} style={cancelBtnStyle}>
                      Cancelar
                    </button>
                    <button onClick={executeOrder} style={confirmBtnStyle}>
                      Confirmar
                    </button>
                  </div>
                ) : (
                  <button
                    style={execBtnStyle(isBuy && !executing)}
                    disabled={!isBuy || executing}
                    onClick={initiateOrder}
                  >
                    {executing ? 'Procesando...' : isBuy ? 'Ejecutar orden' : 'Esperando señal'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* NOTICIAS */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #0e0e0e' }}>
            <span style={sectionTitleStyle}>Noticias en vivo</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
            {!insight?.news_details?.length ? (
              <div style={{ fontSize: '10px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace', padding: '12px 0', textAlign: 'center' }}>
                Sin noticias disponibles
              </div>
            ) : insight.news_details.map((item: any, i: number) => (
              <div key={i} style={newsItemStyle}>
                <div style={{ fontSize: '11px', color: '#7890b0', lineHeight: 1.5, marginBottom: '6px' }}>{item.title}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#1e3050' }}>{item.source}</span>
                  <span style={newsBadgeStyle(item.label)}>{item.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid #0e0e0e', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ShieldCheck size={12} color="#00d060" strokeWidth={1.75} />
          <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#1a2840', letterSpacing: '1px' }}>RSA-2048 ACTIVO</span>
        </div>
      </aside>
    </div>
  )
}

const asideStyle: React.CSSProperties = {
  width: '300px', background: '#07101e', display: 'flex', flexDirection: 'column',
  borderLeft: '1px solid #111e35', overflowY: 'auto'
}
const sectionStyle: React.CSSProperties = { borderBottom: '1px solid #0e0e0e' }
const sectionHeaderStyle: React.CSSProperties = {
  padding: '12px 16px', display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', cursor: 'pointer'
}
const sectionTitleStyle: React.CSSProperties = {
  fontSize: '11px', fontWeight: 600, color: '#2c4268', letterSpacing: '0.3px'
}
const aiCardStyle = (isBuy: boolean): React.CSSProperties => ({
  background: '#0b1424', border: `1px solid ${isBuy ? 'rgba(0,208,96,0.15)' : '#111e35'}`,
  borderRadius: '12px', padding: '14px'
})
const badgeStyle = (isBuy: boolean): React.CSSProperties => ({
  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
  color: isBuy ? '#00d060' : '#2c4268',
  background: isBuy ? 'rgba(0,208,96,0.08)' : '#111e35',
  border: `1px solid ${isBuy ? 'rgba(0,208,96,0.18)' : '#1a2840'}`,
  padding: '3px 8px', borderRadius: '5px', letterSpacing: '0.5px'
})
const warningBannerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', background: 'rgba(245,158,11,0.07)',
  border: '1px solid rgba(245,158,11,0.2)', borderRadius: '7px',
  padding: '6px 10px', marginBottom: '8px'
}
const logItemStyle: React.CSSProperties = {
  borderLeft: '2px solid #111e35', paddingLeft: '10px', marginBottom: '12px'
}
const riskInputStyle: React.CSSProperties = {
  background: '#0b1424', border: '1px solid #1a1a1a', color: '#fff',
  padding: '9px 10px', borderRadius: '8px', fontSize: '11px',
  fontFamily: 'Inter, sans-serif', outline: 'none', width: '100%'
}
const riskResultStyle: React.CSSProperties = {
  background: '#0b1424', border: '1px solid #111e35', borderRadius: '10px', padding: '12px'
}
const execBtnStyle = (active: boolean): React.CSSProperties => ({
  width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
  background: active ? '#00d060' : '#0b1424',
  color: active ? '#000' : '#1e3050',
  fontSize: '11px', fontWeight: 600, cursor: active ? 'pointer' : 'not-allowed',
  fontFamily: 'Inter, sans-serif', transition: 'all 0.2s', letterSpacing: '0.3px'
})
const cancelBtnStyle: React.CSSProperties = {
  flex: 1, padding: '9px', borderRadius: '8px', border: '1px solid #1a1a1a',
  background: '#0b1424', color: '#486080', fontSize: '11px', fontWeight: 600,
  cursor: 'pointer', fontFamily: 'Inter, sans-serif'
}
const confirmBtnStyle: React.CSSProperties = {
  flex: 1, padding: '9px', borderRadius: '8px', border: 'none',
  background: '#00d060', color: '#000', fontSize: '11px', fontWeight: 600,
  cursor: 'pointer', fontFamily: 'Inter, sans-serif'
}
const newsItemStyle: React.CSSProperties = {
  padding: '10px 0', borderBottom: '1px solid #0a0a0a'
}
const newsBadgeStyle = (label: string): React.CSSProperties => {
  const bull = label === 'BULLISH'
  const bear = label === 'BEARISH'
  return {
    fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.5px',
    padding: '2px 7px', borderRadius: '4px',
    color: bull ? '#00d060' : bear ? '#ff3b3b' : '#2c4268',
    background: bull ? 'rgba(0,208,96,0.07)' : bear ? 'rgba(255,59,59,0.07)' : '#0b1424',
    border: `1px solid ${bull ? 'rgba(0,208,96,0.15)' : bear ? 'rgba(255,59,59,0.15)' : '#111e35'}`
  }
}
