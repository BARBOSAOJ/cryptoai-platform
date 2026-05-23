import { useState, useEffect } from 'react'
import { aiClient } from '../../api'
import { TrendingUp, Target, BarChart2, RefreshCw } from 'lucide-react'

interface BucketCalibracion {
  rango: string
  señales: number
  correctas: number
  accuracy: number
  conv_media: number
  calibracion_error: number
}

interface TrackRecordGlobal {
  evaluadas: number
  correctas: number
  tasa_acierto: number
}

interface Rendimiento {
  track_record_global: TrackRecordGlobal
  calibracion: BucketCalibracion[]
  por_simbolo: Record<string, BucketCalibracion[]>
}

export default function BtRendimientoPanel() {
  const [data, setData]       = useState<Rendimiento | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  const cargar = async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await aiClient.get<Rendimiento>('/chat/rendimiento')
      setData(res.data)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  if (loading) return (
    <div style={wrapStyle}>
      <div style={{ fontSize: '11px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace' }}>Cargando rendimiento de BT...</div>
    </div>
  )

  if (error || !data) return (
    <div style={wrapStyle}>
      <div style={{ fontSize: '11px', color: '#486080', fontFamily: 'JetBrains Mono, monospace' }}>
        Sin datos suficientes aún. BT necesita acumular predicciones evaluadas (≥4h tras emitirlas).
      </div>
    </div>
  )

  const tr = data.track_record_global
  const cal = data.calibracion
  const simbolos = Object.keys(data.por_simbolo)

  return (
    <div style={wrapStyle}>

      {/* ── Track record global ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div style={sectionLabelStyle}>Rendimiento global de BT</div>
        <button onClick={cargar} style={refreshBtnStyle} title="Actualizar">
          <RefreshCw size={11} strokeWidth={1.75} />
        </button>
      </div>

      {tr?.evaluadas > 0 ? (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          <MetricCard label="Señales evaluadas" value={String(tr.evaluadas)} icon={<BarChart2 size={14} color="#818cf8" />} />
          <MetricCard label="Aciertos" value={String(tr.correctas)} icon={<Target size={14} color="#00d060" />} />
          <MetricCard
            label="Tasa de acierto"
            value={`${tr.tasa_acierto}%`}
            icon={<TrendingUp size={14} color={tr.tasa_acierto >= 50 ? '#00d060' : '#ff3b3b'} />}
            highlight={tr.tasa_acierto >= 50 ? '#00d060' : '#ff3b3b'}
          />
        </div>
      ) : (
        <div style={{ fontSize: '11px', color: '#486080', fontFamily: 'JetBrains Mono, monospace', marginBottom: '20px' }}>
          Sin predicciones evaluadas todavía.
        </div>
      )}

      {/* ── Calibración del conviction score ─────────────────────────────── */}
      {cal.length > 0 && (
        <>
          <div style={sectionLabelStyle}>Calibración del conviction score</div>
          <div style={{ fontSize: '10px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', marginBottom: '10px' }}>
            Una IA bien calibrada tiene accuracy ≈ conviction medio. Error positivo = sobreconfiado.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px' }}>
            {cal.map(b => {
              const barW = Math.max(4, b.accuracy)
              const color = b.accuracy >= 60 ? '#00d060' : b.accuracy >= 40 ? '#f59e0b' : '#ff3b3b'
              const errColor = Math.abs(b.calibracion_error) < 5 ? '#00d060' : '#f59e0b'
              return (
                <div key={b.rango} style={rowStyle}>
                  <div style={{ width: '130px', fontSize: '10px', color: '#c8d8ec', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
                    {b.rango}
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flex: 1, height: '6px', background: '#111e35', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${barW}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.4s' }} />
                    </div>
                    <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color, width: '36px', textAlign: 'right' }}>
                      {b.accuracy}%
                    </span>
                  </div>
                  <div style={{ fontSize: '9px', color: '#486080', fontFamily: 'JetBrains Mono, monospace', width: '60px', textAlign: 'right' }}>
                    {b.señales} señales
                  </div>
                  <div style={{ fontSize: '9px', color: errColor, fontFamily: 'JetBrains Mono, monospace', width: '80px', textAlign: 'right' }}>
                    error {b.calibracion_error > 0 ? '+' : ''}{b.calibracion_error}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Desglose por símbolo ──────────────────────────────────────────── */}
      {simbolos.length > 0 && (
        <>
          <div style={sectionLabelStyle}>Por símbolo</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {simbolos.map(sym => {
              const buckets = data.por_simbolo[sym]
              const total   = buckets.reduce((acc, b) => acc + b.señales, 0)
              const ok      = buckets.reduce((acc, b) => acc + b.correctas, 0)
              const acc     = total > 0 ? Math.round(ok / total * 100) : 0
              const color   = acc >= 60 ? '#00d060' : acc >= 40 ? '#f59e0b' : '#ff3b3b'
              return (
                <div key={sym} style={symChipStyle}>
                  <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: '#c8d8ec' }}>
                    {sym.replace('USDT', '')}
                  </span>
                  <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color }}>
                    {acc}%
                  </span>
                  <span style={{ fontSize: '9px', color: '#2c4268' }}>{total} señales</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function MetricCard({ label, value, icon, highlight }: {
  label: string; value: string; icon: React.ReactNode; highlight?: string
}) {
  return (
    <div style={{ flex: 1, background: '#091220', border: '1px solid #111e35', borderRadius: '10px', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        {icon}
        <span style={{ fontSize: '9px', color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '1px', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: highlight || '#c8d8ec' }}>{value}</div>
    </div>
  )
}

const wrapStyle: React.CSSProperties = {
  padding: '0',
}
const sectionLabelStyle: React.CSSProperties = {
  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#1e3050',
  letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '10px', display: 'block',
}
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px',
  background: '#091220', border: '1px solid #111e35',
  borderRadius: '8px', padding: '8px 12px',
}
const symChipStyle: React.CSSProperties = {
  background: '#091220', border: '1px solid #111e35', borderRadius: '9px',
  padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '80px',
}
const refreshBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid #1a2840', borderRadius: '6px',
  color: '#486080', cursor: 'pointer', padding: '4px 6px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
