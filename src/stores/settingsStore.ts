import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DirectorId } from '@/types'
import { DEFAULT_PERSONA_MODELS } from '@/lib/modelConfig'

// ── State interface ────────────────────────────────────────────────────────────

interface SettingsState {
  /** Mapping: director persona → selected model ID */
  personaModels: Record<DirectorId, string>
  /** Whether the settings panel is open */
  settingsPanelOpen: boolean

  setPersonaModel: (persona: DirectorId, modelId: string) => void
  resetPersonaModels: () => void
  setSettingsPanelOpen: (open: boolean) => void
  toggleSettingsPanel: () => void
}

// ── Store ──────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      personaModels: { ...DEFAULT_PERSONA_MODELS },
      settingsPanelOpen: false,

      setPersonaModel: (persona, modelId) =>
        set((state) => ({
          personaModels: { ...state.personaModels, [persona]: modelId },
        })),

      resetPersonaModels: () =>
        set({ personaModels: { ...DEFAULT_PERSONA_MODELS } }),

      setSettingsPanelOpen: (open) => set({ settingsPanelOpen: open }),

      toggleSettingsPanel: () =>
        set((state) => ({ settingsPanelOpen: !state.settingsPanelOpen })),
    }),
    {
      name: 'rembrandt-settings',
      // Only persist persona model selections, not UI open/close state
      partialize: (state) => ({ personaModels: state.personaModels }),
    }
  )
)
