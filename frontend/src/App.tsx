import { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, Power } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiClient, aiClient, API_PRICE } from './api'
import Header from './components/shared/Header'
import ChartPanel from './components/terminal/ChartPanel'
import Login from './components/Login'
import LoadingSplash from './components/shared/LoadingSplash'
import ErrorBoundary from './components/shared/ErrorBoundary'
import ChatPanel from './components/chat/ChatPanel'
import { useAgenteAutonomo } from './hooks/useAgenteAutonomo'
import Settings from './components/configuracion/Settings'

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
  const [showSettings, setShowSettings] = useState(false)
  const [sseConnected, setSseConnected] = useState(false)
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
        onSettingsOpen={() => setShowSettings(true)}
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

        {/* ── LEFT ──────────────────────────────────────────────────────────── */}
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

            {/* AI signal chip */}
            {insight && confidence !== null && (
              <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8, padding:'0 16px', flexShrink:0 }}>
                <div style={{ width:1, height:28, background:'var(--border)' }} />
                <motion.div
                  animate={isBuy ? { boxShadow: ['0 0 8px rgba(0,208,96,0.2)', '0 0 16px rgba(0,208,96,0.4)', '0 0 8px rgba(0,208,96,0.2)'] } : {}}
                  transition={{ duration: 2, repeat: Infinity }}
                  style={{
                    display:'flex', alignItems:'center', gap:6,
                    padding:'5px 12px', borderRadius:7,
                    background: isBuy ? 'rgba(0,208,96,0.08)' : 'rgba(99,102,241,0.06)',
                    border: `1px solid ${isBuy ? 'rgba(0,208,96,0.2)' : 'rgba(99,102,241,0.15)'}`,
                  }}
                >
                  <span style={{ fontSize:8, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace', letterSpacing:'1px' }}>BT·IA</span>
                  <span style={{ fontSize:10, fontWeight:700, color: isBuy ? 'var(--green)' : 'var(--indigo)' }}>
                    {insight.signal}
                  </span>
                  <span style={{ fontSize:9, fontFamily:'JetBrains Mono, monospace', color:'var(--text-3)' }}>{confidence}%</span>
                </motion.div>
              </div>
            )}
          </div>

          {/* Chart */}
          <div style={{ flex:1, overflow:'hidden', minHeight:0 }}>
            <ErrorBoundary fallback="Error en el chart">
              <ChartPanel symbol={currentSymbol} insight={insight} />
            </ErrorBoundary>
          </div>

          {/* Status bar */}
          <div style={{ height:62, background:'var(--bg-panel)', borderTop:'1px solid var(--border)', display:'flex', alignItems:'center', gap:0, flexShrink:0, overflow:'hidden' }}>

            {/* Position info */}
            {posicionActual ? (
              <div style={{ display:'flex', alignItems:'center', gap:16, padding:'0 20px', borderRight:'1px solid var(--border)', height:'100%' }}>
                <div>
                  <div style={{ fontSize:9, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace', marginBottom:2 }}>POSICIÓN · {currentSymbol.replace('USDT','')}</div>
                  <div style={{ fontSize:11, fontWeight:600, color:'var(--text-1)', fontFamily:'JetBrains Mono, monospace' }}>
                    ${precioActual.toLocaleString('en', { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:9, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace', marginBottom:2 }}>P&amp;L</div>
                  <motion.div
                    animate={{ color: pnlEuros >= 0 ? '#00d060' : '#ff3b3b' }}
                    style={{ fontSize:13, fontWeight:700, fontFamily:'JetBrains Mono, monospace' }}
                  >
                    {pnlEuros >= 0 ? '+' : ''}{pnlEuros.toFixed(2)}€
                    <span style={{ fontSize:9, marginLeft:4, opacity:0.7 }}>({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
                  </motion.div>
                </div>
                <div>
                  <div style={{ fontSize:9, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace', marginBottom:2 }}>STOP</div>
                  <div style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color:'var(--text-3)' }}>
                    ${posicionActual.stopLoss.toLocaleString('en', { maximumFractionDigits: 4 })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:9, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace', marginBottom:2 }}>TARGET</div>
                  <div style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color:'var(--text-3)' }}>
                    ${posicionActual.targetPrice.toLocaleString('en', { maximumFractionDigits: 4 })}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', padding:'0 20px', borderRight:'1px solid var(--border)', height:'100%' }}>
                <span style={{ fontSize:10, color:'var(--text-5)', fontFamily:'JetBrains Mono, monospace' }}>
                  Sin posición abierta en {currentSymbol.replace('USDT','')}
                </span>
              </div>
            )}

            {/* Agent toggle */}
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'0 20px', height:'100%' }}>
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                onClick={estadoAgente.activo ? pausar : activar}
                style={{
                  display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:7,
                  background: estadoAgente.activo ? 'rgba(0,208,96,0.08)' : 'var(--bg-input)',
                  border: `1px solid ${estadoAgente.activo ? 'rgba(0,208,96,0.2)' : 'var(--border-2)'}`,
                  color: estadoAgente.activo ? 'var(--green)' : 'var(--text-4)',
                  fontSize:10, fontFamily:'JetBrains Mono, monospace', cursor:'pointer', letterSpacing:'0.5px',
                  boxShadow: estadoAgente.activo ? '0 0 10px rgba(0,208,96,0.12)' : 'none',
                  transition: 'all var(--transition)',
                }}
              >
                <Power size={11} strokeWidth={2} />
                AGENTE · {estadoAgente.activo ? 'ON' : 'OFF'}
              </motion.button>

              {estadoAgente.activo && (
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  style={{ display:'flex', alignItems:'center', gap:6 }}
                >
                  <Activity size={10} color="var(--green)" />
                  <span style={{ fontSize:9, color:'var(--text-4)', fontFamily:'JetBrains Mono, monospace' }}>
                    {Object.values(estadoAgente.posicionesAbiertas).length} pos · {estadoAgente.log[0]?.mensaje?.slice(0,38) || 'vigilando'}
                  </span>
                </motion.div>
              )}
            </div>

            {/* Buy signal flash */}
            <AnimatePresence>
              {alertFlash && (
                <motion.div
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  style={{ marginLeft:'auto', padding:'0 20px', flexShrink:0 }}
                >
                  <div style={{
                    fontSize:9, color:'var(--green)', fontFamily:'JetBrains Mono, monospace',
                    background:'rgba(0,208,96,0.08)', border:'1px solid rgba(0,208,96,0.2)',
                    padding:'4px 10px', borderRadius:6,
                    boxShadow:'0 0 12px rgba(0,208,96,0.2)',
                    animation: 'pulse 1s infinite',
                  }}>
                    SEÑAL COMPRA DETECTADA
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── RIGHT: BT chat ──────────────────────────────────────────────── */}
        <div style={{ width:400, flexShrink:0, borderLeft:'1px solid var(--border)' }}>
          <ErrorBoundary fallback="Error en BT">
            <ChatPanel
              onAction={(a) => {
                if (a.action === 'change_symbol' && a.symbol) setCurrentSymbol(a.symbol)
              }}
            />
          </ErrorBoundary>
        </div>
      </div>

      {/* Settings overlay */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSettings(false)}
            style={{
              position:'fixed', inset:0, zIndex:200,
              background:'rgba(4,10,24,0.82)', backdropFilter:'blur(4px)',
              display:'flex', alignItems:'flex-start', justifyContent:'flex-end',
            }}
          >
            <motion.div
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 30 } }}
              exit={{ x: '100%', opacity: 0, transition: { duration: 0.2 } }}
              onClick={e => e.stopPropagation()}
              style={{
                width:560, height:'100%', background:'var(--bg-base)',
                borderLeft:'1px solid var(--border)', overflowY:'auto',
              }}
            >
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 24px 14px', borderBottom:'1px solid var(--border)' }}>
                <span style={{ fontSize:11, fontFamily:'JetBrains Mono, monospace', color:'var(--text-4)', letterSpacing:'2px', textTransform:'uppercase' }}>Configuración</span>
                <motion.button
                  whileHover={{ background: 'rgba(255,59,59,0.08)' }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setShowSettings(false)}
                  style={{ background:'none', border:'1px solid var(--border-2)', borderRadius:7, color:'var(--text-3)', cursor:'pointer', padding:'5px 10px', fontSize:11, fontFamily:'JetBrains Mono, monospace', transition: 'all var(--transition)' }}
                >
                  ESC
                </motion.button>
              </div>
              <Settings
                setRefreshInterval={setRefreshInterval}
                currentInterval={refreshInterval}
                aiHealth={aiHealth}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
