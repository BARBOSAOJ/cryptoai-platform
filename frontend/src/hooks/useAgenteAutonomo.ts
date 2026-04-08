import { useState, useRef, useCallback, useEffect } from 'react'
import { apiClient } from '../api'

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

// ─── Constantes ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'agente_autonomo_config'
const COOLDOWN_MS = 30_000

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
    const parsed = JSON.parse(raw)
    // Mezclar con defaults para asegurar todos los símbolos
    return { ...configDefault(), ...parsed }
  } catch {
    return configDefault()
  }
}

const guardarConfig = (config: Record<string, ConfigAgente>) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch { /* localStorage puede estar bloqueado */ }
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

  // Ref para último timestamp de operación por símbolo (cooldown)
  const ultimaOperacionRef = useRef<Record<string, number>>({})
  // Ref espejo del estado para acceso dentro de callbacks sin stale closure
  const estadoRef = useRef(estado)
  useEffect(() => { estadoRef.current = estado }, [estado])

  // Persistir configuración al cambiar
  useEffect(() => {
    guardarConfig(estado.configuracion)
  }, [estado.configuracion])

  // ─── Parada de emergencia ──────────────────────────────────────────────────

  const activar = useCallback(() => {
    setEstado(prev => ({ ...prev, activo: true }))
  }, [])

  const pausar = useCallback(() => {
    setEstado(prev => ({ ...prev, activo: false }))
  }, [])

  // ─── Configurar símbolo ────────────────────────────────────────────────────

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

  // ─── Helpers internos ─────────────────────────────────────────────────────

  const agregarLog = (entry: EntradaLog) => {
    setEstado(prev => ({
      ...prev,
      log: [entry, ...prev.log].slice(0, 50)
    }))
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

  // ─── Parsear confianza ────────────────────────────────────────────────────

  const parsearConfianza = (raw: any): number => {
    if (raw === undefined || raw === null) return 0
    if (typeof raw === 'number') return Math.max(0, Math.min(100, raw))
    const n = parseInt(String(raw).replace('%', ''), 10)
    return isNaN(n) ? 0 : Math.max(0, Math.min(100, n))
  }

  // ─── Ejecutar orden via API ───────────────────────────────────────────────

  const ejecutarOrden = async (
    symbol: string,
    size: number,
    price: number,
    type: 'BUY' | 'SELL',
    signal: string,
    confidence: string
  ): Promise<{ tradeId: string | number } | null> => {
    try {
      const res = await apiClient.post('/portfolio/execute', {
        symbol, size, price, type, signal, confidence
      })
      return res.data
    } catch (e: any) {
      if (import.meta.env.DEV) console.error(`[Agente] Error orden ${type} ${symbol}:`, e?.message)
      return null
    }
  }

  // ─── procesarTick — núcleo de decisión ───────────────────────────────────

  const procesarTick = useCallback(async (symbol: string, price: number, insight: any) => {
    try {
      const estado = estadoRef.current

      // Guardia global
      if (!estado.activo) return

      const cfg = estado.configuracion[symbol]
      if (!cfg?.activo) return

      // Cooldown
      const ahora = Date.now()
      const ultima = ultimaOperacionRef.current[symbol] ?? 0
      if (ahora - ultima < COOLDOWN_MS) return

      const signal: string = insight?.signal ?? ''
      const confianza = parsearConfianza(insight?.confidence)
      const regimen: string = insight?.market_regime ?? insight?.regime ?? ''
      const confluencia: number = insight?.mtf_confluence ?? insight?.confluence ?? 0

      const posicionAbierta = estado.posicionesAbiertas[symbol]

      // ── Alertas stop-loss en tiempo real ─────────────────────────────────
      if (posicionAbierta) {
        const enStopZone = price <= posicionAbierta.stopLoss
        setEstado(prev => {
          const alertas = new Set(prev.alertasStopLoss)
          if (enStopZone) {
            alertas.add(symbol)
          } else {
            alertas.delete(symbol)
          }
          // Solo actualizar estado si cambia algo para evitar re-renders innecesarios
          const prevHas = prev.alertasStopLoss.has(symbol)
          if (prevHas === enStopZone) return prev
          return { ...prev, alertasStopLoss: alertas }
        })
      } else {
        // Sin posición abierta: limpiar alerta si existía
        if (estado.alertasStopLoss.has(symbol)) {
          setEstado(prev => {
            const alertas = new Set(prev.alertasStopLoss)
            alertas.delete(symbol)
            return { ...prev, alertasStopLoss: alertas }
          })
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

          const resultado = await ejecutarOrden(
            symbol,
            posicionAbierta.cantidad,
            price,
            'SELL',
            signal || 'VENDER',
            `${confianza}%`
          )

          if (resultado) {
            const pnl = (price - posicionAbierta.precio) * posicionAbierta.cantidad
            setEstado(prev => {
              const nuevasPosiciones = { ...prev.posicionesAbiertas }
              delete nuevasPosiciones[symbol]
              const alertas = new Set(prev.alertasStopLoss)
              alertas.delete(symbol)
              return { ...prev, posicionesAbiertas: nuevasPosiciones, alertasStopLoss: alertas }
            })
            registrarOperacion(pnl)
            agregarLog({
              timestamp: new Date().toISOString(),
              symbol,
              accion: 'VENDER',
              motivo,
              precio: price
            })
          }
        }
        return // Si hay posición abierta, no comprar más
      }

      // ── Decisión COMPRAR ─────────────────────────────────────────────────
      const regVolatil = regimen.toUpperCase().includes('VOLAT')
      const señalCompra = signal.includes('COMPRAR') || signal.includes('BUY')

      if (
        señalCompra &&
        confianza >= cfg.umbralConfianza &&
        !regVolatil &&
        confluencia >= 0.5
      ) {
        ultimaOperacionRef.current[symbol] = ahora

        const cantidad = cfg.cantidadMaxima / price
        const stopLoss = price * 0.97
        const targetPrice: number = insight?.target_price ?? price * 1.03

        const resultado = await ejecutarOrden(
          symbol,
          cantidad,
          price,
          'BUY',
          signal || 'COMPRAR',
          `${confianza}%`
        )

        if (resultado) {
          setEstado(prev => ({
            ...prev,
            posicionesAbiertas: {
              ...prev.posicionesAbiertas,
              [symbol]: { precio: price, cantidad, stopLoss, targetPrice, invertido: cfg.cantidadMaxima }
            }
          }))
          registrarOperacion(0)
          agregarLog({
            timestamp: new Date().toISOString(),
            symbol,
            accion: 'COMPRAR',
            motivo: `señal ${signal}, confianza ${confianza}%, confluencia ${confluencia.toFixed(2)}`,
            precio: price
          })
        }
      }
    } catch (e: any) {
      // Nunca bloquear el hilo principal
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
