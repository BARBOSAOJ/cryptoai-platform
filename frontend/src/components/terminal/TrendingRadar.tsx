import { useState, useEffect, useRef } from 'react'
import { Flame } from 'lucide-react'
import { aiClient } from '../../api'

interface TrendingItem {
  symbol:     string
  signal:     string
  sentiment:  'BULLISH' | 'BEARISH' | 'NEUTRAL'
  confidence: number
  news_impact: number
  alert:      'HIGH' | 'MEDIUM'
}

interface Props {
  onSymbolClick: (symbol: string) => void
}

const SENTIMENT_COLOR = {
  BULLISH: '#2ebd85',
  BEARISH: '#f6465d',
  NEUTRAL: '#818cf8',
}

export default function TrendingRadar({ onSymbolClick }: Props) {
  const [open, setOpen]       = useState(false)
  const [items, setItems]     = useState<TrendingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const fetchRadar = async () => {
    setLoading(true)
    try {
      const res = await aiClient.get<TrendingItem[]>('/trending-radar')
      setItems(res.data ?? [])
      setLastUpdated(new Date())
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && items.length === 0) fetchRadar()
  }, [open])

  // Refresh every 60s while open
  useEffect(() => {
    if (!open) return
    const t = setInterval(fetchRadar, 60_000)
    return () => clearInterval(t)
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const highAlerts = items.filter(i => i.alert === 'HIGH').length

  return (
    <div ref={panelRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>

      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: open ? 'rgba(251,146,60,0.12)' : 'transparent',
          border: `1px solid ${open ? 'rgba(251,146,60,0.35)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
          color: open ? '#fb923c' : '#3d5470', transition: 'all 0.15s',
        }}
      >
        <Flame size={13} strokeWidth={2} />
        <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>RADAR</span>
        {highAlerts > 0 && (
          <span style={{
            fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            background: '#fb923c', color: '#fff', borderRadius: 10,
            padding: '1px 5px', lineHeight: 1.4,
          }}>
            {highAlerts}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
          width: 280, zIndex: 200,
          background: '#060e1c', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, boxShadow: '0 -8px 32px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '11px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#fb923c', letterSpacing: 1 }}>
              TRENDING RADAR
            </span>
            <span style={{ fontSize: 9, color: '#2c4268' }}>
              {loading ? 'actualizando…' : lastUpdated ? `${lastUpdated.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          </div>

          {/* Items */}
          {items.length === 0 && !loading && (
            <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 11, color: '#2c4268' }}>
              Sin datos de radar
            </div>
          )}

          {items.map(item => {
            const sym = item.symbol.replace('USDT', '')
            const color = SENTIMENT_COLOR[item.sentiment]
            const signalClean = item.signal.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim()

            return (
              <div
                key={item.symbol}
                onClick={() => { onSymbolClick(item.symbol); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer', transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Sentiment dot */}
                <div style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: color,
                  boxShadow: item.alert === 'HIGH' ? `0 0 6px ${color}` : 'none',
                }} />

                {/* Symbol */}
                <div style={{ width: 44, fontSize: 11, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color: '#ddeeff', flexShrink: 0 }}>
                  {sym}
                </div>

                {/* Signal */}
                <div style={{ flex: 1, fontSize: 10, color: color, fontFamily: 'JetBrains Mono, monospace' }}>
                  {signalClean}
                </div>

                {/* Confidence bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 40, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${item.confidence}%`, height: '100%', background: color, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 9, color: '#3d5470', fontFamily: 'JetBrains Mono, monospace', width: 26 }}>
                    {item.confidence}%
                  </span>
                </div>
              </div>
            )
          })}

          <div style={{ padding: '8px 14px', fontSize: 9, color: '#1a2840', fontFamily: 'JetBrains Mono, monospace' }}>
            Click en un activo para ver su chart · Actualiza cada 60s
          </div>
        </div>
      )}
    </div>
  )
}
