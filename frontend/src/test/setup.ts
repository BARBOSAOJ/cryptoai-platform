import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Silence framer-motion warnings in tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Mock ResizeObserver
class MockResizeObserver {
  observe()    {}
  unobserve()  {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as any

// Mock EventSource
class MockEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror:   ((e: Event) => void) | null = null
  onopen:    ((e: Event) => void) | null = null
  readyState = 1
  close() {}
}
global.EventSource = MockEventSource as any

// scrollIntoView mock
window.HTMLElement.prototype.scrollIntoView = vi.fn()

// localStorage mock
const storage: Record<string, string> = {}
global.localStorage = {
  getItem:    (k: string) => storage[k] ?? null,
  setItem:    (k: string, v: string) => { storage[k] = v },
  removeItem: (k: string) => { delete storage[k] },
  clear:      () => { Object.keys(storage).forEach(k => delete storage[k]) },
  length:     0,
  key:        () => null,
}
