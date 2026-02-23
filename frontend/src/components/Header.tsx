import { Search, User, Zap, Star } from 'lucide-react'
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

  // Lógica para cerrar el buscador al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleFavorite = (e: React.MouseEvent, sym: string) => {
    e.stopPropagation()
    setFavorites(prev =>
      prev.includes(sym) ? prev.filter(f => f !== sym) : [...prev, sym]
    )
  }

  const allSymbols = Object.keys(marketData)
  const displaySymbols = searchInput
    ? allSymbols.filter(sym => sym.toLowerCase().includes(searchInput.toLowerCase())).slice(0, 8)
    : favorites

  const selectCoin = (sym: string) => {
    setCurrentSymbol(sym)
    setSearchInput('')
    setIsOpen(false)
  }

  return (
    <header style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <form onSubmit={(e) => { e.preventDefault(); if (displaySymbols[0]) selectCoin(displaySymbols[0]) }}>
            <Search style={searchIconStyle} size={16} />
            <input
              type="text"
              placeholder="Buscar mercados..."
              value={searchInput}
              onFocus={() => setIsOpen(true)}
              onChange={(e) => { setSearchInput(e.target.value); setIsOpen(true) }}
              style={inputStyle}
            />
          </form>

          {isOpen && (
            <div style={dropdownStyle}>
              <div style={sectionTitleStyle}>{searchInput ? 'RESULTADOS' : 'MIS FAVORITOS'}</div>
              {displaySymbols.map(sym => (
                <div key={sym} onClick={() => selectCoin(sym)} style={optionStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Star
                      size={14}
                      onClick={(e) => toggleFavorite(e, sym)}
                      fill={favorites.includes(sym) ? '#FCD535' : 'none'}
                      color={favorites.includes(sym) ? '#FCD535' : '#444'}
                    />
                    <span style={{ fontSize: '13px', fontWeight: 'bold' }}>{sym}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#089981' }}>
                      ${marketData[sym]?.price?.toLocaleString() || '0.00'}
                    </span>
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
          {/* Corregido el atributo inline que generaba el warning */}
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#FCD535', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Zap size={12} fill="#FCD535" /> {user.plan}
          </div>
          <div style={{ fontSize: '11px', color: '#848e9c' }}>{user.name}</div>
        </div>
        <div style={userAvatarStyle}><User size={20} color="#848e9c" /></div>
      </div>
    </header>
  )
}

const headerStyle = { height: '70px', background: '#0b0e11', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 30px', position: 'relative' as const, zIndex: 100 }
const searchIconStyle = { position: 'absolute' as const, left: '12px', top: '10px', color: '#444' }
const inputStyle = { background: '#161a1e', border: '1px solid #2b3139', color: 'white', padding: '10px 15px 10px 40px', borderRadius: '8px', fontSize: '13px', width: '300px', outline: 'none' }
const dropdownStyle = { position: 'absolute' as const, top: '45px', left: 0, width: '100%', background: '#161a1e', border: '1px solid #2b3139', borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', overflow: 'hidden', padding: '5px' }
const sectionTitleStyle = { padding: '8px 12px', fontSize: '10px', fontWeight: 'bold', color: '#444', letterSpacing: '1px' }
const optionStyle = { padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderRadius: '6px', transition: '0.2s', color: '#e0e0e0' }
const userAvatarStyle = { background: '#161a1e', padding: '10px', borderRadius: '50%', border: '1px solid #2b3139' }