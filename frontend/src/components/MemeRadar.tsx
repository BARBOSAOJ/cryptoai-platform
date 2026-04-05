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

export default function MemeRadar({ onSelect, marketData }: any) {
  const [radarData, setRadarData] = useState<MemeAnalysis[]>([])
  const [scanning, setScanning] = useState(true)
  const [error, setError] = useState(false)

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
          <Activity size={16} strokeWidth={1.75} style={{ animation: scanning ? 'pulse 1.2s infinite' : 'none', color: scanning ? '#fff' : '#333' }} />
          <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-0.3px' }}>MemeRadar</span>
        </div>
        <span style={statusStyle(error, scanning)}>
          {error ? 'IA offline' : scanning ? 'Escaneando...' : 'En vivo'}
        </span>
      </div>

      {error ? (
        <div style={errorStyle}>
          <AlertTriangle size={28} color="#333" strokeWidth={1.5} style={{ marginBottom: '12px' }} />
          <p style={{ fontSize: '13px', color: '#333', margin: 0 }}>Motor IA desconectado. Reinicia ai-engine.</p>
        </div>
      ) : (
        <div style={gridStyle}>
          {radarData.map(meme => {
            const isBuy = meme.signal.includes('COMPRAR') || meme.signal.includes('BUY')
            const price = parseFloat(marketData[meme.symbol]?.price || '0')
            return (
              <div key={meme.symbol} onClick={() => onSelect(meme.symbol)} style={cardStyle(meme.alert === 'HIGH')}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', marginBottom: '2px' }}>
                      {meme.symbol.replace('USDT', '')}
                    </div>
                    <div style={{ fontSize: '10px', color: '#333', fontFamily: 'JetBrains Mono, monospace' }}>/ USDT</div>
                  </div>
                  <span style={signalBadgeStyle(isBuy)}>{isBuy ? 'Comprar' : 'Vender'}</span>
                </div>

                <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '-0.5px', marginBottom: '12px' }}>
                  ${price > 0 ? price.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isBuy ? <TrendingUp size={12} color="#00d060" /> : <TrendingDown size={12} color="#ff3b3b" />}
                    <span style={{ fontSize: '10px', color: '#333', fontFamily: 'JetBrains Mono, monospace' }}>{meme.sentiment}</span>
                  </div>
                  <div style={confBarStyle}>
                    <div style={{ height: '100%', width: `${meme.confidence}%`, background: isBuy ? '#00d060' : '#ff3b3b', borderRadius: '1px', transition: 'width 0.5s' }} />
                  </div>
                  <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: '#333' }}>{meme.confidence}%</span>
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
  background: '#000', padding: '24px', fontFamily: 'Inter, sans-serif', color: '#fff'
}
const topBarStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'
}
const statusStyle = (error: boolean, scanning: boolean): React.CSSProperties => ({
  fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
  color: error ? '#ff3b3b' : scanning ? '#fff' : '#00d060',
  background: error ? 'rgba(255,59,59,0.08)' : scanning ? '#111' : 'rgba(0,208,96,0.08)',
  border: `1px solid ${error ? 'rgba(255,59,59,0.2)' : scanning ? '#1a1a1a' : 'rgba(0,208,96,0.2)'}`,
  padding: '4px 10px', borderRadius: '6px', letterSpacing: '0.5px'
})
const errorStyle: React.CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center'
}
const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px', overflowY: 'auto'
}
const cardStyle = (highlight: boolean): React.CSSProperties => ({
  background: '#080808',
  border: `1px solid ${highlight ? 'rgba(0,208,96,0.2)' : '#111'}`,
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
  flex: 1, height: '2px', background: '#111', borderRadius: '1px', margin: '0 8px', overflow: 'hidden'
}