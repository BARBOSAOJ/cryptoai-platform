import { useEffect, useRef, useState } from 'react'

/**
 * Anima un número desde 0 (o desde su valor previo) hasta `target`.
 * Usa requestAnimationFrame con easing easeOutExpo para un conteo natural.
 *
 * @param target   valor final
 * @param duration ms de la animación (default 900)
 * @param decimals decimales a mostrar
 */
export function useCountUp(target: number, duration = 900, decimals = 2): number {
  const [value, setValue] = useState(0)
  const fromRef  = useRef(0)
  const rafRef   = useRef<number | null>(null)

  useEffect(() => {
    const from  = fromRef.current
    const start = performance.now()

    const tick = (now: number) => {
      const t   = Math.min((now - start) / duration, 1)
      // easeOutExpo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
      const v   = from + (target - from) * eased
      setValue(v)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [target, duration])

  return Number(value.toFixed(decimals))
}
