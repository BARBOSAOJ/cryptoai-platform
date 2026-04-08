import { useState, useEffect } from 'react'
import { FlaskConical, Play, RefreshCw, TrendingUp, Target, BarChart2 } from 'lucide-react'
import { aiClient } from '../api'

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'BNBUSDT', 'XRPUSDT']

interface CalibrationBucket {
  predicha: number
  real: number
  muestras: number
}

interface BacktestResult {
  symbol: string
  muestras: number
  accuracy: number
  precision: number
  recall: number
  sharpe_simulado: number
  calibration_curve: Record<string, CalibrationBucket>
  timestamp: string
}

export default function BacktestPanel() {
  const [symbol, setSymbol]         = useState('BTCUSDT')
  const [result, setResult]         = useState<BacktestResult | null>(null)
  const [estado, setEstado]         = useState<'idle' | 'ejecutando' | 'error'>('idle')
  const [error, setError]           = useState('')
  const [polling, setPolling]       = useState(false)

  // Al cambiar símbolo intentar cargar resultado cacheado
  useEffect(() => {
    setResult(null)
    setError('')
    setEstado('idle')
    aiClient.get<BacktestResult>(`/backtest/${symbol}`)
      .then(res => setResult(res.data))
      .catch(() => {/* sin cache, esperamos que el usuario lance */})
  }, [symbol])

  // Polling mientras ejecuta
  useEffect(() => {
    if (!polling) return
    const iv = setInterval(async () => {
      try {
        const res = await aiClient.get<any>(`/backtest/${symbol}`)
        if (res.data.estado === 'ejecutando') return
        setResult(res.data)
        setEstado('idle')
        setPolling(false)
      } catch (e: any) {
        if (e.response?.status !== 404) {
          setError('Error obteniendo resultado')
          setEstado('error')
          setPolling(false)
        }
      }
    }, 3000)
    return () => clearInterval(iv)
  }, [polling, symbol])

  const lanzar = async () => {
    setError('')
    setEstado('ejecutando')
    setResult(null)
    try {
      await aiClient.post(`/backtest/${symbol}`)
      setPolling(true)
    } catch (e: any) {
      if (e.response?.status === 409) {
        setEstado('ejecutando')
        setPolling(true)
      } else {
        setError('No se pudo lanzar el backtest')
        setEstado('error')
      }
    }
  }

  const buckets = result ? Object.values(result.calibration_curve) : []
  const maxReal = buckets.length ? Math.max(...buckets.map(b => b.real)) : 100

  return (
    <div style={{ marginTop: '24px' }}>
      {/* Header de sección */}
      <div style={sectionLabelStyle}>Backtesting y calibración</div>

      {/* Panel principal */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
          <div style={{ ...iconWrapStyle, background: 'rgba(99,102,241,0.12)' }}>
            <FlaskConical size={16} strokeWidth={1.75} color="#818cf8" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>
              Calibración isotónica de confianza
            </div>
            <div style={{ fontSize: '11px', color: '#2c4268' }}>
              Ajusta la confianza del modelo con su precisión histórica real (6 meses, Binance 1h)
            </div>
          </div>

          {/* Selector de símbolo */}
          <select
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            style={selectStyle}
          >
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Botón lanzar */}
          <button
            onClick={lanzar}
            disabled={estado === 'ejecutando'}
            style={btnStyle(estado === 'ejecutando')}
          >
            {estado === 'ejecutando'
              ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Ejecutando…</>
              : <><Play size={12} /> Ejecutar</>}
          </button>
        </div>

        {error && (
          <div style={{ fontSize: '11px', color: '#ff3b3b', marginBottom: '12px', padding: '8px 12px', background: 'rgba(255,59,59,0.07)', borderRadius: '8px' }}>
            {error}
          </div>
        )}

        {estado === 'ejecutando' && !result && (
          <div style={{ fontSize: '11px', color: '#818cf8', padding: '16px 0', textAlign: 'center' }}>
            Descargando 6 meses de historial y calibrando… puede tardar 1-2 minutos.
          </div>
        )}

        {result && (
          <>
            {/* Métricas clave */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '20px' }}>
              <MetricCard label="Accuracy" value={`${(result.accuracy * 100).toFixed(1)}%`} icon={<Target size={13} color="#00d060" />} color="#00d060" />
              <MetricCard label="Precision" value={`${(result.precision * 100).toFixed(1)}%`} icon={<TrendingUp size={13} color="#818cf8" />} color="#818cf8" />
              <MetricCard label="Recall" value={`${(result.recall * 100).toFixed(1)}%`} icon={<BarChart2 size={13} color="#2dd4bf" />} color="#2dd4bf" />
              <MetricCard label="Sharpe" value={result.sharpe_simulado.toFixed(2)} icon={<BarChart2 size={13} color="#f59e0b" />} color="#f59e0b" />
            </div>

            {/* Curva de calibración */}
            <div style={{ marginBottom: '8px', fontSize: '11px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1px', textTransform: 'uppercase' }}>
              Curva de calibración · {result.muestras} muestras
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {buckets.map(b => (
                <div key={b.predicha} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: '#4a6080', width: '36px', textAlign: 'right' }}>
                    {b.predicha}%
                  </div>
                  {/* Barra predicha */}
                  <div style={{ flex: 1, height: '6px', background: '#111e35', borderRadius: '3px', position: 'relative' }}>
                    <div style={{
                      position: 'absolute', left: 0, top: 0, height: '100%',
                      width: `${(b.predicha / 100) * 100}%`,
                      background: '#1a2840', borderRadius: '3px'
                    }} />
                    {/* Barra real */}
                    <div style={{
                      position: 'absolute', left: 0, top: 0, height: '100%',
                      width: `${(b.real / 100) * 100}%`,
                      background: b.real >= b.predicha - 5 ? '#00d060' : '#ff3b3b',
                      borderRadius: '3px', opacity: 0.85
                    }} />
                  </div>
                  <div style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', width: '36px', color: b.real >= b.predicha - 5 ? '#00d060' : '#ff3b3b' }}>
                    {b.real}%
                  </div>
                  <div style={{ fontSize: '9px', color: '#1e3050', width: '50px', textAlign: 'right' }}>
                    n={b.muestras}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '12px', fontSize: '10px', color: '#1e3050', fontFamily: 'JetBrains Mono, monospace' }}>
              Gris = confianza predicha · Color = precisión real · Actualizado: {new Date(result.timestamp).toLocaleString()}
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function MetricCard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div style={{ background: '#060d1a', border: '1px solid #111e35', borderRadius: '10px', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        {icon}
        <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#2c4268', letterSpacing: '1px', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontSize: '18px', fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
    </div>
  )
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#1e3050',
  letterSpacing: '2px', textTransform: 'uppercase', padding: '0 4px', marginBottom: '8px'
}
const cardStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', borderRadius: '12px', padding: '16px'
}
const iconWrapStyle: React.CSSProperties = {
  width: '34px', height: '34px', borderRadius: '9px',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
}
const selectStyle: React.CSSProperties = {
  background: '#111e35', border: '1px solid #1a2840', color: '#fff',
  padding: '7px 10px', borderRadius: '8px', fontSize: '11px',
  fontFamily: 'Inter, sans-serif', cursor: 'pointer', outline: 'none'
}
const btnStyle = (disabled: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: '6px',
  background: disabled ? '#111e35' : 'rgba(99,102,241,0.15)',
  border: `1px solid ${disabled ? '#1a2840' : 'rgba(99,102,241,0.3)'}`,
  color: disabled ? '#2c4268' : '#818cf8',
  padding: '7px 14px', borderRadius: '8px', fontSize: '11px',
  fontFamily: 'Inter, sans-serif', cursor: disabled ? 'not-allowed' : 'pointer',
  whiteSpace: 'nowrap'
})
