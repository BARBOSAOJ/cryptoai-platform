import { TrendingUp, Activity } from 'lucide-react'

export default function MemeRadar({ marketData, aiInsights, onSelect }: any) {
  const memes = ["PEPEUSDT", "DOGEUSDT", "SHIBUSDT", "WIFUSDT", "BONKUSDT", "FLOKIUSDT"]

  return (
    <div style={{ padding: '40px', overflowY: 'auto', height: '100%' }}>
      <h2 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '30px' }}>Meme Radar Detector</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
        {memes.map(id => {
          const isHot = aiInsights[id]?.signal === 'COMPRAR 🚀'
          return (
            <div key={id} style={{ 
              background: '#161a1e', padding: '25px', borderRadius: '20px', 
              border: `1px solid ${isHot ? '#089981' : '#2b3139'}`, position: 'relative' 
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#848e9c', fontSize: '12px' }}>
                <span>{id}</span>
                <Activity size={14} />
              </div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', margin: '15px 0' }}>
                ${marketData[id]?.price?.toFixed(8) || '0.00'}
              </div>
              <div style={{ 
                background: isHot ? 'rgba(8,153,129,0.1)' : 'rgba(255,255,255,0.03)', 
                color: isHot ? '#089981' : '#848e9c', padding: '8px', borderRadius: '8px', textAlign: 'center', fontSize: '12px'
              }}>
                IA: {aiInsights[id]?.signal || 'ANALIZANDO'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
