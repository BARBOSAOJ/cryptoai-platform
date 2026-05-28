import { useState, useEffect } from 'react'
import { Layers } from 'lucide-react'
import { aiClient } from '../../api'

interface TfData {
  signal:          number
  trend:           'BULLISH' | 'BEARISH' | 'NEUTRAL'
  rsi?:            number
  macd_histogram?: number
}

interface MtfResponse {
  signal:     number
  confluence: number
  timeframes: Record<string, TfData>
  dominant:   'BULLISH' | 'BEARISH' | 'NEUTRAL'
  agreement:  number
  total:      number
}

interface Props { symbol: string }

const TF_ORDER = ['1m', '15m', '1h', '4h']
const TF_LABEL: Record<string, string> = { '1m': '1M', '15m': '15M', '1h': '1H', '4h': '4H' }

const TREND_COLOR = {
  BULLISH: '#2ebd85',
  BEARISH: '#f6465d',
  NEUTRAL: '#818cf8',
}

function signalLabel(trend: string) {
  if (trend === 'BULLISH') return '▲'
  if (trend === 'BEARISH') return '▼'
  return '—'
}

export default function MultiTimeframe({ symbol }: Props) {
  const [data, setData]       = useState<MtfResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const fetch = async () => {
    setLoading(true)
    try {
      const res = await aiClient.get<MtfResponse>(`/multi-timeframe/${symbol}`)
      setData(res.data)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch()
    const t = setInterval(fetch, 60_000)
    return () => clearInterval(t)
  }, [symbol])

  const domColor = data ? TREND_COLOR[data.dominant] : '#3d5470'

  return (
    <div style={{
      background: 'var(--bg-panel)', borderTop: '1px solid var(--border)',
      padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 12,
      flexShrink: 0,
    }}>
      {/* Label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
        <Layers size={11} color="#3d5470" strokeWidth={2} />
        <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: '#1e3050', letterSpacing: '0.8px' }}>MTF</span>
      </div>

      {loading && !data && (
        <span style={{ fontSize: 10, color: '#1e3050', fontFamily: 'JetBrains Mono, monospace' }}>calculando…</span>
      )}

      {/* Per-timeframe chips */}
      {data && (
        <>
          {TF_ORDER.map(tf => {
            const tfData = data.timeframes[tf]
            if (!tfData) return null
            const color = TREND_COLOR[tfData.trend]
            return (
              <div
                key={tf}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 6,
                  background: `${color}12`,
                  border: `1px solid ${color}30`,
                }}
                title={`RSI: ${tfData.rsi?.toFixed(1) ?? '—'}`}
              >
                <span style={{ fontSize: 9, color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>
                  {TF_LABEL[tf]}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>
                  {signalLabel(tfData.trend)}
                </span>
              </div>
            )
          })}

          {/* Separator */}
          <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />

          {/* Confluence summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#1e3050', fontFamily: 'JetBrains Mono, monospace' }}>CONFLUENCIA</span>
            <div style={{ width: 36, height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${data.confluence * 100}%`, height: '100%', background: domColor, borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: domColor, fontFamily: 'JetBrains Mono, monospace' }}>
              {Math.round(data.confluence * 100)}%
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <span style={{
              fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
              color: domColor, padding: '2px 6px', borderRadius: 5,
              background: `${domColor}12`, border: `1px solid ${domColor}30`,
            }}>
              {data.dominant}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
