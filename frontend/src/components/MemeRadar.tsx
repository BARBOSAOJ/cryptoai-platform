import { useState, useEffect } from 'react'
import axios from 'axios'
import { Coins, TrendingUp, TrendingDown, AlertTriangle, Radio, Activity } from 'lucide-react'

interface MemeAnalysis {
  symbol: string
  signal: string
  sentiment: string
  confidence: number
  tech_impact: number
  news_impact: number
  alert: 'HIGH' | 'MEDIUM' | 'NONE'
}

export default function MemeRadar({ onSelect, marketData }: any) {
  const [radarData, setRadarData] = useState<MemeAnalysis[]>([])
  const [scanning, setScanning] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    scanMemes()
    const interval = setInterval(scanMemes, 15000)
    return () => clearInterval(interval)
  }, [])

  const scanMemes = async () => {
    setScanning(true)
    setError(false)
    try {
      const res = await axios.get('http://localhost:8002/trending-radar')
      if (res.data && res.data.length > 0) {
        setRadarData(res.data)
      } else {
        setError(true)
      }
    } catch (e) {
      setError(true)
    } finally {
      setTimeout(() => setScanning(false), 1500)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#080808', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Radio size={24} color="#FCD535" style={{ animation: scanning ? 'pulse 1.5s infinite' : 'none' }} />
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '900', letterSpacing: '1px' }}>MEME<span style={{ color: '#FCD535' }}>RADAR</span> AI</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: error ? '#f23645' : scanning ? '#FCD535' : '#089981' }}>
          <Activity size={14} />
          {error ? 'ERROR DE CONEXIÓN CON IA' : scanning ? 'ESCANEA REDES & MERCADO...' : 'SISTEMA ACTIVO - MONITOREANDO'}
        </div>
      </div>

      {error ? (
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#444', flexDirection: 'column' }}>
          <AlertTriangle size={48} style={{ marginBottom: '10px' }} />
          <p>El motor de IA está fuera de línea. Reinicia ai-engine.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px', overflowY: 'auto' }}>
          {radarData.map((meme) => {
            const isBuy = meme.signal.includes('COMPRAR')
            const priceInfo = marketData[meme.symbol]
            const currentPrice = priceInfo?.price || 0

            return (
              <div
                key={meme.symbol}
                onClick={() => onSelect(meme.symbol)}
                style={{
                  background: '#111418', borderRadius: '12px', padding: '15px',
                  border: meme.alert === 'HIGH' ? '1px solid #089981' : '1px solid #1a1a1a',
                  cursor: 'pointer', position: 'relative', overflow: 'hidden'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ background: '#FCD53520', padding: '8px', borderRadius: '50%', color: '#FCD535' }}><Coins size={20} /></div>
                    <div style={{ fontWeight: 'bold' }}>{meme.symbol}</div>
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 'bold' }}>${currentPrice.toLocaleString()}</div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ color: isBuy ? '#089981' : '#f23645', fontWeight: 'bold', fontSize: '12px' }}>{meme.signal}</div>
                  <div style={{ fontSize: '12px', fontWeight: 'bold' }}>{meme.confidence}% CONF.</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <style>{`@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }`}</style>
    </div>
  )
}