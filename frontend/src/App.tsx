import { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, Power } from 'lucide-react'
import { apiClient, aiClient, API_PRICE } from './api'
import Header from './components/shared/Header'
import ChartPanel from './components/terminal/ChartPanel'
import Login from './components/Login'
import LoadingSplash from './components/shared/LoadingSplash'
import ErrorBoundary from './components/shared/ErrorBoundary'
import ChatPanel from './components/chat/ChatPanel'
import { useAgenteAutonomo } from './hooks/useAgenteAutonomo'
import Settings from './components/configuracion/Settings'

const MAIN_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'TRUMPUSDT', 'PEPEUSDT', 'DOGEUSDT', 'SHIBUSDT']

export default function App() {
  const [loading, setLoading]         = useState(true)
  const [isLoggedIn, setIsLoggedIn]   = useState(() => { try { return !!localStorage.getItem('token') } catch { return false } })
  const [currentSymbol, setCurrentSymbol] = useState('BTCUSDT')
  const [user, setUser] = useState(() => {
    try {
      return {
        name:    localStorage.getItem('userName') || '',
        plan:    localStorage.getItem('userPlan') || 'PRO ELITE',
        balance: parseFloat(localStorage.getItem('userBalance') || '12500.50')
      }
    } catch {
      return { name: '', plan: 'PRO ELITE', balance: 12500.50 }
    }
  })

  const [marketData, setMarketData]   = useState<Record<string, any>>({})
  const [aiInsights, setAiInsights]   = useState<Record<string, any>>({})
  const [tradeHistory, setTradeHistory] = useState<any[]>([])
  const [refreshInterval, setRefreshInterval] = useState(3000)
  const [alertFlash, setAlertFlash]   = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [sseConnected, setSseConnected] = useState(false)
  const [dataError, setDataError]     = useState<string | null>(null)
  const [aiHealth, setAiHealth]       = useState<{ lstm: boolean; finbert: boolean } | null>(null)
const historyRef          = useRef<Record<string, number[]>>({})
  const volumesRef          = useRef<Record<string, number[]>>({})
  const currentSymRef       = useRef(currentSymbol)
  const pollingErrorCount   = useRef(0)
  const aiCooldownRef  = useRef<Record<string, number>>({})
  const reconnectCount = useRef(0)

  // ─── Agente autónomo ───────────────────────────────────────────────────────
  const { estado: estadoAgente, activar, pausar, procesarTick, alertasStopLoss } = useAgenteAutonomo()

  useEffect(() => { currentSymRef.current = currentSymbol }, [currentSymbol])

  // Splash screen
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 1500)
    return () => clearTimeout(t)
  }, [])

  // Escuchar evento de sesión expirada del interceptor de axios
  useEffect(() => {
    const handler = () => handleLogout()
    window.addEventListener('session-expired', handler)
    return () => window.removeEventListener('session-expired', handler)
  }, [])

  // Verificar salud del AI engine al iniciar sesión
  useEffect(() => {
    if (!isLoggedIn || loading) return
    aiClient.get('/health')
      .then(res => setAiHealth({ lstm: res.data.lstm, finbert: res.data.finbert }))
      .catch(() => setAiHealth({ lstm: false, finbert: false }))
  }, [isLoggedIn, loading])

  // ─── Lógica AI ─────────────────────────────────────────────────────────────
  const fetchAiInsight = useCallback(async (
    symbol: string,
    price: number,
    history?: number[],
    volumes?: number[]
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

      // Filtro correlación BTC (issue #27): calcular variación % de BTC en última vela
      const btcHistory = historyRef.current['BTCUSDT'] ?? []
      const btcPriceChange = btcHistory.length >= 2
        ? (btcHistory[btcHistory.length - 1] - btcHistory[btcHistory.length - 2]) / btcHistory[btcHistory.length - 2]
        : 0

      // Llamar al agente autónomo para decidir si operar
      procesarTick(symbol, price, insight, btcPriceChange)

      if (symbol === currentSymRef.current && insight?.signal?.includes('COMPRAR')) {
        setAlertFlash(true)
        setTimeout(() => setAlertFlash(false), 2000)

        setTradeHistory(prev => [{
          id:         Date.now(),
          symbol,
          price,
          signal:     insight.signal,
          confidence: insight.confidence,
          timestamp:  new Date().toISOString()
        }, ...prev].slice(0, 50))
      }
    } catch (e: any) {
      if (import.meta.env.DEV) console.error(`[AI] ${symbol}:`, e?.message)
    }
  }, [procesarTick])

  // ─── SSE para precios en tiempo real ────────────────────────────────────────
  useEffect(() => {
    if (!isLoggedIn || loading) return

    let es: EventSource | null = null
    let fallbackTimer: ReturnType<typeof setInterval> | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let destroyed = false

    const processTickBatch = (rawData: Record<string, { price: string; volume: string }>) => {
      // Capturar datos calculados ANTES del updater para evitar race conditions
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

        // Actualizar refs con los datos de este tick — snapshot estable para la IA
        historyRef.current[symbol] = newHistory
        volumesRef.current[symbol] = newVolumes

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
          const changePct  = prevPrice > 0
            ? (((price - prevPrice) / prevPrice) * 100).toFixed(2) : '0.00'
          const changeStr  = parseFloat(changePct) >= 0 ? `+${changePct}%` : `${changePct}%`
          updated[symbol]  = { price, history: newHistory, volumes: newVolumes, change: changeStr }
        }
        return updated
      })

      // Llamar a la IA con los datos capturados en este tick (fuera del updater)
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
          if (import.meta.env.DEV) console.warn('[SSE] Error procesando mensaje:', e)
        }
      }

      es.onerror = () => {
        if (destroyed) return
        setSseConnected(false)
        es?.close()
        es = null

        // Fallback: polling REST mientras SSE está caído
        if (!fallbackTimer) {
          fallbackTimer = setInterval(async () => {
            try {
              const res = await apiClient.get('/prices')
              processTickBatch(res.data)
              pollingErrorCount.current = 0
              setDataError(null)
            } catch (e) {
              pollingErrorCount.current += 1
              if (import.meta.env.DEV) console.warn('[Polling] Error:', e)
              if (pollingErrorCount.current >= 3) {
                setDataError('Sin datos de mercado. Verifica la conexión con market-service.')
              }
            }
          }, refreshInterval)
        }

        // Reconexión con backoff exponencial
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
  }, [isLoggedIn, loading, refreshInterval, fetchAiInsight])

  // ─── Auth ──────────────────────────────────────────────────────────────────
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


  // ─── Render ────────────────────────────────────────────────────────────────
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
    const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace('%', ''), 10)
    return isNaN(n) ? null : Math.max(0, Math.min(100, n))
  })()

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', width:'100vw', background:'#060d1a', color:'#c8d8ec', overflow:'hidden' }}>

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

      {dataError && (
        <div style={{ background:'rgba(255,59,59,0.08)', borderBottom:'1px solid rgba(255,59,59,0.2)', padding:'5px 20px', fontSize:'11px', color:'#ff6b6b', display:'flex', alignItems:'center', gap:'8px', flexShrink:0 }}>
          <span style={{ width:'6px', height:'6px', borderRadius:'50%', background:'#ff3b3b', flexShrink:0 }} />
          {dataError}
        </div>
      )}

      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>

        {/* ── LEFT: chart + ticker + status ──────────────────────────────── */}
        <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {/* Ticker strip */}
          <div style={{ height:'54px', background:'#07101e', borderBottom:'1px solid #111e35', display:'flex', alignItems:'stretch', overflowX:'auto', flexShrink:0 }}>
            {MAIN_COINS.map(sym => {
              const d      = marketData[sym]
              const p      = d?.price ?? 0
              const ch     = d?.change || '+0.00%'
              const up     = !ch.startsWith('-')
              const name   = sym.replace('USDT', '')
              const active = sym === currentSymbol
              return (
                <button key={sym} onClick={() => setCurrentSymbol(sym)} style={{
                  display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'flex-start',
                  padding:'0 14px', border:'none', cursor:'pointer', flexShrink:0,
                  background: active ? 'rgba(99,102,241,0.1)' : 'transparent',
                  borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
                  transition:'all 0.15s',
                }}>
                  <span style={{ fontSize:'9px', color:'#2c4268', fontFamily:'JetBrains Mono, monospace', letterSpacing:'0.5px', marginBottom:'2px' }}>{name}</span>
                  <span style={{ fontSize:'11px', fontWeight:600, fontFamily:'JetBrains Mono, monospace', color: active ? '#c8d8ec' : '#7890b0' }}>
                    {p > 0 ? p.toLocaleString('en', { maximumFractionDigits: p < 1 ? 6 : 2 }) : '—'}
                  </span>
                  <span style={{ fontSize:'9px', fontFamily:'JetBrains Mono, monospace', color: up ? '#00d060' : '#ff3b3b' }}>{ch}</span>
                </button>
              )
            })}

            {/* Separador + chip señal IA */}
            {insight && confidence !== null && (
              <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'8px', padding:'0 16px', flexShrink:0 }}>
                <div style={{ width:'1px', height:'28px', background:'#111e35' }} />
                <div style={{
                  display:'flex', alignItems:'center', gap:'6px',
                  padding:'5px 12px', borderRadius:'7px',
                  background: isBuy ? 'rgba(0,208,96,0.08)' : 'rgba(99,102,241,0.06)',
                  border: `1px solid ${isBuy ? 'rgba(0,208,96,0.2)' : 'rgba(99,102,241,0.15)'}`,
                }}>
                  <span style={{ fontSize:'8px', color:'#2c4268', fontFamily:'JetBrains Mono, monospace', letterSpacing:'1px' }}>BT·IA</span>
                  <span style={{ fontSize:'10px', fontWeight:700, color: isBuy ? '#00d060' : '#818cf8' }}>
                    {insight.signal}
                  </span>
                  <span style={{ fontSize:'9px', fontFamily:'JetBrains Mono, monospace', color:'#486080' }}>{confidence}%</span>
                </div>
              </div>
            )}
          </div>

          {/* Chart principal */}
          <div style={{ flex:1, overflow:'hidden', minHeight:0 }}>
            <ErrorBoundary fallback="Error en el chart">
              <ChartPanel symbol={currentSymbol} insight={insight} />
            </ErrorBoundary>
          </div>

          {/* Status bar — posición + agente */}
          <div style={{ height:'64px', background:'#07101e', borderTop:'1px solid #111e35', display:'flex', alignItems:'center', gap:'0', flexShrink:0, overflow:'hidden' }}>

            {/* Posición activa */}
            {posicionActual ? (
              <div style={{ display:'flex', alignItems:'center', gap:'16px', padding:'0 20px', borderRight:'1px solid #111e35', height:'100%' }}>
                <div>
                  <div style={{ fontSize:'9px', color:'#2c4268', fontFamily:'JetBrains Mono, monospace', marginBottom:'2px' }}>POSICIÓN · {currentSymbol.replace('USDT','')}</div>
                  <div style={{ fontSize:'11px', fontWeight:600, color:'#c8d8ec', fontFamily:'JetBrains Mono, monospace' }}>
                    ${precioActual.toLocaleString('en', { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:'9px', color:'#2c4268', fontFamily:'JetBrains Mono, monospace', marginBottom:'2px' }}>P&L</div>
                  <div style={{ fontSize:'13px', fontWeight:700, color: pnlEuros >= 0 ? '#00d060' : '#ff3b3b', fontFamily:'JetBrains Mono, monospace' }}>
                    {pnlEuros >= 0 ? '+' : ''}{pnlEuros.toFixed(2)}€
                    <span style={{ fontSize:'9px', marginLeft:'4px' }}>({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:'9px', color:'#2c4268', fontFamily:'JetBrains Mono, monospace', marginBottom:'2px' }}>STOP</div>
                  <div style={{ fontSize:'11px', fontFamily:'JetBrains Mono, monospace', color:'#486080' }}>
                    ${posicionActual.stopLoss.toLocaleString('en', { maximumFractionDigits: 4 })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:'9px', color:'#2c4268', fontFamily:'JetBrains Mono, monospace', marginBottom:'2px' }}>TARGET</div>
                  <div style={{ fontSize:'11px', fontFamily:'JetBrains Mono, monospace', color:'#486080' }}>
                    ${posicionActual.targetPrice.toLocaleString('en', { maximumFractionDigits: 4 })}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', padding:'0 20px', borderRight:'1px solid #111e35', height:'100%' }}>
                <span style={{ fontSize:'10px', color:'#1e3050', fontFamily:'JetBrains Mono, monospace' }}>Sin posición abierta en {currentSymbol.replace('USDT','')}</span>
              </div>
            )}

            {/* Estado agente */}
            <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'0 20px', height:'100%' }}>
              <button
                onClick={estadoAgente.activo ? pausar : activar}
                style={{
                  display:'flex', alignItems:'center', gap:'6px', padding:'6px 12px', borderRadius:'7px',
                  background: estadoAgente.activo ? 'rgba(0,208,96,0.08)' : '#0b1424',
                  border: `1px solid ${estadoAgente.activo ? 'rgba(0,208,96,0.2)' : '#1a2840'}`,
                  color: estadoAgente.activo ? '#00d060' : '#2c4268',
                  fontSize:'10px', fontFamily:'JetBrains Mono, monospace', cursor:'pointer', letterSpacing:'0.5px',
                }}
              >
                <Power size={11} strokeWidth={2} />
                AGENTE · {estadoAgente.activo ? 'ON' : 'OFF'}
              </button>
              {estadoAgente.activo && (
                <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                  <Activity size={10} color="#00d060" />
                  <span style={{ fontSize:'9px', color:'#2c4268', fontFamily:'JetBrains Mono, monospace' }}>
                    {Object.values(estadoAgente.posicionesAbiertas).length} pos · {estadoAgente.log[0]?.mensaje?.slice(0,40) || 'vigilando'}
                  </span>
                </div>
              )}
            </div>

            {/* Historial reciente rápido */}
            {alertFlash && (
              <div style={{ marginLeft:'auto', padding:'0 20px', flexShrink:0 }}>
                <div style={{ fontSize:'9px', color:'#00d060', fontFamily:'JetBrains Mono, monospace', background:'rgba(0,208,96,0.08)', border:'1px solid rgba(0,208,96,0.2)', padding:'4px 10px', borderRadius:'6px', animation:'pulse 1s infinite' }}>
                  SEÑAL COMPRA DETECTADA
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: BT siempre visible ──────────────────────────────────── */}
        <div style={{ width:'400px', flexShrink:0, borderLeft:'1px solid #111e35' }}>
          <ErrorBoundary fallback="Error en BT">
            <ChatPanel />
          </ErrorBoundary>
        </div>
      </div>

      {/* ── Overlay de configuración ───────────────────────────────────── */}
      {showSettings && (
        <div
          onClick={() => setShowSettings(false)}
          style={{
            position:'fixed', inset:0, zIndex:200,
            background:'rgba(4,10,24,0.85)', backdropFilter:'blur(4px)',
            display:'flex', alignItems:'flex-start', justifyContent:'flex-end',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width:'560px', height:'100%', background:'#060d1a',
              borderLeft:'1px solid #111e35', overflowY:'auto',
              animation:'slideIn 0.2s ease',
            }}
          >
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 24px 0', borderBottom:'1px solid #111e35', paddingBottom:'14px' }}>
              <span style={{ fontSize:'11px', fontFamily:'JetBrains Mono, monospace', color:'#2c4268', letterSpacing:'2px', textTransform:'uppercase' }}>Configuración</span>
              <button
                onClick={() => setShowSettings(false)}
                style={{ background:'none', border:'1px solid #1a2840', borderRadius:'7px', color:'#486080', cursor:'pointer', padding:'5px 10px', fontSize:'11px', fontFamily:'JetBrains Mono, monospace' }}
              >ESC</button>
            </div>
            <Settings
              setRefreshInterval={setRefreshInterval}
              currentInterval={refreshInterval}
              aiHealth={aiHealth}
            />
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
    </div>
  )
}
