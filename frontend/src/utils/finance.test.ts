import { describe, it, expect } from 'vitest'
import {
  formatPrice, formatChange, formatPnl, formatPct,
  parseConfidence, symbolToName, isBuySignal, calcPnl,
  validateEmail, validatePassword,
} from './finance'

describe('formatPrice', () => {
  it('returns — for zero price', () => {
    expect(formatPrice(0)).toBe('—')
  })
  it('returns — for negative price', () => {
    expect(formatPrice(-1)).toBe('—')
  })
  it('formats large price with 2 decimal places', () => {
    expect(formatPrice(45000)).toBe('45,000')
  })
  it('formats small price with up to 6 decimals', () => {
    const result = formatPrice(0.000123)
    expect(result).toBe('0.000123')
  })
})

describe('formatChange', () => {
  it('marks positive change correctly', () => {
    const r = formatChange('+2.50%')
    expect(r.isPositive).toBe(true)
    expect(r.text).toBe('+2.50%')
  })
  it('marks negative change correctly', () => {
    const r = formatChange('-1.20%')
    expect(r.isPositive).toBe(false)
  })
  it('treats zero change as positive', () => {
    expect(formatChange('+0.00%').isPositive).toBe(true)
  })
})

describe('formatPnl', () => {
  it('adds + sign for positive PnL', () => {
    expect(formatPnl(120.5)).toBe('+120.50')
  })
  it('keeps - sign for negative PnL', () => {
    expect(formatPnl(-55.25)).toBe('-55.25')
  })
  it('shows zero as +0.00', () => {
    expect(formatPnl(0)).toBe('+0.00')
  })
})

describe('formatPct', () => {
  it('formats positive percentage', () => {
    expect(formatPct(5.3)).toBe('+5.30%')
  })
  it('formats negative percentage', () => {
    expect(formatPct(-2.1)).toBe('-2.10%')
  })
})

describe('parseConfidence', () => {
  it('returns null for null/undefined', () => {
    expect(parseConfidence(null)).toBeNull()
    expect(parseConfidence(undefined)).toBeNull()
  })
  it('parses numeric value', () => {
    expect(parseConfidence(75)).toBe(75)
  })
  it('parses string with percent sign', () => {
    expect(parseConfidence('82%')).toBe(82)
  })
  it('clamps to [0, 100]', () => {
    expect(parseConfidence(150)).toBe(100)
    expect(parseConfidence(-10)).toBe(0)
  })
  it('returns null for NaN string', () => {
    expect(parseConfidence('abc')).toBeNull()
  })
})

describe('symbolToName', () => {
  it('removes USDT suffix', () => {
    expect(symbolToName('BTCUSDT')).toBe('BTC')
    expect(symbolToName('ETHUSDT')).toBe('ETH')
  })
  it('leaves symbols without USDT unchanged', () => {
    expect(symbolToName('BTC')).toBe('BTC')
  })
})

describe('isBuySignal', () => {
  it('detects COMPRAR signal', () => {
    expect(isBuySignal('COMPRAR')).toBe(true)
  })
  it('detects BUY signal', () => {
    expect(isBuySignal('BUY')).toBe(true)
  })
  it('returns false for MANTENER', () => {
    expect(isBuySignal('MANTENER')).toBe(false)
  })
  it('returns false for VENDER', () => {
    expect(isBuySignal('VENDER')).toBe(false)
  })
  it('returns false for undefined', () => {
    expect(isBuySignal(undefined)).toBe(false)
  })
})

describe('calcPnl', () => {
  it('calculates profit correctly', () => {
    const r = calcPnl(1, 1000, 1200)
    expect(r.pnlEuros).toBe(200)
    expect(r.pnlPct).toBeCloseTo(20)
  })
  it('calculates loss correctly', () => {
    const r = calcPnl(1, 1000, 800)
    expect(r.pnlEuros).toBe(-200)
    expect(r.pnlPct).toBeCloseTo(-20)
  })
  it('returns zero pct when invertido is 0', () => {
    const r = calcPnl(0, 0, 100)
    expect(r.pnlPct).toBe(0)
  })
})

describe('validateEmail', () => {
  it('returns error for empty email', () => {
    expect(validateEmail('')).toBeTruthy()
  })
  it('returns error for invalid email', () => {
    expect(validateEmail('notanemail')).toBeTruthy()
  })
  it('returns empty string for valid email', () => {
    expect(validateEmail('user@example.com')).toBe('')
  })
})

describe('validatePassword', () => {
  it('returns error for empty password', () => {
    expect(validatePassword('')).toBeTruthy()
  })
  it('returns error for password shorter than 6 chars', () => {
    expect(validatePassword('abc')).toBeTruthy()
  })
  it('returns empty string for valid password', () => {
    expect(validatePassword('secret123')).toBe('')
  })
})
