import { useState, useRef, useCallback, useEffect } from 'react'
import { apiClient, aiClient } from '../api'

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ConfigAgente {
  activo: boolean
  cantidadMaxima: number      // USDT por operación
  umbralConfianza: number     // 0-100, por defecto 75
}

export interface PosicionAbierta {
  precio: number
  cantidad: number
  stopLoss: number
  targetPrice: number
  invertido: number   // USDT invertidos en la operación
  atr: number         // ATR al abrir posición (para trailing stop)
}

export interface EntradaLog {
  timestamp: string
  symbol: string
  accion: string
  motivo: string
  precio: number
}

export interface EstadoAgente {
  activo: boolean
  configuracion: Record<string, ConfigAgente>
  posicionesAbiertas: Record<string, PosicionAbierta>
  log: EntradaLog[]
  statsHoy: { operaciones: number; pnlBot: number }
  /** Símbolos cuyo precio está actualmente <= stopLoss */
  alertasStopLoss: Set<string>
}

// Stats por símbolo para Kelly criterion
interface TradeStats {
  wins: number
  losses: number
  totalWinRatio: number   // suma de pnlRatio en trades ganadores
  totalLossRatio: number  // suma de |pnlRatio| en trades perdedores
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'agente_autonomo_config'
const COOLDOWN_MS = 30_000
const CONVICTION_THRESHOLD = 65   // score mínimo para operar (issue #29)
const BTC_DROP_THRESHOLD   = -0.02 // filtro BTC: caída >2% bloquea altcoins (issue #27)

const SIMBOLOS_DEFAULT = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'TRUMPUSDT', 'PEPEUSDT', 'DOGEUSDT']

const configDefault = (): Record<string, ConfigAgente> =>
  Object.fromEntries(
    SIMBOLOS_DEFAULT.map(s => [s, { activo: false, cantidadMaxima: 100, umbralConfianza: 75 }])
  )

// ─── Persistencia ─────────────────────────────────────────────────────────────

const cargarConfig = (): Record<string, ConfigAgente> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return configDefault()
    return { ...configDefault(), ...JSON.parse(raw) }
  } catch {
    return configDefault()
  }
}

const guardarConfig = (config: Record<string, ConfigAgente>) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) } catch { /* bloqueado */ }
}

// ─── Kelly criterion (issue #26) ──────────────────────────────────────────────

function calcularCantidadKelly(stats: TradeStats, cantidadBase: number): number {
  const total = stats.wins + stats.losses
  if (total < 10) return cantidadBase  // sin historial suficiente, usar base

  const p = stats.wins / total
  const q = 1 - p
  const avgWin  = stats.wins   > 0 ? stats.totalWinRatio  / stats.wins   : 1.0
  const avgLoss = stats.losses > 0 ? stats.totalLossRatio / stats.losses : 1.0
  const b = avgLoss > 0 ? avgWin / avgLoss : 1.0

  const f = (p * b - q) / b
  if (f <= 0) return 0  // edge negativo: no operar

  // Quarter-Kelly para gestión conservadora, escalado sobre cantidadBase
  const fFrac = Math.min(f * 0.25, 0.25)
  const multiplier = Math.min(2.0, fFrac / 0.05)  // 5% Kelly → ×1.0 base
  return Math.max(10, Math.min(200, cantidadBase * multiplier))
}

// ─── Hook principal ───────────────────────────────────────────────────────────

