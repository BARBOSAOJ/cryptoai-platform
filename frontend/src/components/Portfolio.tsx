import { Wallet, TrendingUp, BarChart3 } from 'lucide-react'

export default function Portfolio({ user }: any) {
  return (
    <div style={{ padding: '40px', background: '#080808', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '40px' }}>
        <div style={statBox}>
          <div style={{ color: '#848e9c', fontSize: '12px', marginBottom: '10px' }}>PATRIMONIO ESTIMADO</div>
          <div style={{ fontSize: '32px', fontWeight: '900' }}>${user.balance?.toLocaleString() || '12,500.00'}</div>
          <div style={{ color: '#089981', fontSize: '12px', marginTop: '5px' }}>+4.52% hoy</div>
        </div>
        <div style={statBox}>
          <div style={{ color: '#848e9c', fontSize: '12px', marginBottom: '10px' }}>PROFIT IA (P&L)</div>
          <div style={{ fontSize: '32px', fontWeight: '900', color: '#FCD535' }}>+$1,420.15</div>
          <div style={{ color: '#848e9c', fontSize: '12px', marginTop: '5px' }}>Basado en últimas 24h</div>
        </div>
      </div>

      <h3 style={{ marginBottom: '20px', fontSize: '14px', color: '#848e9c' }}>DISTRIBUCIÓN DE ACTIVOS</h3>
      <div style={{ background: '#0b0e11', borderRadius: '16px', border: '1px solid #1a1a1a' }}>
        {['BTC', 'ETH', 'SOL', 'PEPE'].map((coin, i) => (
          <div key={coin} style={{ display: 'flex', justifyContent: 'space-between', padding: '20px', borderBottom: i === 3 ? 'none' : '1px solid #1a1a1a' }}>
            <span style={{ fontWeight: 'bold' }}>{coin}</span>
            <span style={{ fontFamily: 'monospace' }}>{(Math.random() * 2).toFixed(4)} {coin}</span>
            <span style={{ color: '#089981' }}>+{(Math.random() * 5).toFixed(2)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const statBox = { background: '#0b0e11', padding: '30px', borderRadius: '20px', border: '1px solid #1a1a1a' }