import { useEffect, useState } from 'react'

const STEPS = [
  'Conectando a Binance...',
  'Cargando modelos de IA...',
  'Inicializando terminal...',
  'Listo.',
]

const TICKERS = ['BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'PEPE', 'XRP', 'ADA', 'AVAX', 'LINK']

function MatrixCol({ left, delay, duration }: { left: number; delay: number; duration: number }) {
  return (
    <div style={{
      position: 'absolute',
      left: `${left}%`,
      top: 0,
      fontSize: '10px',
      fontFamily: 'JetBrains Mono, monospace',
      color: 'rgba(0,208,96,0.18)',
      writingMode: 'vertical-rl',
      textOrientation: 'mixed',
      letterSpacing: '8px',
      animation: `matrix-drop ${duration}s ${delay}s linear infinite`,
      userSelect: 'none',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    }}>
      {TICKERS.join('·')}
    </div>
  )
}

export default function LoadingSplash() {
  const [step, setStep]       = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const t = setInterval(() => setStep(s => Math.min(s + 1, STEPS.length - 1)), 480)
    return () => clearInterval(t)
  }, [])

  if (!visible) return null

  return (
    <div
      onClick={() => setVisible(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#060d1a',
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center', alignItems: 'center',
        overflow: 'hidden',
        animation: 'fade-in 0.5s ease',
      }}
    >
      {/* Matrix background columns */}
      {[8, 18, 28, 38, 48, 58, 68, 78, 88, 95].map((left, i) => (
        <MatrixCol key={i} left={left} delay={i * 0.4} duration={6 + i * 0.5} />
      ))}

      {/* Scanline effect */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)',
      }} />

      {/* Center content */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '28px',
        zIndex: 10, position: 'relative',
      }}>

        {/* Logo ring */}
        <div style={{ position: 'relative', width: 72, height: 72 }}>
          {/* Outer glow ring */}
          <div style={{
            position: 'absolute', inset: -6,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
            animation: 'glow-indigo 2s ease-in-out infinite',
          }} />
          {/* Spinning ring */}
          <svg viewBox="0 0 72 72" style={{
            position: 'absolute', inset: 0,
            animation: 'spin 3s linear infinite',
          }}>
            <circle cx="36" cy="36" r="32" fill="none"
              stroke="url(#ring-grad)" strokeWidth="1.5"
              strokeDasharray="50 150"
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#818cf8" stopOpacity="0.8"/>
                <stop offset="100%" stopColor="#818cf8" stopOpacity="0"/>
              </linearGradient>
            </defs>
          </svg>
          {/* Inner logo */}
          <div style={{
            position: 'absolute', inset: 6,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #0d1730 0%, #111e35 100%)',
            border: '1px solid rgba(99,102,241,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="0 0 32 32" width="28" height="28">
              <polyline
                points="4,22 10,14 16,18 22,10 28,14"
                fill="none" stroke="url(#chart-grad)" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ animation: 'draw 1.5s ease-out forwards', strokeDasharray: 60, strokeDashoffset: 60 }}
              />
              <defs>
                <linearGradient id="chart-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#818cf8"/>
                  <stop offset="100%" stopColor="#00d060"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>

        {/* Brand */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: '20px', fontWeight: 800, letterSpacing: '-0.5px',
            background: 'linear-gradient(90deg, #c8d8ec, #818cf8)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: '4px',
          }}>
            CryptoAI
          </div>
          <div style={{
            fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
            color: 'var(--text-4)', letterSpacing: '3px', textTransform: 'uppercase',
          }}>
            Terminal v4.0
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ width: 200, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
          <div style={{
            width: '100%', height: 2,
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 1, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 1,
              background: 'linear-gradient(90deg, #818cf8, #00d060)',
              width: `${Math.round((step / (STEPS.length - 1)) * 100)}%`,
              transition: 'width 0.4s ease',
              boxShadow: '0 0 8px rgba(99,102,241,0.5)',
            }} />
          </div>
          <div style={{
            fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
            color: step === STEPS.length - 1 ? '#00d060' : 'var(--text-4)',
            letterSpacing: '0.5px',
            transition: 'color 0.3s',
            height: 16,
          }}>
            {STEPS[step]}
          </div>
        </div>
      </div>
    </div>
  )
}
