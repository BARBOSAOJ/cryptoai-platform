import { TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'

const STEPS = ['Conectando a Binance...', 'Cargando modelos IA...', 'Inicializando terminal...']

export default function LoadingSplash() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setStep(s => (s + 1) % STEPS.length), 600)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={wrapStyle}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fade { 0%,100%{opacity:0.3} 50%{opacity:1} }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
        <div style={logoWrapStyle}>
          <TrendingUp size={22} color="#000" strokeWidth={2.5} />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.3px', marginBottom: '8px' }}>CryptoAI</div>
          <div style={{ fontSize: '11px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.5px', animation: 'fade 1.2s infinite' }}>
            {STEPS[step]}
          </div>
        </div>
        <div style={spinnerStyle} />
      </div>
    </div>
  )
}

const wrapStyle: React.CSSProperties = {
  height: '100vh', width: '100vw', background: '#060d1a',
  display: 'flex', justifyContent: 'center', alignItems: 'center',
  fontFamily: 'Inter, sans-serif', color: '#fff'
}
const logoWrapStyle: React.CSSProperties = {
  width: '52px', height: '52px', background: '#fff', borderRadius: '14px',
  display: 'flex', alignItems: 'center', justifyContent: 'center'
}
const spinnerStyle: React.CSSProperties = {
  width: '20px', height: '20px', borderRadius: '50%',
  border: '2px solid #111e35', borderTopColor: '#fff',
  animation: 'spin 0.8s linear infinite'
}