export function useAgenteAutonomo() {
  const [estado, setEstado] = useState<EstadoAgente>(() => ({
    activo: false,
    configuracion: cargarConfig(),
    posicionesAbiertas: {},
    log: [],
    statsHoy: { operaciones: 0, pnlBot: 0 },
    alertasStopLoss: new Set<string>()
  }))

  const ultimaOperacionRef = useRef<Record<string, number>>({})
  const estadoRef          = useRef(estado)
  const tradeStatsRef      = useRef<Record<string, TradeStats>>({})  // Kelly stats

  useEffect(() => { estadoRef.current = estado }, [estado])

  useEffect(() => { guardarConfig(estado.configuracion) }, [estado.configuracion])

  // ─── Controles ────────────────────────────────────────────────────────────

  const activar = useCallback(() => {
    setEstado(prev => ({ ...prev, activo: true }))
  }, [])

  const pausar = useCallback(() => {
    setEstado(prev => ({ ...prev, activo: false }))
  }, [])

  const configurarSimbolo = useCallback((symbol: string, config: Partial<ConfigAgente>) => {
    setEstado(prev => {
      const nueva = {
        ...prev,
        configuracion: {
          ...prev.configuracion,
          [symbol]: { ...(prev.configuracion[symbol] ?? { activo: false, cantidadMaxima: 100, umbralConfianza: 75 }), ...config }
        }
      }
      guardarConfig(nueva.configuracion)
      return nueva
    })
  }, [])

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const agregarLog = (entry: EntradaLog) => {
    setEstado(prev => ({ ...prev, log: [entry, ...prev.log].slice(0, 50) }))
  }

  const registrarOperacion = (pnlDelta: number) => {
    setEstado(prev => ({
      ...prev,
      statsHoy: {
        operaciones: prev.statsHoy.operaciones + 1,
        pnlBot: prev.statsHoy.pnlBot + pnlDelta
      }
    }))
  }

  const parsearConfianza = (raw: any): number => {
    if (raw === undefined || raw === null) return 0
    if (typeof raw === 'number') return Math.max(0, Math.min(100, raw))
    const n = parseInt(String(raw).replace('%', ''), 10)
    return isNaN(n) ? 0 : Math.max(0, Math.min(100, n))
  }

  const ejecutarOrden = async (
    symbol: string, size: number, price: number,
    type: 'BUY' | 'SELL', signal: string, confidence: string
  ): Promise<{ tradeId: string | number } | null> => {
    try {
      const res = await apiClient.post('/portfolio/execute', { symbol, size, price, type, signal, confidence })
      return res.data
    } catch (e: any) {
      if (import.meta.env.DEV) console.error(`[Agente] Error orden ${type} ${symbol}:`, e?.message)
      return null
    }
  }

  // ─── procesarTick — núcleo de decisión ───────────────────────────────────
  // btcPriceChange: variación % del precio de BTC en la última vela (issue #27)

  const procesarTick = useCallback(async (
    symbol: string,
    price: number,
    insight: any,
    btcPriceChange: number = 0
  ) => {
    try {
      const estado = estadoRef.current
      if (!estado.activo) return

      const cfg = estado.configuracion[symbol]
      if (!cfg?.activo) return

      const ahora = Date.now()
      if (ahora - (ultimaOperacionRef.current[symbol] ?? 0) < COOLDOWN_MS) return

      const signal: string    = insight?.signal ?? ''
      const confianza         = parsearConfianza(insight?.confidence)
      const convictionScore   = typeof insight?.conviction_score === 'number' ? insight.conviction_score : -1
      const regimen: string   = insight?.market_regime?.regimen ?? insight?.regime ?? ''
      const confluencia       = insight?.mtf_confluence ?? insight?.confluence ?? 0

      const posicionAbierta = estado.posicionesAbiertas[symbol]

      // ── Alertas stop-loss en tiempo real ─────────────────────────────────
      if (posicionAbierta) {
        const enStopZone = price <= posicionAbierta.stopLoss
        setEstado(prev => {
          const prevHas = prev.alertasStopLoss.has(symbol)
          if (prevHas === enStopZone) return prev
          const alertas = new Set(prev.alertasStopLoss)
          enStopZone ? alertas.add(symbol) : alertas.delete(symbol)
          return { ...prev, alertasStopLoss: alertas }
        })
      } else if (estado.alertasStopLoss.has(symbol)) {
        setEstado(prev => {
          const alertas = new Set(prev.alertasStopLoss)
          alertas.delete(symbol)
          return { ...prev, alertasStopLoss: alertas }
        })
      }

      // ── Trailing stop (issue #28) ─────────────────────────────────────────
      if (posicionAbierta && posicionAbierta.atr > 0) {
        const umbralActivacion = posicionAbierta.precio + posicionAbierta.atr
        if (price > umbralActivacion) {
          const nuevoStop = price - 1.5 * posicionAbierta.atr
          if (nuevoStop > posicionAbierta.stopLoss) {
            setEstado(prev => {
              const pos = prev.posicionesAbiertas[symbol]
              if (!pos) return prev
              return {
                ...prev,
                posicionesAbiertas: {
                  ...prev.posicionesAbiertas,
                  [symbol]: { ...pos, stopLoss: nuevoStop }
                }
              }
            })
          }
        }
      }

      // ── Decisión VENDER ──────────────────────────────────────────────────
      if (posicionAbierta) {
        const debeVender =
          price >= posicionAbierta.targetPrice ||
          price <= posicionAbierta.stopLoss ||
          (signal.includes('VENDER') && confianza >= cfg.umbralConfianza)

        if (debeVender) {
          const motivo =
            price >= posicionAbierta.targetPrice ? 'target alcanzado' :
            price <= posicionAbierta.stopLoss     ? 'stop loss activado' :
                                                    'señal VENDER con confianza suficiente'

          ultimaOperacionRef.current[symbol] = ahora

          const resultado = await ejecutarOrden(symbol, posicionAbierta.cantidad, price, 'SELL', signal || 'VENDER', `${confianza}%`)

          if (resultado) {
            // Actualizar estadísticas para Kelly (issue #26)
            const pnlRatio = (price - posicionAbierta.precio) / posicionAbierta.precio
            const stats = tradeStatsRef.current[symbol] ?? { wins: 0, losses: 0, totalWinRatio: 0, totalLossRatio: 0 }
            if (pnlRatio > 0) { stats.wins++; stats.totalWinRatio += pnlRatio }
            else               { stats.losses++; stats.totalLossRatio += Math.abs(pnlRatio) }
            tradeStatsRef.current[symbol] = stats

            const pnl = (price - posicionAbierta.precio) * posicionAbierta.cantidad
            setEstado(prev => {
              const nuevasPosiciones = { ...prev.posicionesAbiertas }
              delete nuevasPosiciones[symbol]
              const alertas = new Set(prev.alertasStopLoss)
              alertas.delete(symbol)
              return { ...prev, posicionesAbiertas: nuevasPosiciones, alertasStopLoss: alertas }
            })
            registrarOperacion(pnl)
            agregarLog({ timestamp: new Date().toISOString(), symbol, accion: 'VENDER', motivo, precio: price })
          }
        }
        return
      }

      // ── Decisión COMPRAR ─────────────────────────────────────────────────
      const señalCompra  = signal.includes('COMPRAR') || signal.includes('BUY')

      // Filtro de régimen (issue #32): solo operar en TRENDING, bloquear RANGING/VOLATILE/TRANSITION
      const regNoFavorable = regimen.length > 0 && !regimen.toUpperCase().includes('TREND')

      // Filtro de correlación BTC (issue #27): bloquear altcoins si BTC cae >2%
      const btcFiltroActivo = symbol !== 'BTCUSDT' && btcPriceChange <= BTC_DROP_THRESHOLD

      // Usar conviction score si está disponible (issue #29), si no usar señal clásica
      const señalValida = convictionScore >= 0
        ? convictionScore >= CONVICTION_THRESHOLD
        : (señalCompra && confianza >= cfg.umbralConfianza)

      if (
        señalValida &&
        !regNoFavorable &&
        !btcFiltroActivo &&
        confluencia >= 0.5
      ) {
        ultimaOperacionRef.current[symbol] = ahora

        // Stop loss dinámico ATR (issue #25): obtener del AI engine
        let stopLoss    = price * 0.97   // fallback
        let targetPrice = insight?.target_price ?? price * 1.03
        let atr         = price * 0.01   // fallback ATR ~1%

        try {
          const riskRes = await aiClient.get(`/risk/${symbol}`, { params: { price, saldo: 1000 } })
          if (riskRes.data?.stop_loss > 0)   stopLoss    = riskRes.data.stop_loss
          if (riskRes.data?.take_profit > 0) targetPrice = riskRes.data.take_profit
          if (riskRes.data?.atr > 0)         atr         = riskRes.data.atr
        } catch {
          // Mantener valores de fallback
        }

        // Tamaño de posición con Kelly criterion (issue #26)
        const stats = tradeStatsRef.current[symbol] ?? { wins: 0, losses: 0, totalWinRatio: 0, totalLossRatio: 0 }
        const cantidadKelly = calcularCantidadKelly(stats, cfg.cantidadMaxima)
        if (cantidadKelly <= 0) {
          agregarLog({ timestamp: new Date().toISOString(), symbol, accion: 'BLOQUEADO', motivo: 'Kelly negativo — edge insuficiente', precio: price })
          return
        }

        const cantidad = cantidadKelly / price

        const resultado = await ejecutarOrden(symbol, cantidad, price, 'BUY', signal || 'COMPRAR', `${confianza}%`)

        if (resultado) {
          setEstado(prev => ({
            ...prev,
            posicionesAbiertas: {
              ...prev.posicionesAbiertas,
              [symbol]: { precio: price, cantidad, stopLoss, targetPrice, invertido: cantidadKelly, atr }
            }
          }))
          registrarOperacion(0)
          const motivoLog = convictionScore >= 0
            ? `conviction ${convictionScore}/100, confianza ${confianza}%, ATR ${atr.toFixed(6)}`
            : `señal ${signal}, confianza ${confianza}%, confluencia ${confluencia.toFixed(2)}`
          agregarLog({ timestamp: new Date().toISOString(), symbol, accion: 'COMPRAR', motivo: motivoLog, precio: price })
        }
      }
    } catch (e: any) {
      if (import.meta.env.DEV) console.error(`[Agente] Error inesperado en procesarTick (${symbol}):`, e?.message)
    }
  }, [])

  return {
    estado,
    activar,
    pausar,
    configurarSimbolo,
    procesarTick,
    alertasStopLoss: estado.alertasStopLoss
  }
}
