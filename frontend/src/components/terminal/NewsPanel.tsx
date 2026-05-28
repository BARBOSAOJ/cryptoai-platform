import { useState, useEffect } from 'react'
import { RefreshCw, Newspaper } from 'lucide-react'
import { aiClient } from '../../api'

interface NewsItem {
  title:  string
  source: string
  impact: number
  label:  string
  symbol: string
}

interface Props {
  currentSymbol: string
}

function impactColor(impact: number) {
  if (impact > 0.1)  return '#2ebd85'
  if (impact < -0.1) return '#f6465d'
  return '#818cf8'
}

function impactLabel(impact: number) {
  if (impact > 0.1)  return 'POS'
  if (impact < -0.1) return 'NEG'
  return 'NEU'
}

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'DOGE', 'PEPE']

export default function NewsPanel({ currentSymbol }: Props) {
  const [news, setNews]         = useState<NewsItem[]>([])
  const [loading, setLoading]   = useState(false)
  const [filter, setFilter]     = useState<string>('ALL')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const activeSym = currentSymbol.replace('USDT', '')

  const fetchNews = async () => {
    setLoading(true)
    try {
      const res = await aiClient.get<NewsItem[]>('/news', {
        params: { symbols: SYMBOLS.join(','), limit: 30 }
      })
      setNews(res.data ?? [])
      setLastUpdated(new Date())
    } catch {
      setNews([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchNews()
    const t = setInterval(fetchNews, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // When current chart symbol changes, auto-filter to it if we have news for it
  useEffect(() => {
    if (news.some(n => n.symbol === activeSym)) {
      setFilter(activeSym)
    } else {
      setFilter('ALL')
    }
  }, [activeSym, news.length])

  const filtered = filter === 'ALL' ? news : news.filter(n => n.symbol === filter)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-panel)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 8px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Newspaper size={13} color="#818cf8" strokeWidth={2} />
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#818cf8', letterSpacing: 1 }}>
              NOTICIAS
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {lastUpdated && (
              <span style={{ fontSize: 9, color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>
                {lastUpdated.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={fetchNews}
              disabled={loading}
              style={{
                background: 'transparent', border: 'none', color: '#2c4268',
                cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center',
              }}
            >
              <RefreshCw size={11} strokeWidth={2} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>
        </div>

        {/* Symbol filter */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['ALL', ...SYMBOLS].map(sym => (
            <button
              key={sym}
              onClick={() => setFilter(sym)}
              style={{
                padding: '3px 8px', borderRadius: 6, fontSize: 9,
                fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer',
                background: filter === sym ? 'rgba(129,140,248,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${filter === sym ? 'rgba(129,140,248,0.4)' : 'rgba(255,255,255,0.06)'}`,
                color: filter === sym ? '#818cf8' : '#3d5470',
              }}
            >
              {sym}
            </button>
          ))}
        </div>
      </div>

      {/* News list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && news.length === 0 && (
          <div style={{ padding: '30px 14px', textAlign: 'center', fontSize: 11, color: '#2c4268' }}>
            Cargando noticias…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: '30px 14px', textAlign: 'center', fontSize: 11, color: '#2c4268' }}>
            Sin noticias disponibles
          </div>
        )}

        {filtered.map((item, i) => {
          const color = impactColor(item.impact)
          const label = impactLabel(item.impact)

          return (
            <div
              key={i}
              style={{
                padding: '11px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              {/* Tags row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{
                  fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                  color, background: `${color}18`,
                  border: `1px solid ${color}40`,
                  padding: '1px 6px', borderRadius: 4,
                }}>
                  {label}
                </span>
                <span style={{
                  fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                  color: '#3d5470',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  padding: '1px 6px', borderRadius: 4,
                }}>
                  {item.symbol}
                </span>
                <span style={{ fontSize: 9, color: '#1e3050', marginLeft: 'auto' }}>
                  {item.source}
                </span>
              </div>

              {/* Title */}
              <div style={{
                fontSize: 12, color: '#b0c4de', lineHeight: 1.45,
                fontFamily: 'Inter, sans-serif',
              }}>
                {item.title}
              </div>

              {/* Impact bar */}
              <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 1, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.abs(item.impact) * 100}%`,
                    height: '100%', background: color, borderRadius: 1,
                    marginLeft: item.impact < 0 ? 'auto' : undefined,
                  }} />
                </div>
                <span style={{ fontSize: 9, color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', width: 32 }}>
                  {item.impact > 0 ? '+' : ''}{(item.impact * 100).toFixed(0)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
