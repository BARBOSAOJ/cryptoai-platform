import { useState, useEffect, useRef } from 'react'
import { Bell, Plus, Trash2, TrendingUp, TrendingDown } from 'lucide-react'
import { userApi } from '../../api'
import type { PriceAlert } from '../../interfaces'

interface Props {
  currentSymbol: string
  currentPrice?: number
}

function fmtPrice(v: number) {
  if (v >= 1000) return v.toLocaleString('en', { maximumFractionDigits: 2 })
  if (v >= 1)    return v.toFixed(4)
  return v.toFixed(6)
}

export default function AlertasPanel({ currentSymbol, currentPrice }: Props) {
  const [open, setOpen]         = useState(false)
  const [alerts, setAlerts]     = useState<PriceAlert[]>([])
  const [loading, setLoading]   = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [price, setPrice]       = useState('')
  const [direction, setDirection] = useState<'ABOVE' | 'BELOW'>('ABOVE')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) fetchAlerts()
  }, [open])

  // Auto-fill price with current market price
  useEffect(() => {
    if (open && currentPrice && !price) {
      setPrice(fmtPrice(currentPrice).replace(/,/g, ''))
    }
  }, [open, currentSymbol])

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

  const fetchAlerts = async () => {
    setLoading(true)
    try {
      const res = await userApi.getAlerts()
      setAlerts(res.data ?? [])
    } catch {
      setAlerts([])
    } finally {
      setLoading(false)
    }
  }

  const createAlert = async () => {
    const numPrice = parseFloat(price.replace(',', '.'))
    if (!price || isNaN(numPrice)) return
    setCreating(true)
    try {
      await userApi.createAlert({ symbol: currentSymbol, targetPrice: numPrice, direction })
      setPrice('')
      await fetchAlerts()
    } catch {} finally {
      setCreating(false)
    }
  }

  const deleteAlert = async (id: number) => {
    setDeleting(id)
    try {
      await userApi.deleteAlert(id)
      setAlerts(prev => prev.filter(a => a.id !== id))
    } catch {} finally {
      setDeleting(null)
    }
  }

  const pendientes = alerts.filter(a => !a.triggered)
  const disparadas = alerts.filter(a => a.triggered)
  const sym = currentSymbol.replace('USDT', '')

  return (
    <div ref={panelRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>

      {/* Bell toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: open ? 'rgba(129,140,248,0.12)' : 'transparent',
          border: `1px solid ${open ? 'rgba(129,140,248,0.35)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
          color: open ? '#818cf8' : '#3d5470', transition: 'all 0.15s',
        }}
      >
        <Bell size={13} strokeWidth={2} />
        {pendientes.length > 0 && (
          <span style={{
            fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            background: '#818cf8', color: '#fff', borderRadius: 10,
            padding: '1px 5px', lineHeight: 1.4,
          }}>
            {pendientes.length}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          width: 300, zIndex: 200,
          background: '#060e1c', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#818cf8', letterSpacing: 1 }}>
              ALERTAS · {sym}
            </span>
            {loading && <span style={{ fontSize: 10, color: '#3d5470' }}>cargando…</span>}
          </div>

          {/* Create form */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['ABOVE', 'BELOW'] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    padding: '5px 0', borderRadius: 7, fontSize: 10,
                    fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer',
                    background: direction === d
                      ? (d === 'ABOVE' ? 'rgba(46,189,133,0.15)' : 'rgba(246,70,93,0.12)')
                      : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${direction === d
                      ? (d === 'ABOVE' ? 'rgba(46,189,133,0.4)' : 'rgba(246,70,93,0.3)')
                      : 'rgba(255,255,255,0.07)'}`,
                    color: direction === d
                      ? (d === 'ABOVE' ? '#2ebd85' : '#f6465d')
                      : '#3d5470',
                  }}
                >
                  {d === 'ABOVE'
                    ? <><TrendingUp size={10} /> Por encima</>
                    : <><TrendingDown size={10} /> Por debajo</>}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={price}
                onChange={e => setPrice(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createAlert()}
                placeholder={currentPrice ? fmtPrice(currentPrice) : 'Precio objetivo'}
                style={{
                  flex: 1, background: '#0d1a2e', border: '1px solid rgba(255,255,255,0.08)',
                  color: '#ddeeff', padding: '7px 10px', borderRadius: 8,
                  fontSize: 12, fontFamily: 'JetBrains Mono, monospace', outline: 'none',
                }}
              />
              <button
                onClick={createAlert}
                disabled={creating || !price}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'rgba(129,140,248,0.15)', border: '1px solid rgba(129,140,248,0.3)',
                  color: '#818cf8', padding: '7px 12px', borderRadius: 8,
                  fontSize: 11, cursor: 'pointer', opacity: creating || !price ? 0.5 : 1,
                }}
              >
                <Plus size={13} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {/* Alerts list */}
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {!loading && pendientes.length === 0 && disparadas.length === 0 && (
              <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 11, color: '#2c4268' }}>
                Sin alertas configuradas
              </div>
            )}

            {pendientes.map(alert => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onDelete={deleteAlert}
                deleting={deleting === alert.id}
              />
            ))}

            {disparadas.length > 0 && (
              <>
                <div style={{ padding: '6px 14px 4px', fontSize: 9, color: '#2c4268', fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1 }}>
                  DISPARADAS
                </div>
                {disparadas.map(alert => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    onDelete={deleteAlert}
                    deleting={deleting === alert.id}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AlertRow({ alert, onDelete, deleting }: {
  alert: PriceAlert
  onDelete: (id: number) => void
  deleting: boolean
}) {
  const isAbove = alert.direction === 'ABOVE'
  const color   = alert.triggered ? '#3d5470' : isAbove ? '#2ebd85' : '#f6465d'
  const sym     = alert.symbol.replace('USDT', '')

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)',
      opacity: alert.triggered ? 0.45 : 1,
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: color, boxShadow: alert.triggered ? 'none' : `0 0 6px ${color}`,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#ddeeff' }}>
          {sym} {isAbove ? '↑' : '↓'} ${alert.targetPrice.toLocaleString('en', { maximumFractionDigits: 6 })}
        </div>
        <div style={{ fontSize: 9, color: '#2c4268', marginTop: 1 }}>
          {alert.triggered ? 'Disparada' : isAbove ? 'Por encima' : 'Por debajo'}
        </div>
      </div>
      <button
        onClick={() => onDelete(alert.id)}
        disabled={deleting}
        style={{
          background: 'transparent', border: 'none', color: '#2c4268',
          cursor: 'pointer', padding: 4, borderRadius: 6, opacity: deleting ? 0.4 : 1,
          display: 'flex', alignItems: 'center',
        }}
      >
        <Trash2 size={12} strokeWidth={2} />
      </button>
    </div>
  )
}
