import { useState, useEffect, useRef, useCallback } from 'react'
import { apiClient, aiClient, API_PRICE } from './api'
import Sidebar from './components/shared/Sidebar'
import Header from './components/shared/Header'
import TradingTerminal from './components/terminal/TradingTerminal'
import Portfolio from './components/portfolio/Portfolio'
import Settings from './components/configuracion/Settings'
import Login from './components/Login'
import LoadingSplash from './components/shared/LoadingSplash'
import ErrorBoundary from './components/shared/ErrorBoundary'
import AgentPanel from './components/agente/AgentPanel'
import { useAgenteAutonomo } from './hooks/useAgenteAutonomo'

const MAIN_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'TRUMPUSDT', 'PEPEUSDT', 'DOGEUSDT', 'SHIBUSDT']

export default function App() {
  const [loading, setLoading]         = useState(true)
  const [isLoggedIn, setIsLoggedIn]   = useState(() => { try { return !!localStorage.getItem('token') } catch { return false } })
  const [activeTab, setActiveTab]     = useState<'TRADE' | 'PORTFOLIO' | 'BOT' | 'CONFIG'>('TRADE')
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
  const [sseConnected, setSseConnected] = useState(false)
  const [dataError, setDataError]     = useState<string | null>(null)
  const [aiHealth, setAiHealth]       = useState<{ lstm: boolean; finbert: boolean } | null>(null)
  const [portfolioVersion, setPortfolioVersion] = useState(0)

  const historyRef          = useRef<Record<string, number[]>>({})
  const volumesRef          = useRef<Record<string, number[]>>({})
  const currentSymRef       = useRef(currentSymbol)
  const pollingErrorCount   = useRef(0)
  const aiCooldownRef  = useRef<Record<string, number>>({})
  const reconnectCount = useRef(0)

  // ─── Agente autónomo ───────────────────────────────────────────────────────
  const { estado: estadoAgente, activar, pausar, configurarSimbolo, procesarTick, alertasStopLoss } = useAgenteAutonomo()

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

      // Llamar al agente autónomo para decidir si operar
      procesarTick(symbol, price, insight)

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

  const handleTradeExecuted = (trade: any) => {
    setTradeHistory(prev => [trade, ...prev].slice(0, 50))
    setPortfolioVersion(v => v + 1)   // fuerza refresco del portfolio
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading)     return <LoadingSplash />
  if (!isLoggedIn) return <Login onLoginSuccess={handleLoginSuccess} />

  return (
    <div style={{
      display: 'flex', height: '100vh', width: '100vw',
      background: '#091220', color: '#c8d8ec', overflow: 'hidden',
      transition: '0.3s',
      boxShadow: alertFlash ? 'inset 0 0 100px rgba(8, 153, 129, 0.4)' : 'none'
    }}>
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Header
          currentSymbol={currentSymbol}
          setCurrentSymbol={setCurrentSymbol}
          user={user}
          marketData={marketData}
          sseConnected={sseConnected}
          aiHealth={aiHealth}
          stopAlertCount={alertasStopLoss.size}
        />
        {dataError && (
          <div style={{
            background: 'rgba(255,59,59,0.08)', borderBottom: '1px solid rgba(255,59,59,0.2)',
            padding: '6px 20px', fontSize: '11px', color: '#ff6b6b',
            display: 'flex', alignItems: 'center', gap: '8px'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ff3b3b', flexShrink: 0 }} />
            {dataError}
          </div>
        )}
        <main style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'TRADE' && (
            <ErrorBoundary fallback="Error en el terminal de trading">
              <TradingTerminal
                symbol={currentSymbol}
                insight={aiInsights[currentSymbol]}
                history={tradeHistory}
                user={user}
                currentPrice={marketData[currentSymbol]?.price ?? 0}
                posicionAgenteActiva={estadoAgente.posicionesAbiertas[currentSymbol] ?? null}
                onTradeExecuted={handleTradeExecuted}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'PORTFOLIO' && (
            <ErrorBoundary fallback="Error en el portfolio">
              <Portfolio user={user} refreshTrigger={portfolioVersion} marketData={marketData} />
            </ErrorBoundary>
          )}
          {activeTab === 'BOT' && (
            <ErrorBoundary fallback="Error en el agente autónomo">
              <AgentPanel
                estado={estadoAgente}
                activar={activar}
                pausar={pausar}
                configurarSimbolo={configurarSimbolo}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'CONFIG' && (
            <ErrorBoundary fallback="Error en la configuración">
              <Settings
                setRefreshInterval={setRefreshInterval}
                currentInterval={refreshInterval}
                aiHealth={aiHealth}
              />
            </ErrorBoundary>
          )}
        </main>
      </div>
    </div>
  )
}
