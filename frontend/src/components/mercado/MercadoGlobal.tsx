import { useState, useEffect, useCallback } from 'react'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { apiClient } from '../../api'

const COINS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','LINKUSDT',
  'MATICUSDT','LTCUSDT','ATOMUSDT','NEARUSDT','TRXUSDT',
  'UNIUSDT','AAVEUSDT','INJUSDT','ARBUSDT','OPUSDT',
  'SUIUSDT','APTUSDT','TONUSDT','PEPEUSDT','SHIBUSDT',
  'TRUMPUSDT','WIFUSDT','BONKUSDT',
]

type SortKey = 'symbol' | 'price' | 'change' | 'signal' | 'conviction'
type SortDir = 'asc' | 'desc'

interface Row {
  symbol:     string
  price:      number
  change:     number | null
  signal:     string | null
  conviction: number | null
}

interface Props {
  marketData:  Record<string, any>
  aiInsights:  Record<string, any>
  onSymbolClick: (symbol: string) => void
}

function signalColor(signal: string | null) {
  if (!signal) return '#3d5470'
  if (signal.includes('COMPRAR')) return '#2ebd85'
  if (signal.includes('VENDER'))  return '#f6465d'
  return '#818cf8'
}

function fmtPrice(v: number) {
  if (v >= 1000) return v.toLocaleString('en', { maximumFractionDigits: 2 })
  if (v >= 1)    return v.toFixed(4)
  return v.toFixed(6)
}

export default function MercadoGlobal({ marketData, aiInsights, onSymbolClick }: Props) {
  const [rows, setRows]       = useState<Row[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('conviction')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [search, setSearch]   = useState('')

  const buildRows = useCallback((prices: Record<string, any>) => {
    return COINS.map(sym => {
      const restData = prices[sym]
      const sseData  = marketData[sym]
      // /prices returns price as string; SSE has it as number
      const rawPrice = restData?.price ?? sseData?.price ?? 0
      const price    = parseFloat(String(rawPrice)) || 0
      // change only comes from SSE (REST endpoint doesn't include it)
      const change   = sseData?.change ?? null
      const ai       = aiInsights[sym]
      return {
        symbol:     sym,
        price,
        change,
        signal:     ai?.signal ?? null,
        conviction: ai?.conviction_score ?? null,
      }
    }).filter(r => r.price > 0)
  }, [marketData, aiInsights])

  const fetchPrices = useCallback(async () => {
    try {
      const res = await apiClient.get('/prices')
      setRows(buildRows(res.data))
    } catch {
      setRows(buildRows({}))
    }
  }, [buildRows])

  useEffect(() => {
    fetchPrices()
    const t = setInterval(fetchPrices, 10_000)
    return () => clearInterval(t)
  }, [fetchPrices])

  // Re-build when insights update
  useEffect(() => {
    setRows(prev => prev.map(r => ({
      ...r,
      signal:     aiInsights[r.symbol]?.signal ?? r.signal,
      conviction: aiInsights[r.symbol]?.conviction_score ?? r.conviction,
    })))
  }, [aiInsights])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...rows]
    .filter(r => r.symbol.toLowerCase().includes(search.toUpperCase()) || r.symbol.replace('USDT','').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let diff = 0
      if (sortKey === 'symbol')     diff = a.symbol.localeCompare(b.symbol)
      if (sortKey === 'price')      diff = a.price - b.price
      if (sortKey === 'change')     diff = (a.change ?? -999) - (b.change ?? -999)
      if (sortKey === 'conviction') diff = (a.conviction ?? -1) - (b.conviction ?? -1)
      if (sortKey === 'signal')     diff = (a.signal ?? '').localeCompare(b.signal ?? '')
      return sortDir === 'asc' ? diff : -diff
    })

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown size={10} color="#1e3050" />
    return sortDir === 'asc' ? <ArrowUp size={10} color="#818cf8" /> : <ArrowDown size={10} color="#818cf8" />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#060d1a', color: '#fff' }}>

      {/* Header */}
      <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #111e35', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 2 }}>Mercado</div>
            <div style={{ fontSize: 11, color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>
              {sorted.length} activos · actualiza cada 10s
            </div>
          </div>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar símbolo…"
          style={{
            width: '100%', background: '#091220', border: '1px solid #111e35',
            color: '#ddeeff', padding: '8px 12px', borderRadius: 9,
            fontSize: 12, fontFamily: 'Inter, sans-serif', outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Table header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 120px 90px 130px 110px',
        padding: '8px 24px',
        borderBottom: '1px solid #111e35',
        flexShrink: 0,
      }}>
        {([
          ['symbol',     'ACTIVO'],
          ['price',      'PRECIO'],
          ['change',     '24H %'],
          ['signal',     'SEÑAL BT'],
          ['conviction', 'CONVICTION'],
        ] as [SortKey, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => handleSort(k)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
              color: sortKey === k ? '#818cf8' : '#1e3050', letterSpacing: '0.8px',
              justifyContent: k === 'price' || k === 'change' || k === 'conviction' ? 'flex-end' : 'flex-start',
            }}
          >
            {label} <SortIcon k={k} />
          </button>
        ))}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center', fontSize: 12, color: '#2c4268' }}>
            Cargando datos de mercado…
          </div>
        )}
        {sorted.map(row => {
          const sym    = row.symbol.replace('USDT', '')
          const chgPos = row.change !== null && row.change >= 0
          const color  = signalColor(row.signal)

          return (
            <div
              key={row.symbol}
              onClick={() => onSymbolClick(row.symbol)}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 120px 90px 130px 110px',
                padding: '11px 24px',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Symbol */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: '#091220', border: '1px solid #111e35',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 8, fontWeight: 700, color: '#3d5470', fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {sym.slice(0, 3)}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ddeeff' }}>{sym}</div>
                  <div style={{ fontSize: 9, color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>{row.symbol}</div>
                </div>
              </div>

              {/* Price */}
              <div style={{ textAlign: 'right', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: '#ddeeff', alignSelf: 'center' }}>
                ${fmtPrice(row.price)}
              </div>

              {/* Change 24h */}
              <div style={{ textAlign: 'right', alignSelf: 'center' }}>
                {row.change !== null ? (
                  <span style={{
                    fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                    color: chgPos ? '#2ebd85' : '#f6465d',
                  }}>
                    {chgPos ? '+' : ''}{row.change.toFixed(2)}%
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: '#1e3050' }}>—</span>
                )}
              </div>

              {/* Signal */}
              <div style={{ alignSelf: 'center' }}>
                {row.signal ? (
                  <span style={{
                    fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                    color, background: `${color}18`,
                    border: `1px solid ${color}40`,
                    padding: '3px 7px', borderRadius: 5,
                  }}>
                    {row.signal.replace(/COMPRAR|VENDER|MANTENER/g, m => m)}
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: '#1e3050', fontFamily: 'JetBrains Mono, monospace' }}>—</span>
                )}
              </div>

              {/* Conviction bar */}
              <div style={{ alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                {row.conviction !== null ? (
                  <>
                    <div style={{ width: 50, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${row.conviction}%`, height: '100%', background: color, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: '#3d5470', width: 28 }}>
                      {row.conviction}
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 10, color: '#1e3050', fontFamily: 'JetBrains Mono, monospace' }}>—</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
