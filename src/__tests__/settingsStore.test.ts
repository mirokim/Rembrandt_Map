import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
import { DEFAULT_PERSONA_MODELS } from '@/lib/modelConfig'
import type { SpeakerId } from '@/types'

const SPEAKER_IDS: SpeakerId[] = [
  'chief_director',
  'art_director',
  'plan_director',
  'level_director',
  'prog_director',
]

function resetStore() {
  useSettingsStore.setState({
    personaModels: { ...DEFAULT_PERSONA_MODELS },
    settingsPanelOpen: false,
  })
}

describe('settingsStore', () => {
  beforeEach(() => {
    resetStore()
  })

  // ── Default state ──────────────────────────────────────────────────────────

  it('has default persona models for all 5 speakers', () => {
    const { personaModels } = useSettingsStore.getState()
    for (const id of SPEAKER_IDS) {
      expect(personaModels[id]).toBeTruthy()
    }
  })

  it('default chief_director model is a Claude model', () => {
    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.chief_director).toContain('claude')
  })

  it('default art_director model is gpt-4.1', () => {
    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.art_director).toBe('gpt-4.1')
  })

  it('default plan_director model is a Gemini model', () => {
    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.plan_director).toContain('gemini')
  })

  it('settingsPanelOpen defaults to false', () => {
    const { settingsPanelOpen } = useSettingsStore.getState()
    expect(settingsPanelOpen).toBe(false)
  })

  // ── setPersonaModel ────────────────────────────────────────────────────────

  it('setPersonaModel updates a single persona without affecting others', () => {
    const { setPersonaModel } = useSettingsStore.getState()
    setPersonaModel('chief_director', 'gpt-4o')

    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.chief_director).toBe('gpt-4o')
    // Others unchanged
    expect(personaModels.art_director).toBe(DEFAULT_PERSONA_MODELS.art_director)
    expect(personaModels.plan_director).toBe(DEFAULT_PERSONA_MODELS.plan_director)
  })

  it('setPersonaModel can be called multiple times independently', () => {
    const { setPersonaModel } = useSettingsStore.getState()
    setPersonaModel('chief_director', 'gpt-4o')
    setPersonaModel('prog_director', 'gemini-2.5-flash')

    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.chief_director).toBe('gpt-4o')
    expect(personaModels.prog_director).toBe('gemini-2.5-flash')
  })

  // ── resetPersonaModels ─────────────────────────────────────────────────────

  it('resetPersonaModels restores all defaults', () => {
    const { setPersonaModel, resetPersonaModels } = useSettingsStore.getState()
    setPersonaModel('chief_director', 'gpt-4o')
    setPersonaModel('art_director', 'gemini-2.5-pro')

    resetPersonaModels()

    const { personaModels } = useSettingsStore.getState()
    expect(personaModels.chief_director).toBe(DEFAULT_PERSONA_MODELS.chief_director)
    expect(personaModels.art_director).toBe(DEFAULT_PERSONA_MODELS.art_director)
  })

  // ── Settings panel toggle ──────────────────────────────────────────────────

  it('setSettingsPanelOpen sets open state directly', () => {
    const { setSettingsPanelOpen } = useSettingsStore.getState()
    setSettingsPanelOpen(true)
    expect(useSettingsStore.getState().settingsPanelOpen).toBe(true)

    setSettingsPanelOpen(false)
    expect(useSettingsStore.getState().settingsPanelOpen).toBe(false)
  })

  it('toggleSettingsPanel flips the open state', () => {
    const { toggleSettingsPanel } = useSettingsStore.getState()
    expect(useSettingsStore.getState().settingsPanelOpen).toBe(false)

    toggleSettingsPanel()
    expect(useSettingsStore.getState().settingsPanelOpen).toBe(true)

    toggleSettingsPanel()
    expect(useSettingsStore.getState().settingsPanelOpen).toBe(false)
  })
})
