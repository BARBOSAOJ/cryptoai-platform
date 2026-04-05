import { Search, Star, Wifi, WifiOff, AlertTriangle } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

interface HeaderProps {
  currentSymbol: string
  setCurrentSymbol: (s: string) => void
  user: { name: string; plan: string; balance: number }
  marketData: Record<string, any>
  sseConnected?: boolean
  aiHealth?: { lstm: boolean; finbert: boolean } | null
}

export default function Header({ currentSymbol, setCurrentSymbol, user, marketData, sseConnected, aiHealth }: HeaderProps) {
  const [searchInput, setSearchInput] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('fav_symbols')
    return saved ? JSON.parse(saved) : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
  })
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem('fav_symbols', JSON.stringify(favorites))
  }, [favorites])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggleFavorite = (e: React.MouseEvent, sym: string) => {
    e.stopPropagation()
    setFavorites(prev => prev.includes(sym) ? prev.filter(f => f !== sym) : [...prev, sym])
  }

  const allSymbols = Object.keys(marketData)
  const displaySymbols = searchInput
    ? allSymbols.filter(s => s.toLowerCase().includes(searchInput.toLowerCase())).slice(0, 8)
    : favorites

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
            <Search size={13} color="#2a2a2a" strokeWidth={2} />
            <input
              type="text"
              placeholder="Buscar mercados..."
              value={searchInput}
              onFocus={() => setIsOpen(true)}
              onChange={e => { setSearchInput(e.target.value); setIsOpen(true) }}
              style={inputStyle}
            />
          </div>
          {isOpen && displaySymbols.length > 0 && (
            <div style={dropdownStyle}>
              <div style={dropLabelStyle}>{searchInput ? 'Resultados' : 'Favoritos'}</div>
              {displaySymbols.map(sym => (
                <div key={sym} onClick={() => selectCoin(sym)} style={optionStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Star
                      size={12}
                      onClick={e => toggleFavorite(e, sym)}
                      fill={favorites.includes(sym) ? '#fff' : 'none'}
                      color={favorites.includes(sym) ? '#fff' : '#333'}
                      style={{ cursor: 'pointer', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: '12px', fontWeight: 500, fontFamily: 'JetBrains Mono, monospace' }}>{sym}</span>
                  </div>
                  <span style={{ fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', color: '#00d060' }}>
                    ${parseFloat(String(marketData[sym]?.price || '0')).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '1px', height: '16px', background: '#111' }} />
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
            : <WifiOff size={13} color="#555" strokeWidth={1.75} />}
        </div>
        {/* Aviso si los modelos IA no están disponibles */}
        {aiHealth && !aiHealth.lstm && !aiHealth.finbert && (
          <div title="Modelos IA no disponibles" style={{ display: 'flex', alignItems: 'center' }}>
            <AlertTriangle size={13} color="#f59e0b" strokeWidth={1.75} />
          </div>
        )}
        <span style={planTagStyle}>{user.plan}</span>
        <div style={avatarStyle}>{initials}</div>
      </div>
    </header>
  )
}

const headerStyle: React.CSSProperties = {
  height: '56px', background: '#060606', borderBottom: '1px solid #111',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0 18px', position: 'relative', zIndex: 100
}
const searchWrapStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px',
  background: '#0d0d0d', border: '1px solid #1a1a1a',
  borderRadius: '9px', padding: '0 12px', height: '34px', width: '200px'
}
const inputStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: '#fff', outline: 'none',
  fontSize: '12px', fontFamily: 'Inter, sans-serif', width: '100%'
}
const dropdownStyle: React.CSSProperties = {
  position: 'absolute', top: '40px', left: 0, width: '280px',
  background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: '10px',
  boxShadow: '0 12px 30px rgba(0,0,0,0.6)', overflow: 'hidden', padding: '6px'
}
const dropLabelStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
  color: '#2a2a2a', letterSpacing: '1.5px', textTransform: 'uppercase'
}
const optionStyle: React.CSSProperties = {
  padding: '9px 10px', display: 'flex', alignItems: 'center',
  justifyContent: 'space-between', cursor: 'pointer', borderRadius: '7px',
  color: '#e2e2f0', transition: 'background 0.15s'
}
const planTagStyle: React.CSSProperties = {
  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1.5px',
  color: '#fff', background: '#141414', border: '1px solid #1e1e1e',
  padding: '5px 10px', borderRadius: '7px', textTransform: 'uppercase'
}
const avatarStyle: React.CSSProperties = {
  width: '30px', height: '30px', borderRadius: '50%', background: '#141414',
  border: '1px solid #1e1e1e', display: 'flex', alignItems: 'center',
  justifyContent: 'center', fontSize: '10px', fontWeight: 600, color: '#555'
}
