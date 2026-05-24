import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgenteAutonomo } from './useAgenteAutonomo'

vi.mock('../api', () => ({
  apiClient:  { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn().mockResolvedValue({ data: {} }) },
  aiClient:   { post: vi.fn().mockResolvedValue({ data: {} }), get: vi.fn().mockResolvedValue({ data: {} }) },
  authClient: { post: vi.fn().mockResolvedValue({ data: {} }), get: vi.fn().mockResolvedValue({ data: {} }) },
}))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('useAgenteAutonomo', () => {
  it('starts inactive by default', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    expect(result.current.estado.activo).toBe(false)
  })

  it('activates on activar()', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    act(() => { result.current.activar() })
    expect(result.current.estado.activo).toBe(true)
  })

  it('deactivates on pausar()', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    act(() => { result.current.activar() })
    act(() => { result.current.pausar() })
    expect(result.current.estado.activo).toBe(false)
  })

  it('starts with empty posicionesAbiertas', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    expect(result.current.estado.posicionesAbiertas).toEqual({})
  })

  it('starts with empty log', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    expect(result.current.estado.log).toEqual([])
  })

  it('starts with zero operations today', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    expect(result.current.estado.statsHoy.operaciones).toBe(0)
  })

  it('does not process tick when inactive', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    const insight = { signal: 'COMPRAR', confidence: '90%', conviction_score: 80 }
    act(() => { result.current.procesarTick('BTCUSDT', 50000, insight, 0) })
    expect(result.current.estado.posicionesAbiertas['BTCUSDT']).toBeUndefined()
  })

  it('alertasStopLoss is a Set', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    expect(result.current.alertasStopLoss).toBeInstanceOf(Set)
  })

  it('alertasStopLoss starts empty', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    expect(result.current.alertasStopLoss.size).toBe(0)
  })

  it('toggle: activar then pausar goes back to false', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    act(() => { result.current.activar() })
    expect(result.current.estado.activo).toBe(true)
    act(() => { result.current.pausar() })
    expect(result.current.estado.activo).toBe(false)
  })

  it('multiple activar calls keep it active', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    act(() => { result.current.activar() })
    act(() => { result.current.activar() })
    expect(result.current.estado.activo).toBe(true)
  })

  it('procesarTick with MANTENER signal does not open position when active', () => {
    const { result } = renderHook(() => useAgenteAutonomo())
    act(() => { result.current.activar() })
    const insight = { signal: 'MANTENER', confidence: '30%', conviction_score: 20 }
    act(() => { result.current.procesarTick('BTCUSDT', 50000, insight, 0) })
    expect(result.current.estado.posicionesAbiertas['BTCUSDT']).toBeUndefined()
  })
})
