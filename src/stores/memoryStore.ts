import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface MemoryState {
  memoryText: string
  setMemoryText: (text: string) => void
  appendToMemory: (text: string) => void
  clearMemory: () => void
}

/**
 * AI 장기 기억 스토어.
 * localStorage에 영구 저장되며, 모든 대화 세션에서 시스템 프롬프트에 주입됩니다.
 */
export const useMemoryStore = create<MemoryState>()(
  persist(
    (set) => ({
      memoryText: '',
      setMemoryText: (text) => set({ memoryText: text }),
      appendToMemory: (text) => set(s => ({ memoryText: s.memoryText ? s.memoryText + '\n\n' + text : text })),
      clearMemory: () => set({ memoryText: '' }),
    }),
    { name: 'rembrandt-ai-memory' }
  )
)
