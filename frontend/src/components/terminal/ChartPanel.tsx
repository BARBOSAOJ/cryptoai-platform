import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  AreaSeries,
  CandlestickSeries,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type AreaData,
  type CandlestickData,
} from 'lightweight-charts'
import { aiClient, apiClient } from '../../api'

interface Props { symbol: string; insight?: any }

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1W'] as const
type Interval = typeof INTERVALS[number]
type ChartType = 'area' | 'candle'

const C = {
  bg:      '#06101e',
  surface: '#091422',
  border:  'rgba(255,255,255,0.05)',
  dimText: '#3d5470',
  midText: '#6888aa',
  white:   '#ddeeff',
  blue:    '#3b82f6',
  green:   '#2ebd85',
  greenBg: 'rgba(46,189,133,0.14)',
  greenBd: 'rgba(46,189,133,0.28)',
  red:     '#f6465d',
  redBg:   'rgba(246,70,93,0.1)',
  redBd:   'rgba(246,70,93,0.25)',
}

function fmtPrice(v: number) {
  if (v < 0.0001) return v.toFixed(8)
  if (v < 1)      return v.toFixed(6)
  if (v < 10)     return v.toFixed(4)
  return v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtTime(ts: number, iv: Interval) {
  const d = new Date(ts * 1000)
  if (iv === '1d' || iv === '1W') return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' })
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}
function intervalParam(iv: Interval) {
  return iv === '1W' ? '1w' : iv.toLowerCase()
}

interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }
interface Hover { time: string; price: string; o?: string; h?: string; l?: string; c?: string; v?: string; up: boolean }

