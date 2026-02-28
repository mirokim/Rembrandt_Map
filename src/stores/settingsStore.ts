import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DirectorId } from '@/types'
import type { ProviderId } from '@/lib/modelConfig'
import { DEFAULT_PERSONA_MODELS, MODEL_OPTIONS, envKeyForProvider } from '@/lib/modelConfig'

// ── State interface ────────────────────────────────────────────────────────────

export type AppTheme = 'light' | 'dark' | 'oled'

interface SettingsState {
  /** Mapping: director persona → selected model ID */
  personaModels: Record<DirectorId, string>
  /** User-provided API keys (persisted in localStorage) */
  apiKeys: Partial<Record<ProviderId, string>>
  /** Whether the settings panel is open */
  settingsPanelOpen: boolean
  /** UI colour theme */
  theme: AppTheme

  setPersonaModel: (persona: DirectorId, modelId: string) => void
  resetPersonaModels: () => void
  setApiKey: (provider: ProviderId, key: string) => void
  setSettingsPanelOpen: (open: boolean) => void
  toggleSettingsPanel: () => void
  setTheme: (theme: AppTheme) => void
}

/** Resolve API key for a provider: settings store first, then env var fallback */
export function getApiKey(provider: ProviderId): string | undefined {
  const storeKey = useSettingsStore.getState().apiKeys[provider]
  if (storeKey) return storeKey
  const envKey = envKeyForProvider(provider)
  return (import.meta.env as Record<string, string>)[envKey] || undefined
}

// ── Migration: replace defunct model IDs with current defaults ────────────────

const VALID_MODEL_IDS = new Set(MODEL_OPTIONS.map(m => m.id))

function migratePersonaModels(
  stored: Record<DirectorId, string>
): Record<DirectorId, string> {
  const migrated = { ...stored }
  for (const [persona, modelId] of Object.entries(migrated)) {
    if (!VALID_MODEL_IDS.has(modelId)) {
      migrated[persona as DirectorId] =
        DEFAULT_PERSONA_MODELS[persona as DirectorId]
    }
  }
  return migrated
}

// ── Store ──────────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      personaModels: { ...DEFAULT_PERSONA_MODELS },
      apiKeys: {},
      settingsPanelOpen: false,
      theme: 'dark' as AppTheme,

      setPersonaModel: (persona, modelId) =>
        set((state) => ({
          personaModels: { ...state.personaModels, [persona]: modelId },
        })),

      resetPersonaModels: () =>
        set({ personaModels: { ...DEFAULT_PERSONA_MODELS } }),

      setApiKey: (provider, key) =>
        set((state) => ({
          apiKeys: { ...state.apiKeys, [provider]: key || undefined },
        })),

      setSettingsPanelOpen: (open) => set({ settingsPanelOpen: open }),

      toggleSettingsPanel: () =>
        set((state) => ({ settingsPanelOpen: !state.settingsPanelOpen })),

      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'rembrandt-settings',
      partialize: (state) => ({
        personaModels: state.personaModels,
        apiKeys: state.apiKeys,
        theme: state.theme,
      }),
      // Migrate persisted data: replace old/removed model IDs with defaults
      merge: (persisted, current) => {
        const stored = persisted as Partial<SettingsState>
        return {
          ...current,
          ...stored,
          personaModels: migratePersonaModels(
            stored.personaModels ?? { ...DEFAULT_PERSONA_MODELS }
          ),
        }
      },
    }
  )
)
