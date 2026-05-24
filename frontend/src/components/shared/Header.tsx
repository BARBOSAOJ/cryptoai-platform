import { Search, Star, Wifi, WifiOff, AlertTriangle, Wallet, TrendingUp, LogOut, Settings } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiClient, aiClient } from '../../api'

interface HeaderProps {
  currentSymbol: string
  setCurrentSymbol: (s: string) => void
  user: { name: string; plan: string; balance: number }
  marketData: Record<string, any>
  sseConnected?: boolean
  aiHealth?: { lstm: boolean; finbert: boolean } | null
  walletBalance?: number | null
  stopAlertCount?: number
  onLogout?: () => void
  onSettingsOpen?: () => void
}

export default function Header({
  currentSymbol, setCurrentSymbol, user, marketData,
  sseConnected, aiHealth, walletBalance, stopAlertCount = 0,
  onLogout, onSettingsOpen,
}: HeaderProps) {
  const [searchInput, setSearchInput]   = useState('')
  const [isOpen, setIsOpen]             = useState(false)
  const [saldoCartera, setSaldoCartera] = useState<number | null>(walletBalance ?? null)
  const [favorites, setFavorites]       = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('fav_symbols') || '["BTCUSDT","ETHUSDT","SOLUSDT"]') }
    catch { return ['BTCUSDT','ETHUSDT','SOLUSDT'] }
  })
  const [quoteFilter, setQuoteFilter]   = useState<'ALL'|'USDT'|'BTC'|'ETH'|'BNB'>('USDT')
  const [stockResult, setStockResult]   = useState<{ symbol:string; name:string; price:number; change:number; currency:string } | null>(null)
  const [stockLoading, setStockLoading] = useState(false)
  const menuRef      = useRef<HTMLDivElement>(null)
  const stockTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const QUOTES       = ['ALL','USDT','BTC','ETH','BNB'] as const

  useEffect(() => {
    if (walletBalance !== undefined && walletBalance !== null) setSaldoCartera(walletBalance)
  }, [walletBalance])

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return
    apiClient.get('/cartera').then(res => setSaldoCartera(res.data.saldoDisponible)).catch(() => {})
  }, [])

  useEffect(() => {
    localStorage.setItem('fav_symbols', JSON.stringify(favorites))
  }, [favorites])

  useEffect(() => {
    let mounted = true
    const handler = (e: MouseEvent) => {
      if (mounted && menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => { mounted = false; document.removeEventListener('mousedown', handler) }
  }, [])

  useEffect(() => {
    if (stockTimer.current) clearTimeout(stockTimer.current)
    if (!searchInput || searchInput.length < 2) { setStockResult(null); return }
    const hasCrypto = Object.keys(marketData).some(s => s.toLowerCase().includes(searchInput.toLowerCase()))
    if (hasCrypto) { setStockResult(null); return }
    stockTimer.current = setTimeout(async () => {
      setStockLoading(true)
      try { const res = await aiClient.get(`/quote/${searchInput.toUpperCase()}`); setStockResult(res.data) }
      catch { setStockResult(null) }
      finally { setStockLoading(false) }
    }, 600)
  }, [searchInput, marketData])

  const toggleFavorite = (e: React.MouseEvent, sym: string) => {
    e.stopPropagation()
    setFavorites(prev => prev.includes(sym) ? prev.filter(f => f !== sym) : [...prev, sym])
  }

  const allSymbols    = Object.keys(marketData)
  const filteredByQ   = quoteFilter === 'ALL' ? allSymbols : allSymbols.filter(s => s.endsWith(quoteFilter))
  const displaySyms   = searchInput
    ? filteredByQ.filter(s => s.toLowerCase().includes(searchInput.toLowerCase())).slice(0, 10)
    : favorites.filter(s => quoteFilter === 'ALL' || s.endsWith(quoteFilter)).slice(0, 10)

  const selectCoin = (sym: string) => { setCurrentSymbol(sym); setSearchInput(''); setIsOpen(false) }

  const currentData = marketData[currentSymbol]
  const price       = currentData?.price ? parseFloat(String(currentData.price)) : 0
  const change      = currentData?.change || '+0.00%'
  const isPositive  = !change.startsWith('-')
  const initials    = user.name ? user.name.slice(0, 2).toUpperCase() : 'AI'

  return (
    <header style={{
      height: 54, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 16px', position: 'relative', zIndex: 100,
      boxShadow: '0 1px 0 rgba(99,102,241,0.04)',
    }}>

      {/* LEFT: search + current symbol */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div ref={menuRef} style={{ position: 'relative' }}>

          {/* Search box */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--bg-input)', border: `1px solid ${isOpen ? 'rgba(99,102,241,0.3)' : 'var(--border)'}`,
            borderRadius: 9, padding: '0 12px', height: 34, width: 200,
            transition: 'border-color var(--transition), box-shadow var(--transition)',
            boxShadow: isOpen ? '0 0 0 3px rgba(99,102,241,0.08)' : 'none',
          }}>
            <Search size={13} color="var(--text-4)" strokeWidth={2} />
            <input
              type="text"
              placeholder="Buscar mercados..."
              value={searchInput}
              onFocus={() => setIsOpen(true)}
              onChange={e => { setSearchInput(e.target.value); setIsOpen(true) }}
              style={{
                background: 'none', border: 'none', color: 'var(--text-1)',
                outline: 'none', fontSize: 12, fontFamily: 'Inter, sans-serif', width: '100%',
              }}
            />
          </div>

          {/* Dropdown */}
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.15 } }}
                exit={{ opacity: 0, y: -4, scale: 0.97, transition: { duration: 0.1 } }}
                style={{
                  position: 'absolute', top: 40, left: 0, width: 280,
                  background: 'var(--bg-input)', border: '1px solid var(--border)',
                  borderRadius: 10, boxShadow: 'var(--shadow-lg)',
                  overflow: 'hidden', padding: 6, zIndex: 200,
                }}
              >
                {/* Quote filter */}
                <div style={{ display: 'flex', gap: 3, padding: '4px 4px 3px' }}>
                  {QUOTES.map(q => (
                    <button key={q} onClick={e => { e.stopPropagation(); setQuoteFilter(q) }} style={{
                      flex: 1, fontSize: 8, fontFamily: 'JetBrains Mono, monospace',
                      padding: '4px 0', borderRadius: 5, cursor: 'pointer', border: 'none',
                      background: quoteFilter === q ? '#243858' : 'transparent',
                      color: quoteFilter === q ? '#fff' : 'var(--text-4)', letterSpacing: '0.5px',
                      transition: 'all var(--transition)',
                    }}>{q}</button>
                  ))}
                </div>
                <div style={{ padding: '5px 10px 3px', fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-5)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                  {searchInput ? `Resultados (${displaySyms.length})` : 'Favoritos'}
                </div>

                {stockLoading && (
                  <div style={{ padding: '8px 10px', fontSize: 10, color: 'var(--text-4)', fontFamily: 'JetBrains Mono, monospace' }}>
                    Buscando en mercados globales...
                  </div>
                )}
                {stockResult && !stockLoading && (
                  <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <TrendingUp size={12} color="var(--indigo)" strokeWidth={1.75} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>{stockResult.symbol}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'JetBrains Mono, monospace' }}>{stockResult.name}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>{stockResult.currency} {stockResult.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                      <div style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: stockResult.change >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {stockResult.change >= 0 ? '+' : ''}{stockResult.change.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                )}

                {displaySyms.map((sym, idx) => (
                  <motion.div
                    key={sym}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0, transition: { delay: idx * 0.03 } }}
                    whileHover={{ background: 'rgba(99,102,241,0.06)' }}
                    onClick={() => selectCoin(sym)}
                    style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderRadius: 7 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Star
                        size={12}
                        onClick={e => toggleFavorite(e, sym)}
                        fill={favorites.includes(sym) ? '#fff' : 'none'}
                        color={favorites.includes(sym) ? '#fff' : 'var(--text-4)'}
                        style={{ cursor: 'pointer', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'JetBrains Mono, monospace' }}>{sym}</span>
                    </div>
                    <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--green)' }}>
                      {parseFloat(String(marketData[sym]?.price || '0')).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Current symbol price display */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
          <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '-0.3px', color: 'var(--text-1)' }}>
            {currentSymbol.replace('USDT','')} / USDT
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-1)' }}>
            {price > 0 ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : '—'}
          </span>
          <span style={{
            fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
            color: isPositive ? 'var(--green)' : 'var(--red)',
            background: isPositive ? 'var(--green-dim)' : 'var(--red-dim)',
            border: `1px solid ${isPositive ? 'var(--green-mid)' : 'var(--red-mid)'}`,
            padding: '3px 8px', borderRadius: 5,
          }}>
            {change}
          </span>
        </div>
      </div>

      {/* RIGHT: status + user */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

        {/* SSE indicator */}
        <div title={sseConnected ? 'Tiempo real activo' : 'Fallback a polling'}
          style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
          {sseConnected ? (
            <>
              <Wifi size={13} color="var(--green)" strokeWidth={1.75} />
              <span style={{
                position: 'absolute', top: -1, right: -1, width: 5, height: 5,
                borderRadius: '50%', background: 'var(--green)',
                animation: 'ping 2s cubic-bezier(0,0,0.2,1) infinite',
              }} />
            </>
          ) : (
            <WifiOff size={13} color="var(--text-3)" strokeWidth={1.75} />
          )}
        </div>

        {/* AI health warning */}
        {aiHealth && !aiHealth.lstm && !aiHealth.finbert && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            title="Modelos IA no disponibles"
          >
            <AlertTriangle size={13} color="#f59e0b" strokeWidth={1.75} />
          </motion.div>
        )}

        {/* Stop-loss alert badge */}
        <AnimatePresence>
          {stopAlertCount > 0 && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              title={`${stopAlertCount} posición(es) en zona stop-loss`}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'rgba(255,59,59,0.1)', border: '1px solid rgba(255,59,59,0.3)',
                padding: '4px 8px', borderRadius: 6, animation: 'pulse 1.5s infinite',
              }}
            >
              <AlertTriangle size={11} color="var(--red)" strokeWidth={2} />
              <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--red)', letterSpacing: '0.5px', fontWeight: 700 }}>
                STOP ×{stopAlertCount}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Wallet balance */}
        {saldoCartera !== null && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'var(--bg-input)', border: '1px solid var(--border-2)',
            padding: '5px 10px', borderRadius: 7,
          }} title="Saldo disponible">
            <Wallet size={11} color="var(--text-3)" strokeWidth={1.75} />
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--text-1)' }}>
              ${saldoCartera.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        )}

        {/* Plan badge */}
        <span style={{
          fontSize: 8, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1.5px',
          color: 'var(--indigo)', background: 'rgba(99,102,241,0.1)',
          border: '1px solid rgba(99,102,241,0.2)',
          padding: '4px 8px', borderRadius: 6, textTransform: 'uppercase',
        }}>
          {user.plan}
        </span>

        {/* Avatar */}
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'linear-gradient(135deg, #1a2840, #243858)',
          border: '1px solid rgba(99,102,241,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: 'var(--indigo)',
          boxShadow: '0 0 8px rgba(99,102,241,0.1)',
        }}>
          {initials}
        </div>

        {onSettingsOpen && (
          <motion.button
            whileHover={{ background: 'rgba(99,102,241,0.08)' }}
            whileTap={{ scale: 0.92 }}
            onClick={onSettingsOpen}
            title="Configuración"
            style={{
              width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border-2)',
              background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-3)', transition: 'all var(--transition)',
            }}
          >
            <Settings size={13} strokeWidth={1.75} />
          </motion.button>
        )}

        {onLogout && (
          <motion.button
            whileHover={{ background: 'rgba(255,59,59,0.08)', borderColor: 'rgba(255,59,59,0.2)', color: 'var(--red)' }}
            whileTap={{ scale: 0.92 }}
            onClick={onLogout}
            title="Cerrar sesión"
            style={{
              width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border-2)',
              background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-3)', transition: 'all var(--transition)',
            }}
          >
            <LogOut size={13} strokeWidth={1.75} />
          </motion.button>
        )}
      </div>
    </header>
  )
}