export default function ChartPanel({ symbol, insight }: Props) {
  const wrapRef   = useRef<HTMLDivElement>(null)
  const chartRef  = useRef<IChartApi | null>(null)
  const areaRef   = useRef<ISeriesApi<'Area'>        | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const ivRef     = useRef<Interval>('1h')
  const typeRef   = useRef<ChartType>('area')

  const [iv,         setIv]        = useState<Interval>('1m')
  const [type,       setType]      = useState<ChartType>('area')
  const [lastBar,    setLastBar]   = useState<Bar | null>(null)
  const [prevClose,  setPrev]      = useState<number | null>(null)
  const [hover,      setHover]     = useState<Hover | null>(null)
  const [loading,    setLoading]   = useState(true)
  const [error,      setError]     = useState(false)
  const [showAI,     setShowAI]    = useState(true)

  const isBuy      = insight?.signal?.includes('COMPRAR')
  const confidence = parseInt(insight?.confidence || '50')
  const pct        = lastBar && prevClose ? ((lastBar.close - prevClose) / prevClose) * 100 : 0
  const up         = pct >= 0

  // ─── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!wrapRef.current) return

    const chart = createChart(wrapRef.current, {
      layout:    { background: { color: C.bg }, textColor: C.dimText, fontFamily: 'Inter, sans-serif', fontSize: 11 },
      grid:      { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
      crosshair: {
        mode:     CrosshairMode.Magnet,
        vertLine: { color: 'rgba(255,255,255,0.12)', labelBackgroundColor: '#0d1e35', style: 3, width: 1 },
        horzLine: { color: 'rgba(255,255,255,0.12)', labelBackgroundColor: '#0d1e35', style: 3, width: 1 },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 }, textColor: C.dimText },
      timeScale:       { borderVisible: false, timeVisible: true, secondsVisible: false },
      handleScale:     { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      handleScroll:    { mouseWheel: true, horzTouchDrag: true, pressedMouseMove: true },
    })

    const area = chart.addSeries(AreaSeries, {
      lineColor:                      C.blue,
      topColor:                       'rgba(59,130,246,0.2)',
      bottomColor:                    'rgba(59,130,246,0)',
      lineWidth:                      2,
      crosshairMarkerVisible:         true,
      crosshairMarkerRadius:          5,
      crosshairMarkerBorderColor:     '#fff',
      crosshairMarkerBorderWidth:     2,
      crosshairMarkerBackgroundColor: C.blue,
      priceLineVisible:               false,
      lastValueVisible:               true,
    })

    const candle = chart.addSeries(CandlestickSeries, {
      upColor:         C.green,
      downColor:       C.red,
      borderUpColor:   C.green,
      borderDownColor: C.red,
      wickUpColor:     'rgba(46,189,133,0.6)',
      wickDownColor:   'rgba(246,70,93,0.6)',
      visible:         false,
    })

    chartRef.current  = chart
    areaRef.current   = area
    candleRef.current = candle

    chart.subscribeCrosshairMove(p => {
      if (!p.time || !p.seriesData.size) { setHover(null); return }
      const a = p.seriesData.get(area)   as AreaData        | undefined
      const c = p.seriesData.get(candle) as CandlestickData | undefined
      const t = fmtTime(p.time as number, ivRef.current)
      if (typeRef.current === 'area' && a) {
        setHover({ time: t, price: fmtPrice(a.value), up: true })
      } else if (typeRef.current === 'candle' && c) {
        setHover({ time: t, price: fmtPrice(c.close), o: fmtPrice(c.open), h: fmtPrice(c.high), l: fmtPrice(c.low), c: fmtPrice(c.close), up: c.close >= c.open })
      }
    })

    const ro = new ResizeObserver(() => {
      if (wrapRef.current) chart.applyOptions({ width: wrapRef.current.clientWidth, height: wrapRef.current.clientHeight })
    })
    ro.observe(wrapRef.current)
    return () => { ro.disconnect(); chart.remove(); chartRef.current = areaRef.current = candleRef.current = null }
  }, [])

  // ─── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async (interval: Interval, chartType: ChartType) => {
    if (!areaRef.current || !candleRef.current) return
    try {
      let bars: Bar[] = []
      const param = intervalParam(interval)

      if (interval === '1m') {
        try { const r = await apiClient.get(`/ohlcv/${symbol}`); bars = r.data.map((c: any) => ({ ...c, time: c.openTime })) } catch {}
      }
      if (!bars.length) {
        const r = await aiClient.get(`/candles/${symbol}`, { params: { interval: param, limit: 200 } })
        bars = r.data
      }
      if (!bars.length) { setError(true); setLoading(false); return }

      bars.sort((a, b) => a.time - b.time)

      areaRef.current.setData(bars.map(b => ({ time: b.time as any, value: b.close })))
      candleRef.current.setData(bars.map(b => ({ time: b.time as any, open: b.open, high: b.high, low: b.low, close: b.close })))

      areaRef.current.applyOptions({ visible: chartType === 'area' })
      candleRef.current.applyOptions({ visible: chartType === 'candle' })

      const first = bars[0].close, last = bars[bars.length - 1].close
      const trending = last >= first
      areaRef.current.applyOptions({
        lineColor:                      trending ? C.green : C.red,
        topColor:                       trending ? 'rgba(46,189,133,0.18)' : 'rgba(246,70,93,0.18)',
        bottomColor:                    'rgba(6,16,30,0)',
        crosshairMarkerBackgroundColor: trending ? C.green : C.red,
      })

      chartRef.current?.timeScale().fitContent()
      setLastBar(bars[bars.length - 1])
      setPrev(bars.length > 1 ? bars[bars.length - 2].close : null)
      setError(false)
      setLoading(false)
    } catch { setError(true); setLoading(false) }
  }, [symbol])

  useEffect(() => {
    ivRef.current   = iv
    typeRef.current = type
    setLoading(true); setError(false); setHover(null)
    load(iv, type)
  }, [load, iv, type])

  useEffect(() => {
    const refreshMs: Partial<Record<Interval, number>> = { '1m': 3000, '5m': 5000, '15m': 10000 }
    const ms = refreshMs[iv]
    if (!ms) return
    const id = setInterval(() => load(iv, type), ms)
    return () => clearInterval(id)
  }, [load, iv, type])

  // ─── AI Overlays ──────────────────────────────────────────────────────────
  useEffect(() => {
    const series = candleRef.current?.options().visible ? candleRef.current : areaRef.current
    if (!series) return

    // Remove all existing AI price lines before re-adding
    try { (series as any)._priceLines?.forEach((pl: any) => series.removePriceLine(pl)) } catch {}

    if (!showAI || !insight) return

    const lines: any[] = []

    if (insight.entry_price && insight.entry_price > 0) {
      lines.push(series.createPriceLine({
        price:     insight.entry_price,
        color:     '#2ebd85',
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title:     'Entrada IA',
      }))
    }

    if (insight.target_price && insight.target_price > 0) {
      lines.push(series.createPriceLine({
        price:     insight.target_price,
        color:     '#f97316',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title:     'Objetivo IA',
      }))
    }

    if (insight.predicted_next && insight.predicted_next > 0) {
      lines.push(series.createPriceLine({
        price:     insight.predicted_next,
        color:     '#3b82f6',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title:     'LSTM',
      }))
    }

    // Store references for cleanup
    ;(series as any)._priceLines = lines

    return () => {
      if (chartRef.current) {
        try { lines.forEach(pl => series.removePriceLine(pl)) } catch {}
      }
      ;(series as any)._priceLines = []
    }
  }, [insight, showAI, type])

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', height: '100%', background: C.bg, display: 'flex', flexDirection: 'column', fontFamily: 'Inter, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: '52px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div>
            <span style={{ fontSize: '15px', fontWeight: 700, color: C.white }}>{symbol.replace('USDT', '')}</span>
            <span style={{ fontSize: '11px', color: C.dimText }}>/USDT</span>
          </div>
          {lastBar && (
            <>
              <span style={{ fontSize: '22px', fontWeight: 700, color: up ? C.green : C.red, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px' }}>
                {fmtPrice(lastBar.close)}
              </span>
              {prevClose && (
                <span style={{ fontSize: '12px', fontWeight: 500, color: up ? C.green : C.red, background: up ? C.greenBg : C.redBg, border: `1px solid ${up ? C.greenBd : C.redBd}`, borderRadius: '6px', padding: '3px 9px' }}>
                  {up ? '+' : ''}{pct.toFixed(2)}%
                </span>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* AI overlay toggle */}
          <button
            onClick={() => setShowAI(v => !v)}
            style={{ background: showAI ? 'rgba(59,130,246,0.15)' : C.surface, border: `1px solid ${showAI ? 'rgba(59,130,246,0.4)' : 'transparent'}`, color: showAI ? C.blue : C.dimText, borderRadius: '7px', padding: '4px 11px', fontSize: '11px', fontWeight: showAI ? 600 : 400, cursor: 'pointer', transition: 'all 0.12s', whiteSpace: 'nowrap' }}
          >
            Overlays IA
          </button>
          {/* Tipo */}
          <div style={{ display: 'flex', background: C.surface, borderRadius: '8px', padding: '3px', gap: '2px' }}>
            {(['area', 'candle'] as ChartType[]).map(t => (
              <button key={t} onClick={() => setType(t)} style={{ background: type === t ? 'rgba(255,255,255,0.08)' : 'transparent', border: 'none', color: type === t ? C.white : C.dimText, borderRadius: '6px', padding: '4px 12px', fontSize: '11px', fontWeight: type === t ? 600 : 400, cursor: 'pointer', transition: 'all 0.12s' }}>
                {t === 'area' ? 'Línea' : 'Velas'}
              </button>
            ))}
          </div>
          {/* Intervalo */}
          <div style={{ display: 'flex', background: C.surface, borderRadius: '8px', padding: '3px', gap: '2px' }}>
            {INTERVALS.map(i => (
              <button key={i} onClick={() => setIv(i)} style={{ background: iv === i ? 'rgba(255,255,255,0.08)' : 'transparent', border: 'none', color: iv === i ? C.white : C.dimText, borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: iv === i ? 600 : 400, cursor: 'pointer', transition: 'all 0.12s' }}>
                {i}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* OHLCV hover */}
      {hover && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '4px 20px', borderBottom: `1px solid ${C.border}`, flexShrink: 0, minHeight: '26px' }}>
          <span style={{ fontSize: '10px', color: C.dimText }}>{hover.time}</span>
          {type === 'area'
            ? <span style={{ fontSize: '11px', color: hover.up ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>{hover.price}</span>
            : [['O', hover.o, C.midText], ['H', hover.h, C.green], ['L', hover.l, C.red], ['C', hover.c, hover.up ? C.green : C.red]].map(([l, v, col]) => (
                <span key={l as string} style={{ fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: C.dimText, fontSize: '10px', marginRight: '3px' }}>{l}</span>
                  <span style={{ color: col as string }}>{v}</span>
                </span>
              ))
          }
        </div>
      )}

      {/* Canvas */}
      <div ref={wrapRef} style={{ flex: 1, position: 'relative' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <svg width="32" height="32" viewBox="0 0 32 32" style={{ animation: 'cspin 0.9s linear infinite' }}>
                <circle cx="16" cy="16" r="12" stroke={C.surface} strokeWidth="3" fill="none" />
                <path d="M16 4 A12 12 0 0 1 28 16" stroke={C.green} strokeWidth="3" strokeLinecap="round" fill="none" />
              </svg>
              <span style={{ fontSize: '10px', color: C.dimText, letterSpacing: '2px' }}>CARGANDO</span>
            </div>
          </div>
        )}
        {error && !loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '12px', color: C.midText }}>Sin datos disponibles</span>
          </div>
        )}
      </div>

      {/* AI Badge */}
      {insight?.signal && (
        <div style={{ position: 'absolute', bottom: '24px', left: '20px', zIndex: 5, background: 'rgba(6,16,30,0.88)', backdropFilter: 'blur(20px)', border: `1px solid ${isBuy ? C.greenBd : C.redBd}`, borderRadius: '14px', padding: '14px 18px', minWidth: '160px', boxShadow: `0 8px 32px ${isBuy ? 'rgba(46,189,133,0.1)' : 'rgba(246,70,93,0.08)'}` }}>
          <div style={{ fontSize: '9px', color: C.dimText, letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '7px' }}>Señal IA</div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: isBuy ? C.green : C.red, marginBottom: '12px', letterSpacing: '-0.3px' }}>{insight.signal}</div>
          <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden', marginBottom: '7px' }}>
            <div style={{ height: '100%', width: `${confidence}%`, borderRadius: '2px', transition: 'width 1s ease', background: isBuy ? `linear-gradient(90deg,${C.green},#7eedc0)` : `linear-gradient(90deg,${C.red},#ff9aaa)` }} />
          </div>
          <div style={{ fontSize: '9px', color: C.dimText, marginBottom: '8px' }}>{confidence}% confianza</div>
          {showAI && (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {insight.entry_price > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
                  <span style={{ color: C.dimText }}>Entrada</span>
                  <span style={{ color: C.green, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(insight.entry_price)}</span>
                </div>
              )}
              {insight.target_price > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
                  <span style={{ color: C.dimText }}>Objetivo</span>
                  <span style={{ color: '#f97316', fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(insight.target_price)}</span>
                </div>
              )}
              {insight.predicted_next > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
                  <span style={{ color: C.dimText }}>LSTM</span>
                  <span style={{ color: C.blue, fontVariantNumeric: 'tabular-nums' }}>{fmtPrice(insight.predicted_next)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes cspin { to { transform:rotate(360deg) } }`}</style>
    </div>
  )
}
