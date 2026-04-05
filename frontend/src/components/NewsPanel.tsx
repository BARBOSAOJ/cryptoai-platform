import { Newspaper, Zap } from 'lucide-react'

export default function NewsPanel({ newsDetails }: { newsDetails: any[] }) {
  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <Newspaper size={16} color="#FCD535" />
        <span style={{ fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>AI NEWS FEED</span>
      </div>

      <div style={listStyle}>
        {newsDetails && newsDetails.length > 0 ? newsDetails.map((news, i) => (
          <div key={i} style={newsItemStyle}>
            <div style={{ fontSize: '11px', lineHeight: '1.4', marginBottom: '8px' }}>{news.title}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{
                fontSize: '9px', fontWeight: '900', padding: '2px 6px', borderRadius: '4px',
                background: news.label === 'BULLISH' ? '#08998120' : news.label === 'BEARISH' ? '#f2364520' : '#2a2e39',
                color: news.label === 'BULLISH' ? '#089981' : news.label === 'BEARISH' ? '#f23645' : '#848e9c'
              }}>
                {news.label}
              </div>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#444' }}>
                IMPACTO: {news.impact > 0 ? '+' : ''}{news.impact}
              </div>
            </div>
          </div>
        )) : (
          <div style={{ padding: '20px', textAlign: 'center', color: '#444', fontSize: '12px' }}>
            <Zap size={24} style={{ marginBottom: '10px', opacity: 0.2 }} />
            <p>Esperando noticias de mercado...</p>
          </div>
        )}
      </div>
    </div>
  )
}

const panelStyle = { width: '300px', background: '#0b0e11', borderLeft: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column' as const }
const headerStyle = { padding: '15px', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', gap: '10px' }
const listStyle = { flex: 1, overflowY: 'auto' as const, padding: '10px' }
const newsItemStyle = { background: '#161a1e', padding: '12px', borderRadius: '8px', marginBottom: '10px', border: '1px solid #2b3139' }