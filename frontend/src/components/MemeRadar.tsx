import { useState, useEffect } from 'react'
import { aiClient } from '../api'
import { Activity, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'

interface MemeAnalysis {
  symbol: string
  signal: string
  sentiment: string
  confidence: number
  alert: 'HIGH' | 'MEDIUM' | 'NONE'
}

const QUOTES_FILTER = ['ALL', 'USDT', 'BTC', 'ETH', 'BNB'] as const
type QuoteFilter = typeof QUOTES_FILTER[number]

export default function MemeRadar({ onSelect, marketData }: any) {
  const [radarData, setRadarData] = useState<MemeAnalysis[]>([])
  const [scanning, setScanning] = useState(true)
  const [error, setError] = useState(false)
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>('USDT')

  useEffect(() => {
    scan()
    const t = setInterval(scan, 15000)
    return () => clearInterval(t)
  }, [])

  const scan = async () => {
    setScanning(true)
    setError(false)
    try {
      const res = await aiClient.get('/trending-radar')
      if (res.data?.length > 0) setRadarData(res.data)
      else setError(true)
    } catch {
      setError(true)
    } finally {
      setTimeout(() => setScanning(false), 1000)
    }
  }

  return (
    <div style={wrapStyle}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      <div style={topBarStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Activity size={16} strokeWidth={1.75} style={{ animation: scanning ? 'pulse 1.2s infinite' : 'none', color: scanning ? '#fff' : '#2c4268' }} />
          <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.3px' }}>MemeRadar</span>
          <span style={{ fontSize: '10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>
            {Object.keys(marketData).length} pares
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Filtro de moneda base */}
          <div style={{ display: 'flex', gap: '3px' }}>
            {QUOTES_FILTER.map(q => (
              <button key={q} onClick={() => setQuoteFilter(q)} style={{
                fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', padding: '4px 8px',
                borderRadius: '5px', cursor: 'pointer', border: '1px solid',
                borderColor: quoteFilter === q ? '#243858' : 'transparent',
                background: quoteFilter === q ? '#111e35' : 'transparent',
                color: quoteFilter === q ? '#fff' : '#2c4268'
              }}>{q}</button>
            ))}
          </div>
          <span style={statusStyle(error, scanning)}>
            {error ? 'IA offline' : scanning ? 'Escaneando...' : 'En vivo'}
          </span>
        </div>
      </div>

      {error ? (
        <div style={errorStyle}>
          <AlertTriangle size={28} color="#2c4268" strokeWidth={1.5} style={{ marginBottom: '12px' }} />
          <p style={{ fontSize: '13px', color: '#2c4268', margin: 0 }}>Motor IA desconectado. Reinicia ai-engine.</p>
        </div>
      ) : (
        <div style={gridStyle}>
          {radarData
            .filter(m => quoteFilter === 'ALL' || m.symbol.endsWith(quoteFilter))
            .map(meme => {
              const isBuy  = meme.signal.includes('COMPRAR') || meme.signal.includes('BUY')
              const price  = parseFloat(marketData[meme.symbol]?.price || '0')
              const change = marketData[meme.symbol]?.change || '+0.00%'
              const isPos  = !change.startsWith('-')
              // Detectar el par de cotización para mostrar correctamente
              const quoteAsset = ['BTC','ETH','BNB','USDT','BUSD'].find(q => meme.symbol.endsWith(q)) || 'USDT'
              const baseAsset  = meme.symbol.slice(0, meme.symbol.length - quoteAsset.length)
              return (
                <div key={meme.symbol} onClick={() => onSelect(meme.symbol)} style={cardStyle(meme.alert === 'HIGH')}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', marginBottom: '2px' }}>
                        {baseAsset}
                      </div>
                      <div style={{ fontSize: '10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>/ {quoteAsset}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      <span style={signalBadgeStyle(isBuy)}>{isBuy ? 'Comprar' : 'Vender'}</span>
                      <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: isPos ? '#00d060' : '#ff3b3b' }}>{change}</span>
                    </div>
                  </div>

                  <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '-0.5px', marginBottom: '12px' }}>
                    {price > 0 ? price.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isBuy ? <TrendingUp size={12} color="#00d060" /> : <TrendingDown size={12} color="#ff3b3b" />}
                      <span style={{ fontSize: '10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>{meme.sentiment}</span>
                    </div>
                    <div style={confBarStyle}>
                      <div style={{ height: '100%', width: `${meme.confidence}%`, background: isBuy ? '#00d060' : '#ff3b3b', borderRadius: '1px', transition: 'width 0.5s' }} />
                    </div>
                    <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: '#2c4268' }}>{meme.confidence}%</span>
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}

const wrapStyle: React.CSSProperties = {
  height: '100%', display: 'flex', flexDirection: 'column',
  background: '#060d1a', padding: '24px', fontFamily: 'Inter, sans-serif', color: '#fff'
}
const topBarStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'
}
const statusStyle = (error: boolean, scanning: boolean): React.CSSProperties => ({
  fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
  color: error ? '#ff3b3b' : scanning ? '#fff' : '#00d060',
  background: error ? 'rgba(255,59,59,0.08)' : scanning ? '#111e35' : 'rgba(0,208,96,0.08)',
  border: `1px solid ${error ? 'rgba(255,59,59,0.2)' : scanning ? '#1a2840' : 'rgba(0,208,96,0.2)'}`,
  padding: '4px 10px', borderRadius: '6px', letterSpacing: '0.5px'
})
const errorStyle: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center'
}
const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px', overflowY: 'auto'
}
const cardStyle = (highlight: boolean): React.CSSProperties => ({
  background: '#091220',
  border: `1px solid ${highlight ? 'rgba(0,208,96,0.2)' : '#111e35'}`,
  borderRadius: '14px', padding: '16px', cursor: 'pointer', transition: 'border-color 0.2s'
})
const signalBadgeStyle = (isBuy: boolean): React.CSSProperties => ({
  fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
  color: isBuy ? '#00d060' : '#ff3b3b',
  background: isBuy ? 'rgba(0,208,96,0.08)' : 'rgba(255,59,59,0.08)',
  border: `1px solid ${isBuy ? 'rgba(0,208,96,0.18)' : 'rgba(255,59,59,0.18)'}`,
  padding: '3px 9px', borderRadius: '5px', letterSpacing: '0.5px'
})
const confBarStyle: React.CSSProperties = {
  flex: 1, height: '2px', background: '#111e35', borderRadius: '1px', margin: '0 8px', overflow: 'hidden'
}