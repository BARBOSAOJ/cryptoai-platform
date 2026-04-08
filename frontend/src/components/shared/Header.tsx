import { Search, Star, Wifi, WifiOff, AlertTriangle, Wallet, TrendingUp } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { apiClient, aiClient } from '../../api'

interface HeaderProps {
  currentSymbol: string
  setCurrentSymbol: (s: string) => void
  user: { name: string; plan: string; balance: number }
  marketData: Record<string, any>
  sseConnected?: boolean
  aiHealth?: { lstm: boolean; finbert: boolean } | null
  walletBalance?: number | null
  /** Número de posiciones con precio <= stopLoss */
  stopAlertCount?: number
}

export default function Header({ currentSymbol, setCurrentSymbol, user, marketData, sseConnected, aiHealth, walletBalance, stopAlertCount = 0 }: HeaderProps) {
  const [searchInput, setSearchInput]     = useState('')
  const [isOpen, setIsOpen]               = useState(false)
  const [saldoCartera, setSaldoCartera]   = useState<number | null>(walletBalance ?? null)
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('fav_symbols')
    return saved ? JSON.parse(saved) : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
  })
  const menuRef = useRef<HTMLDivElement>(null)

  // Actualizar badge cuando el padre pasa walletBalance
  useEffect(() => {
    if (walletBalance !== undefined && walletBalance !== null) {
      setSaldoCartera(walletBalance)
    }
  }, [walletBalance])

  // Obtener saldo de cartera al montar
  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    apiClient.get('/cartera')
      .then(res => setSaldoCartera(res.data.saldoDisponible))
      .catch(() => {})
  }, [])

  useEffect(() => {
    localStorage.setItem('fav_symbols', JSON.stringify(favorites))
  }, [favorites])

  useEffect(() => {
    let mounted = true
    const handler = (e: MouseEvent) => {
      if (mounted && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => {
      mounted = false
      document.removeEventListener('mousedown', handler)
    }
  }, [])

  const toggleFavorite = (e: React.MouseEvent, sym: string) => {
    e.stopPropagation()
    setFavorites(prev => prev.includes(sym) ? prev.filter(f => f !== sym) : [...prev, sym])
  }

  const [quoteFilter, setQuoteFilter] = useState<'ALL' | 'USDT' | 'BTC' | 'ETH' | 'BNB'>('USDT')
  const [stockResult, setStockResult] = useState<{ symbol: string; name: string; price: number; change: number; currency: string; type: string } | null>(null)
  const [stockLoading, setStockLoading] = useState(false)
  const stockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const QUOTES = ['ALL', 'USDT', 'BTC', 'ETH', 'BNB'] as const

  // Búsqueda de acciones/ETFs via Yahoo Finance cuando no hay resultados crypto
  useEffect(() => {
    if (stockTimerRef.current) clearTimeout(stockTimerRef.current)
    if (!searchInput || searchInput.length < 2) { setStockResult(null); return }

    // Solo buscar en Yahoo si no hay coincidencias crypto
    const hasCrypto = Object.keys(marketData).some(s => s.toLowerCase().includes(searchInput.toLowerCase()))
    if (hasCrypto) { setStockResult(null); return }

    stockTimerRef.current = setTimeout(async () => {
      setStockLoading(true)
      try {
        const res = await aiClient.get(`/quote/${searchInput.toUpperCase()}`)
        setStockResult(res.data)
      } catch {
        setStockResult(null)
      } finally {
        setStockLoading(false)
      }
    }, 600)
  }, [searchInput, marketData])

  const allSymbols = Object.keys(marketData)
  const filteredByQuote = quoteFilter === 'ALL'
    ? allSymbols
    : allSymbols.filter(s => s.endsWith(quoteFilter))

  const displaySymbols = searchInput
    ? filteredByQuote.filter(s => s.toLowerCase().includes(searchInput.toLowerCase())).slice(0, 10)
    : favorites.filter(s => quoteFilter === 'ALL' || s.endsWith(quoteFilter)).slice(0, 10)

  const selectCoin = (sym: string) => {
    setCurrentSymbol(sym)
    setSearchInput('')
    setIsOpen(false)
  }

  const currentData = marketData[currentSymbol]
  const price = currentData?.price ? parseFloat(String(currentData.price)) : 0
  const change = currentData?.change || '+0.00%'
  const isPositive = !change.startsWith('-')
  const initials = user.name ? user.name.slice(0, 2).toUpperCase() : 'AI'

  return (
    <header style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <div style={searchWrapStyle}>
            <Search size={13} color="#243858" strokeWidth={2} />
            <input
              type="text"
              placeholder="Buscar mercados..."
              value={searchInput}
              onFocus={() => setIsOpen(true)}
              onChange={e => { setSearchInput(e.target.value); setIsOpen(true) }}
              style={inputStyle}
            />
          </div>
          {isOpen && (
            <div style={dropdownStyle}>
              {/* Filtro de moneda base */}
              <div style={{ display: 'flex', gap: '4px', padding: '6px 6px 4px' }}>
                {QUOTES.map(q => (
                  <button
                    key={q}
                    onClick={e => { e.stopPropagation(); setQuoteFilter(q) }}
                    style={{
                      flex: 1, fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
                      padding: '4px 0', borderRadius: '5px', cursor: 'pointer', border: 'none',
                      background: quoteFilter === q ? '#243858' : 'transparent',
                      color: quoteFilter === q ? '#fff' : '#2c4268',
                      letterSpacing: '0.5px'
                    }}
                  >{q}</button>
                ))}
              </div>
              <div style={dropLabelStyle}>{searchInput ? `Resultados (${displaySymbols.length})` : 'Favoritos'}</div>
              {/* Resultado de acción/ETF de Yahoo Finance */}
              {stockLoading && (
                <div style={{ padding: '8px 10px', fontSize: '10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>
                  Buscando en mercados globales...
                </div>
              )}
              {stockResult && !stockLoading && (
                <div style={{ ...optionStyle, borderTop: '1px solid #111e35', marginTop: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <TrendingUp size={12} color="#818cf8" strokeWidth={1.75} style={{ flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{stockResult.symbol}</div>
                      <div style={{ fontSize: '9px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>{stockResult.name}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', color: '#c8d8ec' }}>
                      {stockResult.currency} {stockResult.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: stockResult.change >= 0 ? '#00d060' : '#ff3b3b' }}>
                      {stockResult.change >= 0 ? '+' : ''}{stockResult.change.toFixed(2)}%
                    </div>
                  </div>
                </div>
              )}
              {displaySymbols.map(sym => (
                <div key={sym} onClick={() => selectCoin(sym)} style={optionStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Star
                      size={12}
                      onClick={e => toggleFavorite(e, sym)}
                      fill={favorites.includes(sym) ? '#fff' : 'none'}
                      color={favorites.includes(sym) ? '#fff' : '#2c4268'}
                      style={{ cursor: 'pointer', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: '12px', fontWeight: 500, fontFamily: 'JetBrains Mono, monospace' }}>{sym}</span>
                  </div>
                  <span style={{ fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', color: '#00d060' }}>
                    {parseFloat(String(marketData[sym]?.price || '0')).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '1px', height: '16px', background: '#111e35' }} />
          <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '-0.3px' }}>
            {currentSymbol.replace('USDT', '')} / USDT
          </span>
          <span style={{ fontSize: '14px', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
            ${price > 0 ? price.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
          </span>
          <span style={{
            fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
            color: isPositive ? '#00d060' : '#ff3b3b',
            background: isPositive ? 'rgba(0,208,96,0.08)' : 'rgba(255,59,59,0.08)',
            border: `1px solid ${isPositive ? 'rgba(0,208,96,0.18)' : 'rgba(255,59,59,0.18)'}`,
            padding: '3px 8px', borderRadius: '5px'
          }}>{change}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Indicador SSE */}
        <div title={sseConnected ? 'Tiempo real activo' : 'Fallback a polling'} style={{ display: 'flex', alignItems: 'center' }}>
          {sseConnected
            ? <Wifi size={13} color="#00d060" strokeWidth={1.75} />
            : <WifiOff size={13} color="#486080" strokeWidth={1.75} />}
        </div>
        {/* Aviso si los modelos IA no están disponibles */}
        {aiHealth && !aiHealth.lstm && !aiHealth.finbert && (
          <div title="Modelos IA no disponibles" style={{ display: 'flex', alignItems: 'center' }}>
            <AlertTriangle size={13} color="#f59e0b" strokeWidth={1.75} />
          </div>
        )}
        {/* Badge de alerta de stop-loss */}
        {stopAlertCount > 0 && (
          <div
            title={`${stopAlertCount} posición(es) en zona de stop-loss`}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'rgba(255,59,59,0.1)', border: '1px solid rgba(255,59,59,0.3)',
              padding: '4px 9px', borderRadius: '7px', animation: 'pulse 1.5s infinite'
            }}
          >
            <AlertTriangle size={11} color="#ff3b3b" strokeWidth={2} />
            <span style={{
              fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
              color: '#ff3b3b', letterSpacing: '0.5px', fontWeight: 700
            }}>
              STOP ×{stopAlertCount}
            </span>
          </div>
        )}
        {/* Badge de saldo de cartera virtual */}
        {saldoCartera !== null && (
          <div style={walletBadgeStyle} title="Saldo disponible en cartera virtual">
            <Wallet size={11} color="#486080" strokeWidth={1.75} />
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#c8d8ec' }}>
              ${saldoCartera.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        )}
        <span style={planTagStyle}>{user.plan}</span>
        <div style={avatarStyle}>{initials}</div>
      </div>
    </header>
  )
}

const headerStyle: React.CSSProperties = {
  height: '56px', background: '#07101e', borderBottom: '1px solid #111e35',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0 18px', position: 'relative', zIndex: 100
}
const searchWrapStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px',
  background: '#0d1730', border: '1px solid #1a1a1a',
  borderRadius: '9px', padding: '0 12px', height: '34px', width: '200px'
}
const inputStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#fff', outline: 'none',
  fontSize: '12px', fontFamily: 'Inter, sans-serif', width: '100%'
}
const dropdownStyle: React.CSSProperties = {
  position: 'absolute', top: '40px', left: 0, width: '280px',
  background: '#0d1730', border: '1px solid #1a1a1a', borderRadius: '10px',
  boxShadow: '0 12px 30px rgba(4,10,24,0.85)', overflow: 'hidden', padding: '6px'
}
const dropLabelStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
  color: '#243858', letterSpacing: '1.5px', textTransform: 'uppercase'
}
const optionStyle: React.CSSProperties = {
  padding: '9px 10px', display: 'flex', alignItems: 'center',
  justifyContent: 'space-between', cursor: 'pointer', borderRadius: '7px',
  color: '#ccdaf0', transition: 'background 0.15s'
}
const walletBadgeStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '5px',
  background: '#0d1730', border: '1px solid #1a2840',
  padding: '5px 10px', borderRadius: '7px'
}
const planTagStyle: React.CSSProperties = {
  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1.5px',
  color: '#fff', background: '#14203c', border: '1px solid #1e1e1e',
  padding: '5px 10px', borderRadius: '7px', textTransform: 'uppercase'
}
const avatarStyle: React.CSSProperties = {
  width: '30px', height: '30px', borderRadius: '50%', background: '#14203c',
  border: '1px solid #1e1e1e', display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: '#486080'
}
