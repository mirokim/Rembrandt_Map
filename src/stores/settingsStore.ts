import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DirectorId } from '@/types'
import { DEFAULT_PERSONA_MODELS } from '@/lib/modelConfig'

// ── State interface ────────────────────────────────────────────────────────────

export type AppTheme = 'light' | 'dark' | 'oled'

interface SettingsState {
  /** Mapping: director persona → selected model ID */
  personaModels: Record<DirectorId, string>
  /** Whether the settings panel is open */
  settingsPanelOpen: boolean
  /** UI colour theme */
  theme: AppTheme

  setPersonaModel: (persona: DirectorId, modelId: string) => void
  resetPersonaModels: () => void
  setSettingsPanelOpen: (open: boolean) => void
  toggleSettingsPanel: () => void
  setTheme: (theme: AppTheme) => void
}

// ── Store ──────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      personaModels: { ...DEFAULT_PERSONA_MODELS },
      settingsPanelOpen: false,
      theme: 'dark' as AppTheme,

      setPersonaModel: (persona, modelId) =>
        set((state) => ({
          personaModels: { ...state.personaModels, [persona]: modelId },
        })),

      resetPersonaModels: () =>
        set({ personaModels: { ...DEFAULT_PERSONA_MODELS } }),

      setSettingsPanelOpen: (open) => set({ settingsPanelOpen: open }),

      toggleSettingsPanel: () =>
        set((state) => ({ settingsPanelOpen: !state.settingsPanelOpen })),

      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'rembrandt-settings',
      partialize: (state) => ({ personaModels: state.personaModels, theme: state.theme }),
    }
  )
)
