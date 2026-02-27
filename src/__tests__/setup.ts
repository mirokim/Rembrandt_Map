import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

// Mock crypto.randomUUID
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      randomUUID: () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    },
  })
} else if (!globalThis.crypto.randomUUID) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  })
}

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
    get length() { return Object.keys(store).length },
    key: (index: number) => Object.keys(store)[index] ?? null,
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

// Reset zustand stores and localStorage between tests
beforeEach(() => {
  localStorageMock.clear()
})

// Suppress specific console errors in tests
const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '')
  if (msg.includes('Warning:') || msg.includes('ReactDOM.render')) return
  originalConsoleError(...args)
}

// Mock scrollIntoView (not available in jsdom)
window.HTMLElement.prototype.scrollIntoView = vi.fn()

// Mock requestAnimationFrame
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  setTimeout(() => cb(16), 16)
  return 1
})
vi.stubGlobal('cancelAnimationFrame', vi.fn())
