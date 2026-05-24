/**
 * Utility functions for financial data formatting and validation.
 */

export function formatPrice(price: number): string {
  if (price <= 0) return '—'
  return price.toLocaleString('en', { maximumFractionDigits: price < 1 ? 6 : 2 })
}

export function formatChange(change: string): { text: string; isPositive: boolean } {
  const isPositive = !change.startsWith('-')
  return { text: change, isPositive }
}

export function formatPnl(pnl: number): string {
  const sign = pnl >= 0 ? '+' : ''
  return `${sign}${pnl.toFixed(2)}`
}

export function formatPct(pct: number): string {
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

export function parseConfidence(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace('%', ''), 10)
  return isNaN(n) ? null : Math.max(0, Math.min(100, n))
}

export function symbolToName(symbol: string): string {
  return symbol.replace('USDT', '')
}

export function isBuySignal(signal: string | undefined): boolean {
  if (!signal) return false
  return signal.includes('COMPRAR') || signal.includes('BUY')
}

export function calcPnl(
  cantidad: number,
  invertido: number,
  precioActual: number
): { pnlEuros: number; pnlPct: number } {
  const pnlEuros = cantidad * precioActual - invertido
  const pnlPct   = invertido > 0 ? (pnlEuros / invertido) * 100 : 0
  return { pnlEuros, pnlPct }
}

export function validateEmail(email: string): string {
  if (!email.trim()) return 'El email es obligatorio'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Introduce un email válido'
  return ''
}

export function validatePassword(password: string): string {
  if (!password) return 'La contraseña es obligatoria'
  if (password.length < 6) return 'Mínimo 6 caracteres'
  return ''
}
