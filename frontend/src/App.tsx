import { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, Power, TrendingUp, TrendingDown, Target, AlertTriangle, Zap } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiClient, aiClient, API_PRICE } from './api'
import Header from './components/shared/Header'
import Sidebar from './components/shared/Sidebar'
import ChartPanel from './components/terminal/ChartPanel'
import Login from './components/Login'
import LoadingSplash from './components/shared/LoadingSplash'
import ErrorBoundary from './components/shared/ErrorBoundary'
import ChatPanel from './components/chat/ChatPanel'
import Portfolio from './components/portfolio/Portfolio'
import { useAgenteAutonomo } from './hooks/useAgenteAutonomo'
import type { PosicionAbierta, EntradaLog } from './hooks/useAgenteAutonomo'
import Settings from './components/configuracion/Settings'
import AlertasPanel from './components/terminal/AlertasPanel'
import TrendingRadar from './components/terminal/TrendingRadar'

const MAIN_COINS = ['BTCUSDT','ETHUSDT','SOLUSDT','TRUMPUSDT','PEPEUSDT','DOGEUSDT','SHIBUSDT']

// Ticker button with price-flash animation
function TickerButton({
  sym, data, active, onClick,
  flash,
}: {
  sym: string
  data: { price: number; change: string } | null
  active: boolean
  onClick: () => void
  flash: 'up' | 'down' | null
}) {
  const name = sym.replace('USDT','')
  const p    = data?.price ?? 0
  const ch   = data?.change || '+0.00%'
  const up   = !ch.startsWith('-')

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start',
        padding: '0 14px', border: 'none', cursor: 'pointer', flexShrink: 0,
        background: active ? 'rgba(99,102,241,0.1)' : 'transparent',
        borderBottom: `2px solid ${active ? '#818cf8' : 'transparent'}`,
        borderTop: '2px solid transparent',
        transition: 'background 0.18s, border-color 0.18s',
        position: 'relative',
      }}
    >
      {/* Glow line on active */}
      {active && (
        <div style={{
          position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 2,
          background: 'linear-gradient(90deg, transparent, #818cf8, transparent)',
          filter: 'blur(2px)',
        }} />
      )}
      <span style={{ fontSize: 9, color: active ? 'var(--text-4)' : 'var(--text-5)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.5px', marginBottom: 2 }}>
        {name}
      </span>
      <span
        className={flash === 'up' ? 'price-flash-up' : flash === 'down' ? 'price-flash-down' : undefined}
        style={{ fontSize: 11, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color: active ? 'var(--text-1)' : 'var(--text-2)', borderRadius: 4, padding: '0 2px' }}
      >
        {p > 0 ? p.toLocaleString('en', { maximumFractionDigits: p < 1 ? 6 : 2 }) : '—'}
      </span>
      <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: up ? 'var(--green)' : 'var(--red)' }}>
        {ch}
      </span>
    </button>
  )
}

