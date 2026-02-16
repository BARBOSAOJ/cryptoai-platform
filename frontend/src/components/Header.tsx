import { Search, User, Zap, Coins, Star } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

export default function Header({ currentSymbol, setCurrentSymbol, user, marketData }: any) {
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

  const toggleFavorite = (e: React.MouseEvent, sym: string) => {
    e.stopPropagation()
    setFavorites(prev =>
      prev.includes(sym) ? prev.filter(f => f !== sym) : [...prev, sym]
    )
  }

  const allSymbols = Object.keys(marketData)
  const filteredSymbols = allSymbols
    .filter(sym => sym.toLowerCase().includes(searchInput.toLowerCase()))
    .sort((a, b) => {
      const aFav = favorites.includes(a) ? 1 : 0
      const bFav = favorites.includes(b) ? 1 : 0
      return bFav - aFav
    })
    .slice(0, 10)

  const selectCoin = (sym: string) => {
    setCurrentSymbol(sym)
    setSearchInput('')
    setIsOpen(false)
  }

  return (
    <header style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <form onSubmit={(e) => { e.preventDefault(); if (filteredSymbols[0]) selectCoin(filteredSymbols[0]) }}>
            <Search style={searchIconStyle} size={16} />
            <input
              type="text"
              placeholder="Buscar activos y memecoins..."
              value={searchInput}
              onFocus={() => setIsOpen(true)}
              onChange={(e) => { setSearchInput(e.target.value); setIsOpen(true) }}
              style={inputStyle}
            />
          </form>

          {isOpen && (
            <div style={dropdownStyle}>
              {filteredSymbols.map(sym => (
                <div key={sym} onClick={() => selectCoin(sym)} style={optionStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div
                      onClick={(e) => toggleFavorite(e, sym)}
                      style={{ color: favorites.includes(sym) ? '#FCD535' : '#444', cursor: 'pointer' }}
                    >
                      <Star size={14} fill={favorites.includes(sym) ? '#FCD535' : 'none'} />
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 'bold' }}>{sym}</div>
                      <div style={{ fontSize: '10px', color: '#848e9c' }}>Binance Spot</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#089981' }}>
                      ${marketData[sym]?.price?.toLocaleString() || '0.00'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ fontSize: '18px', fontWeight: '900' }}>{currentSymbol}</span>
          <span style={{ fontSize: '18px', fontWeight: '900', color: '#089981' }}>
            ${marketData[currentSymbol]?.price?.toLocaleString() || '0.00'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '25px' }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#FCD535', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Zap size={12} fill="#FCD535" /> {user.plan}
          </div>
          <div style={{ fontSize: '11px', color: '#848e9c' }}>{user.name}</div>
        </div>
        <div style={userAvatarStyle}>
          <User size={20} color="#848e9c" />
        </div>
      </div>
    </header>
  )
}

const headerStyle = { height: '70px', background: '#0b0e11', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 30px', position: 'relative' as const, zIndex: 100 }
const searchIconStyle = { position: 'absolute' as const, left: '12px', top: '10px', color: '#444' }
const inputStyle = { background: '#161a1e', border: '1px solid #2b3139', color: 'white', padding: '10px 15px 10px 40px', borderRadius: '8px', fontSize: '13px', width: '300px', outline: 'none' }
const dropdownStyle = { position: 'absolute' as const, top: '45px', left: 0, width: '100%', background: '#161a1e', border: '1px solid #2b3139', borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', overflow: 'hidden', padding: '5px' }
const optionStyle = { padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderRadius: '6px', transition: '0.2s', color: '#e0e0e0' }
const userAvatarStyle = { background: '#161a1e', padding: '10px', borderRadius: '50%', border: '1px solid #2b3139' }