export default function App() {
  const [loading, setLoading]         = useState(true)
  const [isLoggedIn, setIsLoggedIn]   = useState(() => { try { return !!localStorage.getItem('token') } catch { return false } })
  const [currentSymbol, setCurrentSymbol] = useState('BTCUSDT')
  const [user, setUser]               = useState(() => {
    try {
      return {
        name:    localStorage.getItem('userName') || '',
        plan:    localStorage.getItem('userPlan') || 'PRO ELITE',
        balance: parseFloat(localStorage.getItem('userBalance') || '12500.50'),
      }
    } catch { return { name: '', plan: 'PRO ELITE', balance: 12500.50 } }
  })

  const [marketData, setMarketData]     = useState<Record<string, any>>({})
  const [aiInsights, setAiInsights]     = useState<Record<string, any>>({})
  const [tradeHistory, setTradeHistory] = useState<any[]>([])
  const [refreshInterval, setRefreshInterval] = useState(3000)
  const [alertFlash, setAlertFlash]     = useState(false)
  const [sseConnected, setSseConnected] = useState(false)
  const [activeTab, setActiveTab]       = useState<'TRADE' | 'PORTFOLIO' | 'BOT' | 'CONFIG'>('TRADE')
  const [dataError, setDataError]       = useState<string | null>(null)
  const [aiHealth, setAiHealth]         = useState<{ lstm: boolean; finbert: boolean } | null>(null)

  // Price flash state: track direction per symbol
  const [flashStates, setFlashStates]   = useState<Record<string, 'up' | 'down'>>({})
  const prevPricesRef   = useRef<Record<string, number>>({})
  const flashTimers     = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const historyRef          = useRef<Record<string, number[]>>({})
  const volumesRef          = useRef<Record<string, number[]>>({})
  const currentSymRef       = useRef(currentSymbol)
  const pollingErrorCount   = useRef(0)
  const aiCooldownRef       = useRef<Record<string, number>>({})
  const reconnectCount      = useRef(0)

  const { estado: estadoAgente, activar, pausar, procesarTick, alertasStopLoss } = useAgenteAutonomo()

  useEffect(() => { currentSymRef.current = currentSymbol }, [currentSymbol])

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 1500)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const handler = () => handleLogout()
    window.addEventListener('session-expired', handler)
    return () => window.removeEventListener('session-expired', handler)
  }, [])

  useEffect(() => {
    if (!isLoggedIn || loading) return
    aiClient.get('/health')
      .then(res => setAiHealth({ lstm: res.data.lstm, finbert: res.data.finbert }))
      .catch(() => setAiHealth({ lstm: false, finbert: false }))
  }, [isLoggedIn, loading])

  const triggerFlash = useCallback((symbol: string, direction: 'up' | 'down') => {
    if (flashTimers.current[symbol]) clearTimeout(flashTimers.current[symbol])
    setFlashStates(prev => ({ ...prev, [symbol]: direction }))
    flashTimers.current[symbol] = setTimeout(() => {
      setFlashStates(prev => { const next = { ...prev }; delete next[symbol]; return next })
    }, 580)
  }, [])

  const fetchAiInsight = useCallback(async (
    symbol: string, price: number, history?: number[], volumes?: number[]
  ) => {
    const now = Date.now()
    const lastCall = aiCooldownRef.current[symbol] || 0
    if (now - lastCall < 8000) return
    aiCooldownRef.current[symbol] = now

    const h = history ?? historyRef.current[symbol] ?? []
    const v = volumes ?? volumesRef.current[symbol] ?? []
    if (h.length < 5) return

    try {
      const res = await aiClient.post('/analyze', { symbol, price, history: h, volumes: v })
      const insight = res.data
      setAiInsights(prev => ({ ...prev, [symbol]: insight }))

      const btcHistory = historyRef.current['BTCUSDT'] ?? []
      const btcPriceChange = btcHistory.length >= 2
        ? (btcHistory[btcHistory.length - 1] - btcHistory[btcHistory.length - 2]) / btcHistory[btcHistory.length - 2]
        : 0

      procesarTick(symbol, price, insight, btcPriceChange)

      if (symbol === currentSymRef.current && insight?.signal?.includes('COMPRAR')) {
        setAlertFlash(true)
        setTimeout(() => setAlertFlash(false), 2000)
        setTradeHistory(prev => [{
          id: Date.now(), symbol, price, signal: insight.signal,
          confidence: insight.confidence, timestamp: new Date().toISOString()
        }, ...prev].slice(0, 50))
      }
    } catch (e: any) {
      if (import.meta.env.DEV) console.error(`[AI] ${symbol}:`, e?.message)
    }
  }, [procesarTick])

  useEffect(() => {
    if (!isLoggedIn || loading) return

    let es: EventSource | null = null
    let fallbackTimer: ReturnType<typeof setInterval> | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let destroyed = false

    const processTickBatch = (rawData: Record<string, { price: string; volume: string }>) => {
      const watchedSymbols = new Set([currentSymRef.current, ...MAIN_COINS])
      const aiQueue: Array<{ symbol: string; price: number; history: number[]; volumes: number[] }> = []

      for (const [symbol, tick] of Object.entries(rawData)) {
        if (!tick?.price) continue
        const price = parseFloat(tick.price)
        if (isNaN(price) || price <= 0) continue

        const prevHistory = historyRef.current[symbol] || []
        const prevVolumes = volumesRef.current[symbol] || []
        const newHistory  = [...prevHistory, price].slice(-65)
        const newVolumes  = [...prevVolumes, parseFloat(tick.volume || '0')].slice(-65)
        historyRef.current[symbol] = newHistory
        volumesRef.current[symbol] = newVolumes

        // Track price direction for flash animation
        const prevPrice = prevPricesRef.current[symbol]
        if (prevPrice !== undefined && price !== prevPrice && MAIN_COINS.includes(symbol)) {
          triggerFlash(symbol, price > prevPrice ? 'up' : 'down')
        }
        prevPricesRef.current[symbol] = price

        if (watchedSymbols.has(symbol)) {
          aiQueue.push({ symbol, price, history: newHistory, volumes: newVolumes })
        }
      }

      setMarketData(prev => {
        const updated = { ...prev }
        for (const [symbol, tick] of Object.entries(rawData)) {
          if (!tick?.price) continue
          const price = parseFloat(tick.price)
          if (isNaN(price) || price <= 0) continue
          const newHistory = historyRef.current[symbol] || []
          const newVolumes = volumesRef.current[symbol] || []
          const prevPrice  = prev[symbol]?.history?.at(-2) ?? price
          const changePct  = prevPrice > 0 ? (((price - prevPrice) / prevPrice) * 100).toFixed(2) : '0.00'
          const changeStr  = parseFloat(changePct) >= 0 ? `+${changePct}%` : `${changePct}%`
          updated[symbol]  = { price, history: newHistory, volumes: newVolumes, change: changeStr }
        }
        return updated
      })

      for (const { symbol, price, history, volumes } of aiQueue) {
        fetchAiInsight(symbol, price, history, volumes)
      }
    }

    const connectSse = () => {
      if (destroyed) return
      es = new EventSource(`${API_PRICE}/sse/prices`)

      es.onopen = () => {
        setSseConnected(true)
        reconnectCount.current = 0
        if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null }
      }

      es.onmessage = (event) => {
        try {
          processTickBatch(JSON.parse(event.data))
          setDataError(null)
          pollingErrorCount.current = 0
        } catch (e) {
          if (import.meta.env.DEV) console.warn('[SSE] Error:', e)
        }
      }

      es.onerror = () => {
        if (destroyed) return
        setSseConnected(false)
        es?.close(); es = null

        if (!fallbackTimer) {
          fallbackTimer = setInterval(async () => {
            try {
              const res = await apiClient.get('/prices')
              processTickBatch(res.data)
              pollingErrorCount.current = 0
              setDataError(null)
            } catch {
              pollingErrorCount.current += 1
              if (pollingErrorCount.current >= 3) setDataError('Sin datos de mercado. Verifica market-service.')
            }
          }, refreshInterval)
        }

        reconnectCount.current += 1
        const delay = Math.min(2000 * Math.pow(1.5, reconnectCount.current - 1), 30_000)
        reconnectTimeout = setTimeout(connectSse, delay)
      }
    }

    connectSse()
    return () => {
      destroyed = true
      es?.close()
      if (fallbackTimer)    clearInterval(fallbackTimer)
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      setSseConnected(false)
    }
  }, [isLoggedIn, loading, refreshInterval, fetchAiInsight, triggerFlash])

  const handleLoginSuccess = ({ name, plan }: { name: string; plan: string }) => {
    localStorage.setItem('userName', name)
    localStorage.setItem('userPlan', plan)
    setUser(prev => ({ ...prev, name, plan }))
    setIsLoggedIn(true)
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('userName')
    localStorage.removeItem('userPlan')
    setIsLoggedIn(false)
  }

  if (loading)     return <LoadingSplash />
  if (!isLoggedIn) return <Login onLoginSuccess={handleLoginSuccess} />

  const posicionActual = estadoAgente.posicionesAbiertas[currentSymbol] ?? null
  const precioActual   = marketData[currentSymbol]?.price ?? 0
  const pnlEuros       = posicionActual ? posicionActual.cantidad * precioActual - posicionActual.invertido : 0
  const pnlPct         = posicionActual && posicionActual.invertido > 0 ? (pnlEuros / posicionActual.invertido) * 100 : 0
  const insight        = aiInsights[currentSymbol]
  const isBuy          = insight?.signal?.includes('COMPRAR') || insight?.signal?.includes('BUY')
  const confidence     = (() => {
    const raw = insight?.confidence
    if (raw === undefined || raw === null) return null
    const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace('%',''), 10)
    return isNaN(n) ? null : Math.max(0, Math.min(100, n))
  })()

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', width:'100vw', background:'var(--bg-base)', color:'var(--text-1)', overflow:'hidden' }}>

      <Header
        currentSymbol={currentSymbol}
        setCurrentSymbol={setCurrentSymbol}
        user={user}
        marketData={marketData}
        sseConnected={sseConnected}
        aiHealth={aiHealth}
        stopAlertCount={alertasStopLoss.size}
        onLogout={handleLogout}
        onSettingsOpen={() => setActiveTab('CONFIG')}
      />

      {/* Data error banner */}
      <AnimatePresence>
        {dataError && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ background:'rgba(255,59,59,0.07)', borderBottom:'1px solid rgba(255,59,59,0.18)', padding:'5px 20px', fontSize:'11px', color:'#ff6b6b', display:'flex', alignItems:'center', gap:8, flexShrink:0, overflow:'hidden' }}
          >
            <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--red)', flexShrink:0 }} />
            {dataError}
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

        {/* ── SIDEBAR ───────────────────────────────────────────────────────── */}
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />

        {/* ── CONTENT ───────────────────────────────────────────────────────── */}
        <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

          {/* ── TRADE TAB ─────────────────────────────────────────────────── */}
          {activeTab === 'TRADE' && (
            <>
              {/* LEFT: chart area */}
              <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>

                {/* Ticker strip */}
                <div style={{ height:54, background:'var(--bg-panel)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'stretch', overflowX:'auto', flexShrink:0 }}>
                  {MAIN_COINS.map(sym => (
                    <TickerButton
                      key={sym}
                      sym={sym}
                      data={marketData[sym] ? { price: marketData[sym].price, change: marketData[sym].change } : null}
                      active={sym === currentSymbol}
                      onClick={() => setCurrentSymbol(sym)}
                      flash={flashStates[sym] ?? null}
                    />
                  ))}
                  <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8, padding:'0 12px', flexShrink:0 }}>
                    {insight && confidence !== null && (
                      <>
                        <div style={{ width:1, height:28, background:'var(--border)' }} />
                        <motion.div
                          animate={isBuy ? { boxShadow: ['0 0 8px rgba(0,208,96,0.2)', '0 0 16px rgba(0,208,96,0.4)', '0 0 8px rgba(0,208,96,0.2)'] } : {}}
                          transition={{ duration: 2, repeat: Infinity }}
                          style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:7, background: isBuy ? 'rgba(0,208,96,0.08)' : 'rgba(99,102,241,0.06)', border: `1px solid ${isBuy ? 'rgba(0,208,96,0.2)' : 'rgba(99,102,241,0.15)'}` }}
                        >
                          <span style={{ fontSize:8, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace', letterSpacing:'1px' }}>BT·IA</span>
                          <span style={{ fontSize:10, fontWeight:700, color: isBuy ? 'var(--green)' : 'var(--indigo)' }}>{insight.signal}</span>
                          <span style={{ fontSize:9, fontFamily:'JetBrains Mono, monospace', color:'var(--text-3)' }}>{confidence}%</span>
                        </motion.div>
                      </>
                    )}
                    <div style={{ width:1, height:28, background:'var(--border)' }} />
                    <AlertasPanel
                      currentSymbol={currentSymbol}
                      currentPrice={marketData[currentSymbol]?.price}
                    />
                  </div>
                </div>

                {/* Chart */}
                <div style={{ flex:1, overflow:'hidden', minHeight:0 }}>
                  <ErrorBoundary fallback="Error en el chart">
                    <ChartPanel symbol={currentSymbol} insight={insight} />
                  </ErrorBoundary>
                </div>

                {/* Status bar */}
                <div style={{ height:62, background:'var(--bg-panel)', borderTop:'1px solid var(--border)', display:'flex', alignItems:'center', gap:0, flexShrink:0, overflow:'hidden' }}>
                  {posicionActual ? (
                    <div style={{ display:'flex', alignItems:'center', gap:16, padding:'0 20px', borderRight:'1px solid var(--border)', height:'100%' }}>
                      <div>
                        <div style={{ fontSize:9, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace', marginBottom:2 }}>POSICIÓN · {currentSymbol.replace('USDT','')}</div>
                        <div style={{ fontSize:11, fontWeight:600, color:'var(--text-1)', fontFamily:'JetBrains Mono, monospace' }}>${precioActual.toLocaleString('en', { maximumFractionDigits: 2 })}</div>
                      </div>
                      <div>
                        <div style={{ fontSize:9, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace', marginBottom:2 }}>P&amp;L</div>
                        <motion.div animate={{ color: pnlEuros >= 0 ? '#00d060' : '#ff3b3b' }} style={{ fontSize:13, fontWeight:700, fontFamily:'JetBrains Mono, monospace' }}>
                          {pnlEuros >= 0 ? '+' : ''}{pnlEuros.toFixed(2)}€
                          <span style={{ fontSize:9, marginLeft:4, opacity:0.7 }}>({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
                        </motion.div>
                      </div>
                      <div>
                        <div style={{ fontSize:9, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace', marginBottom:2 }}>STOP</div>
                        <div style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color:'var(--text-3)' }}>${posicionActual.stopLoss.toLocaleString('en', { maximumFractionDigits: 4 })}</div>
                      </div>
                      <div>
                        <div style={{ fontSize:9, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace', marginBottom:2 }}>TARGET</div>
                        <div style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color:'var(--text-3)' }}>${posicionActual.targetPrice.toLocaleString('en', { maximumFractionDigits: 4 })}</div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display:'flex', alignItems:'center', padding:'0 20px', borderRight:'1px solid var(--border)', height:'100%' }}>
                      <span style={{ fontSize:10, color:'var(--text-5)', fontFamily:'JetBrains Mono, monospace' }}>Sin posición abierta en {currentSymbol.replace('USDT','')}</span>
                    </div>
                  )}
                  <div style={{ display:'flex', alignItems:'center', gap:12, padding:'0 20px', height:'100%' }}>
                    <motion.button
                      whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}
                      onClick={estadoAgente.activo ? pausar : activar}
                      style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:7, background: estadoAgente.activo ? 'rgba(0,208,96,0.08)' : 'var(--bg-input)', border: `1px solid ${estadoAgente.activo ? 'rgba(0,208,96,0.2)' : 'var(--border-2)'}`, color: estadoAgente.activo ? 'var(--green)' : 'var(--text-4)', fontSize:10, fontFamily:'JetBrains Mono, monospace', cursor:'pointer', letterSpacing:'0.5px', boxShadow: estadoAgente.activo ? '0 0 10px rgba(0,208,96,0.12)' : 'none', transition: 'all var(--transition)' }}
                    >
                      <Power size={11} strokeWidth={2} />
                      AGENTE · {estadoAgente.activo ? 'ON' : 'OFF'}
                    </motion.button>
                    {estadoAgente.activo && (
                      <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <Activity size={10} color="var(--green)" />
                        <span style={{ fontSize:9, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace' }}>
                          {Object.values(estadoAgente.posicionesAbiertas).length} pos · {estadoAgente.log[0]?.mensaje?.slice(0,38) || 'vigilando'}
                        </span>
                      </motion.div>
                    )}
                  </div>
                  <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8, padding:'0 14px', flexShrink:0 }}>
                    <TrendingRadar onSymbolClick={setCurrentSymbol} />
                    <AnimatePresence>
                      {alertFlash && (
                        <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                          <div style={{ fontSize:9, color:'var(--green)', fontFamily:'JetBrains Mono, monospace', background:'rgba(0,208,96,0.08)', border:'1px solid rgba(0,208,96,0.2)', padding:'4px 10px', borderRadius:6, boxShadow:'0 0 12px rgba(0,208,96,0.2)', animation: 'pulse 1s infinite' }}>
                            SEÑAL COMPRA DETECTADA
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              {/* RIGHT: BT chat */}
              <div style={{ width:400, flexShrink:0, borderLeft:'1px solid var(--border)' }}>
                <ErrorBoundary fallback="Error en BT">
                  <ChatPanel
                    onAction={(a) => {
                      if (a.action === 'change_symbol' && a.symbol) setCurrentSymbol(a.symbol)
                    }}
                  />
                </ErrorBoundary>
              </div>
            </>
          )}

          {/* ── PORTFOLIO TAB ─────────────────────────────────────────────── */}
          {activeTab === 'PORTFOLIO' && (
            <div style={{ flex:1, overflowY:'auto' }}>
              <ErrorBoundary fallback="Error en portfolio">
                <Portfolio user={user} marketData={marketData} />
              </ErrorBoundary>
            </div>
          )}

          {/* ── BOT TAB ───────────────────────────────────────────────────── */}
          {activeTab === 'BOT' && (
            <div style={{ flex:1, overflowY:'auto' }}>
              <AgentePanel
                estadoAgente={estadoAgente}
                marketData={marketData}
                onActivar={activar}
                onPausar={pausar}
              />
            </div>
          )}

          {/* ── CONFIG TAB ────────────────────────────────────────────────── */}
          {activeTab === 'CONFIG' && (
            <div style={{ flex:1, overflowY:'auto', padding:'24px 32px' }}>
              <Settings />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Panel del Agente Autónomo ────────────────────────────────────────────────

function AgentePanel({
  estadoAgente, marketData, onActivar, onPausar
}: {
  estadoAgente: any
  marketData: Record<string, any>
  onActivar: () => void
  onPausar: () => void
}) {
  const posiciones: [string, PosicionAbierta][] = Object.entries(estadoAgente.posicionesAbiertas)
  const log: EntradaLog[] = estadoAgente.log ?? []

  const totalInvertido = posiciones.reduce((acc, [, p]) => acc + p.invertido, 0)
  const totalPnl = posiciones.reduce((acc, [sym, p]) => {
    const precio = marketData[sym]?.price ?? p.precio
    return acc + (precio - p.precio) * p.cantidad
  }, 0)

  return (
    <div style={{ padding:'32px 36px', fontFamily:'Inter, sans-serif', color:'#fff' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:28 }}>
        <div>
          <h2 style={{ margin:0, fontSize:20, fontWeight:700, letterSpacing:'-0.5px' }}>Agente Autónomo</h2>
          <p style={{ margin:'4px 0 0', fontSize:11, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace' }}>
            Simulador de trading en tiempo real
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
          onClick={estadoAgente.activo ? onPausar : onActivar}
          style={{
            display:'flex', alignItems:'center', gap:8, padding:'10px 20px', borderRadius:10,
            background: estadoAgente.activo ? 'rgba(255,59,59,0.1)' : 'rgba(0,208,96,0.1)',
            border: `1px solid ${estadoAgente.activo ? 'rgba(255,59,59,0.3)' : 'rgba(0,208,96,0.3)'}`,
            color: estadoAgente.activo ? '#ff6b6b' : '#00d060',
            fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'JetBrains Mono, monospace',
            letterSpacing:'0.5px',
          }}
        >
          <Power size={14} strokeWidth={2} />
          {estadoAgente.activo ? 'PAUSAR AGENTE' : 'ACTIVAR AGENTE'}
        </motion.button>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:28 }}>
        {[
          { label:'Estado', value: estadoAgente.activo ? '● Activo' : '○ Pausado', color: estadoAgente.activo ? '#00d060' : 'var(--text-4)' },
          { label:'Posiciones abiertas', value: String(posiciones.length), color:'var(--text-1)' },
          { label:'Total invertido', value: `$${totalInvertido.toFixed(2)}`, color:'var(--text-1)' },
          { label:'P&L agente', value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? '#00d060' : '#ff3b3b' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background:'#091220', border:'1px solid #111e35', borderRadius:14, padding:'18px 20px' }}>
            <div style={{ fontSize:10, color:'var(--text-4)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:10 }}>{label}</div>
            <div style={{ fontSize:22, fontWeight:700, letterSpacing:'-0.5px', color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Posiciones abiertas */}
      <div style={{ marginBottom:28 }}>
        <p style={{ fontSize:9, fontFamily:'JetBrains Mono, monospace', color:'var(--text-5)', letterSpacing:'2px', textTransform:'uppercase', margin:'0 0 12px' }}>
          Posiciones abiertas en tiempo real
        </p>
        {posiciones.length === 0 ? (
          <div style={{ background:'#091220', border:'1px solid #111e35', borderRadius:14, padding:'28px 24px', textAlign:'center', fontSize:12, color:'var(--text-5)', fontFamily:'JetBrains Mono, monospace' }}>
            El agente no tiene posiciones abiertas. Actívalo para que empiece a operar.
          </div>
        ) : (
          <div style={{ background:'#091220', border:'1px solid #111e35', borderRadius:14, overflow:'hidden' }}>
            {/* Cabecera tabla */}
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr 1fr 1fr', padding:'10px 20px', borderBottom:'1px solid #111e35', fontSize:9, color:'var(--text-5)', fontFamily:'JetBrains Mono, monospace', letterSpacing:'1px', textTransform:'uppercase' }}>
              <span>Activo</span><span style={{ textAlign:'right' }}>Entrada</span><span style={{ textAlign:'right' }}>Actual</span>
              <span style={{ textAlign:'right' }}>P&L $</span><span style={{ textAlign:'right' }}>P&L %</span>
              <span style={{ textAlign:'right' }}>Stop</span><span style={{ textAlign:'right' }}>Target</span>
            </div>
            {posiciones.map(([sym, pos], i) => {
              const precioActual = marketData[sym]?.price ?? pos.precio
              const pnl = (precioActual - pos.precio) * pos.cantidad
              const pnlPct = pos.precio > 0 ? ((precioActual - pos.precio) / pos.precio) * 100 : 0
              const ganando = pnl >= 0
              const enStop = precioActual <= pos.stopLoss
              return (
                <motion.div
                  key={sym}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{
                    display:'grid', gridTemplateColumns:'1.5fr 1fr 1fr 1fr 1fr 1fr 1fr',
                    padding:'14px 20px', alignItems:'center',
                    borderBottom: i < posiciones.length - 1 ? '1px solid #0e0e0e' : 'none',
                    background: enStop ? 'rgba(255,59,59,0.04)' : ganando ? 'rgba(0,208,96,0.02)' : 'transparent',
                  }}
                >
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:32, height:32, borderRadius:'50%', background:'#111e35', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'var(--text-3)', flexShrink:0 }}>
                      {sym.replace('USDT','').slice(0,2)}
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600 }}>{sym.replace('USDT','')}</div>
                      <div style={{ fontSize:9, color:'var(--text-5)', fontFamily:'JetBrains Mono, monospace' }}>{pos.cantidad.toFixed(6)}</div>
                    </div>
                    {enStop && <AlertTriangle size={12} color="#ff3b3b" style={{ flexShrink:0 }} />}
                  </div>
                  <div style={{ textAlign:'right', fontSize:11, fontFamily:'JetBrains Mono, monospace', color:'var(--text-3)' }}>
                    ${pos.precio.toLocaleString('en', { maximumFractionDigits: 4 })}
                  </div>
                  <div style={{ textAlign:'right', fontSize:11, fontFamily:'JetBrains Mono, monospace', color:'var(--text-1)', fontWeight:600 }}>
                    ${precioActual.toLocaleString('en', { maximumFractionDigits: 4 })}
                  </div>
                  <div style={{ textAlign:'right', fontSize:12, fontFamily:'JetBrains Mono, monospace', fontWeight:700, color: ganando ? '#00d060' : '#ff3b3b' }}>
                    {ganando ? '+' : ''}{pnl.toFixed(2)}
                  </div>
                  <div style={{ textAlign:'right', display:'flex', alignItems:'center', justifyContent:'flex-end', gap:4 }}>
                    {ganando ? <TrendingUp size={11} color="#00d060" /> : <TrendingDown size={11} color="#ff3b3b" />}
                    <span style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color: ganando ? '#00d060' : '#ff3b3b' }}>
                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ textAlign:'right', fontSize:10, fontFamily:'JetBrains Mono, monospace', color:'#ff6b6b' }}>
                    ${pos.stopLoss.toLocaleString('en', { maximumFractionDigits: 4 })}
                  </div>
                  <div style={{ textAlign:'right', fontSize:10, fontFamily:'JetBrains Mono, monospace', color:'#00d060' }}>
                    ${pos.targetPrice.toLocaleString('en', { maximumFractionDigits: 4 })}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* Log de decisiones */}
      <div>
        <p style={{ fontSize:9, fontFamily:'JetBrains Mono, monospace', color:'var(--text-5)', letterSpacing:'2px', textTransform:'uppercase', margin:'0 0 12px' }}>
          Registro de decisiones
        </p>
        {log.length === 0 ? (
          <div style={{ background:'#091220', border:'1px solid #111e35', borderRadius:14, padding:'20px 24px', textAlign:'center', fontSize:11, color:'var(--text-5)', fontFamily:'JetBrains Mono, monospace' }}>
            Sin actividad registrada aún.
          </div>
        ) : (
          <div style={{ background:'#091220', border:'1px solid #111e35', borderRadius:14, overflow:'hidden', maxHeight:320, overflowY:'auto' }}>
            {log.slice(0, 20).map((entrada, i) => {
              const esBuy  = entrada.accion?.includes('COMPRA') || entrada.accion?.includes('BUY')
              const esSell = entrada.accion?.includes('VENTA') || entrada.accion?.includes('SELL')
              const color  = esBuy ? '#00d060' : esSell ? '#ff6b6b' : 'var(--text-4)'
              return (
                <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'10px 20px', borderBottom: i < log.length - 1 ? '1px solid #0a1020' : 'none' }}>
                  <div style={{ width:6, height:6, borderRadius:'50%', background:color, flexShrink:0, marginTop:5 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
                      <span style={{ fontSize:10, fontWeight:600, fontFamily:'JetBrains Mono, monospace', color }}>
                        {entrada.symbol?.replace('USDT','')} · {entrada.accion}
                      </span>
                      {entrada.precio > 0 && (
                        <span style={{ fontSize:9, color:'var(--text-5)', fontFamily:'JetBrains Mono, monospace' }}>
                          ${entrada.precio.toLocaleString('en', { maximumFractionDigits: 4 })}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:11, color:'var(--text-3)', lineHeight:1.4 }}>
                      {entrada.motivo}
                    </div>
                  </div>
                  <div style={{ fontSize:9, color:'var(--text-5)', fontFamily:'JetBrains Mono, monospace', flexShrink:0 }}>
                    {new Date(entrada.timestamp).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Config por símbolo */}
      <div style={{ marginTop:28 }}>
        <p style={{ fontSize:9, fontFamily:'JetBrains Mono, monospace', color:'var(--text-5)', letterSpacing:'2px', textTransform:'uppercase', margin:'0 0 12px' }}>
          Configuración por activo
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10 }}>
          {Object.entries(estadoAgente.configuracion ?? {}).map(([sym, cfg]: [string, any]) => (
            <div key={sym} style={{ background:'#091220', border:`1px solid ${cfg.activo ? 'rgba(0,208,96,0.2)' : '#111e35'}`, borderRadius:12, padding:'14px 16px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <span style={{ fontSize:12, fontWeight:700 }}>{sym.replace('USDT','')}</span>
                <span style={{ fontSize:9, fontFamily:'JetBrains Mono, monospace', padding:'2px 7px', borderRadius:4, color: cfg.activo ? '#00d060' : 'var(--text-5)', background: cfg.activo ? 'rgba(0,208,96,0.08)' : '#0d1a2e', border: `1px solid ${cfg.activo ? 'rgba(0,208,96,0.2)' : '#1a2840'}` }}>
                  {cfg.activo ? 'ON' : 'OFF'}
                </span>
              </div>
              <div style={{ display:'flex', gap:12 }}>
                <div>
                  <div style={{ fontSize:9, color:'var(--text-5)', fontFamily:'JetBrains Mono, monospace', marginBottom:2 }}>Tamaño</div>
                  <div style={{ fontSize:12, fontFamily:'JetBrains Mono, monospace' }}>${cfg.cantidadMaxima}</div>
                </div>
                <div>
                  <div style={{ fontSize:9, color:'var(--text-5)', fontFamily:'JetBrains Mono, monospace', marginBottom:2 }}>Umbral</div>
                  <div style={{ fontSize:12, fontFamily:'JetBrains Mono, monospace' }}>{cfg.umbralConfianza}%</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
