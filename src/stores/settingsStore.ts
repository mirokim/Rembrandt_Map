import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DirectorId } from '@/types'
import type { ProviderId } from '@/lib/modelConfig'
import { DEFAULT_PERSONA_MODELS, MODEL_OPTIONS, envKeyForProvider } from '@/lib/modelConfig'
import type { VaultPersonaConfig } from '@/lib/personaVaultConfig'

// ── State interface ────────────────────────────────────────────────────────────

export type AppTheme = 'light' | 'dark' | 'oled'
export type ParagraphRenderQuality = 'high' | 'medium' | 'fast'

export interface ProjectInfo {
  name: string
  engine: string
  genre: string
  platform: string
  scale: string
  teamSize: string
  description: string
  /** Team members in plain-text format: "art: 홍길동, 이순신\nchief: 김철수" */
  teamMembers: string
  /** Raw project info as pasted/uploaded MD content (replaces individual fields in UI) */
  rawProjectInfo: string
  /** Current real-world situation to supplement vault data (MD format, injected into AI prompts) */
  currentSituation: string
}

export const DEFAULT_RAG_INSTRUCTION =
`문서 참조 우선순위:
- _index.md 파일이 첨부된 경우 가장 먼저 읽어 프로젝트 전체 구조와 최신 현황을 파악하세요.
- 여러 문서가 제공될 때는 날짜·수정일이 최신인 문서를 절대적 기준으로 삼아 가장 최근 상태를 기반으로 답변하세요.
- 최신 문서와 과거 문서의 내용이 충돌할 경우, 반드시 최신 데이터를 우선 채택하고 다음을 모두 수행하세요:
  1. 무엇이 어떻게 바뀌었는지 명확히 정리 (변경 전 vs 변경 후)
  2. 왜 바뀌었는지 문서 맥락에서 추론
  3. 이 변화가 프로젝트 방향에 시사하는 바(트렌드·리스크·기회)를 깊은 맥락으로 도출
- 과거 데이터는 변화의 '맥락·배경'으로만 활용하고, 현재 상태 판단의 근거로 삼지 마세요.

문서 분석 및 인사이트 도출:
- 첨부된 문서들을 개별 요약하지 말고, 전체를 종합하여 패턴·리스크·기회를 식별하세요.
- 여러 문서에 걸쳐 반복되는 이슈, 모순, 미결 사항을 적극적으로 찾아내세요.
- 나의 디렉터 역할 관점에서 실행 가능한 권고안(액션 아이템)을 제시하세요.
- 문서가 없는 경우에도 일반적인 게임 개발 지식으로 답변하되, 문서가 있으면 반드시 우선 활용하세요.
- 문서 내용에서 근거가 있다면 패턴 분석·트렌드 추론·리스크 예측을 적극적으로 수행하세요.

사실 정확성 원칙:
- 이름, 날짜, 수치, 인용구 등 구체적 사실은 문서에 명시된 것만 사용하고 절대 지어내지 마세요.
- 문서에서 확인되지 않는 구체적 사실이 필요한 경우 "문서에 없음"이라고 밝히고 일반 원칙으로 보완하세요.
- 분석·해석·권고는 근거를 명시하면 허용됩니다. "이 문서들을 종합하면..." 형태로 출처를 드러내세요.`

export const DEFAULT_RESPONSE_INSTRUCTIONS =
`응답 원칙:
- 질문자의 표면적 질문 너머 실제 의도와 맥락을 파악하여, 그것에 맞춰 더 깊고 실질적으로 답변하세요.
- 단순히 묻는 것만 답하지 말고, 질문 뒤에 숨겨진 문제나 다음 단계까지 선제적으로 짚어주세요.
- 공식 문서나 브리핑 보고서 형태로 작성하지 마세요. 대화 상대에게 직접 말하듯 답변하세요.
- "종합 분석 브리핑", "검토 완료" 같은 문서 제출 형식의 표현은 사용하지 마세요.
- 제목·부제목 남발 없이 자연스러운 흐름으로 핵심을 전달하세요.`

export const DEFAULT_PROJECT_INFO: ProjectInfo = {
  name: '',
  engine: '',
  genre: '',
  platform: '',
  scale: '',
  teamSize: '',
  description: '',
  teamMembers: '',
  rawProjectInfo: '',
  currentSituation: '',
}

export interface CustomPersona {
  id: string
  label: string
  role: string
  color: string
  darkBg: string
  systemPrompt: string
  modelId: string
}

interface SettingsState {
  /** Mapping: director persona → selected model ID */
  personaModels: Record<DirectorId, string>
  /** User-provided API keys (persisted in localStorage) */
  apiKeys: Partial<Record<ProviderId, string>>
  /** Whether the settings panel is open */
  settingsPanelOpen: boolean
  /** UI colour theme */
  theme: AppTheme
  /** Project metadata (injected into AI prompts as context) */
  projectInfo: ProjectInfo
  /** Per-director custom persona descriptions */
  directorBios: Partial<Record<DirectorId, string>>
  /** User-defined additional personas */
  customPersonas: CustomPersona[]
  /** System prompt overrides for built-in director personas */
  personaPromptOverrides: Record<string, string>
  /** Built-in persona IDs that the user has disabled (hidden) */
  disabledPersonaIds: string[]
  /** Whether markdown editor opens in locked (read-only) mode by default */
  editorDefaultLocked: boolean
  /** Paragraph rendering quality: high = full markdown+wikilinks, medium = markdown only, fast = plain text */
  paragraphRenderQuality: ParagraphRenderQuality
  /** Whether node labels are visible in the graph */
  showNodeLabels: boolean
  /** Allowed tag names for AI tag suggestion */
  tagPresets: string[]
  /** User-assigned hex colors per tag name (overrides auto-palette in graph) */
  tagColors: Record<string, string>
  /** User-assigned hex colors per folder path (overrides auto-palette in graph) */
  folderColors: Record<string, string>
  /** Global AI response format instructions (appended to every persona's system prompt) */
  responseInstructions: string
  /** Vault document IDs injected into each persona's system prompt as persona context */
  personaDocumentIds: Record<string, string>
  /** Model ID used for AI-generated conversation reports. Empty string = static format only. */
  reportModelId: string
  /** Multi-agent RAG: cheap worker LLMs summarize secondary docs before chief responds */
  multiAgentRAG: boolean
  /** Global RAG document-reference instructions (injected into every persona's system prompt) */
  ragInstruction: string

  setPersonaModel: (persona: DirectorId, modelId: string) => void
  resetPersonaModels: () => void
  setApiKey: (provider: ProviderId, key: string) => void
  setSettingsPanelOpen: (open: boolean) => void
  toggleSettingsPanel: () => void
  setTheme: (theme: AppTheme) => void
  setProjectInfo: (info: Partial<ProjectInfo>) => void
  setDirectorBio: (director: DirectorId, bio: string) => void
  addPersona: (persona: CustomPersona) => void
  updatePersona: (id: string, updates: Partial<Omit<CustomPersona, 'id'>>) => void
  removePersona: (id: string) => void
  setPersonaPromptOverride: (personaId: string, prompt: string) => void
  disableBuiltInPersona: (id: string) => void
  restoreBuiltInPersona: (id: string) => void
  /** Apply persona config loaded from vault file (overrides current state) */
  loadVaultPersonas: (config: VaultPersonaConfig) => void
  /** Reset all persona state to defaults (called when loading a vault with no config) */
  resetVaultPersonas: () => void
  setEditorDefaultLocked: (locked: boolean) => void
  setParagraphRenderQuality: (q: ParagraphRenderQuality) => void
  toggleNodeLabels: () => void
  addTagPreset: (tag: string) => void
  removeTagPreset: (tag: string) => void
  setTagColor: (tag: string, color: string) => void
  setFolderColor: (folderPath: string, color: string) => void
  setResponseInstructions: (v: string) => void
  setPersonaDocumentId: (personaId: string, docId: string | null) => void
  setReportModelId: (id: string) => void
  setMultiAgentRAG: (enabled: boolean) => void
  setRagInstruction: (v: string) => void
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
      projectInfo: { ...DEFAULT_PROJECT_INFO },
      directorBios: {},
      customPersonas: [],
      personaPromptOverrides: {},
      disabledPersonaIds: [],
      editorDefaultLocked: false,
      paragraphRenderQuality: 'fast' as ParagraphRenderQuality,
      showNodeLabels: false,
      tagPresets: [],
      tagColors: {},
      folderColors: {},
      responseInstructions: DEFAULT_RESPONSE_INSTRUCTIONS,
      personaDocumentIds: {},
      reportModelId: 'claude-sonnet-4-6',
      multiAgentRAG: true,
      ragInstruction: DEFAULT_RAG_INSTRUCTION,

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

      setProjectInfo: (info) =>
        set((state) => ({ projectInfo: { ...state.projectInfo, ...info } })),

      setDirectorBio: (director, bio) =>
        set((state) => ({ directorBios: { ...state.directorBios, [director]: bio } })),

      addPersona: (persona) =>
        set((state) => ({ customPersonas: [...state.customPersonas, persona] })),

      updatePersona: (id, updates) =>
        set((state) => ({
          customPersonas: state.customPersonas.map(p => p.id === id ? { ...p, ...updates } : p),
        })),

      removePersona: (id) =>
        set((state) => ({ customPersonas: state.customPersonas.filter(p => p.id !== id) })),

      setPersonaPromptOverride: (personaId, prompt) =>
        set((state) => ({
          personaPromptOverrides: prompt
            ? { ...state.personaPromptOverrides, [personaId]: prompt }
            : Object.fromEntries(Object.entries(state.personaPromptOverrides).filter(([k]) => k !== personaId)),
        })),

      disableBuiltInPersona: (id) =>
        set((state) => ({
          disabledPersonaIds: state.disabledPersonaIds.includes(id)
            ? state.disabledPersonaIds
            : [...state.disabledPersonaIds, id],
        })),

      restoreBuiltInPersona: (id) =>
        set((state) => ({
          disabledPersonaIds: state.disabledPersonaIds.filter(d => d !== id),
        })),

      loadVaultPersonas: (config) =>
        set((state) => ({
          customPersonas: config.customPersonas,
          personaPromptOverrides: config.personaPromptOverrides,
          disabledPersonaIds: config.disabledPersonaIds,
          directorBios: config.directorBios,
          personaModels: migratePersonaModels({
            ...state.personaModels,
            ...config.personaModels,
          }),
        })),

      resetVaultPersonas: () =>
        set({
          customPersonas: [],
          personaPromptOverrides: {},
          disabledPersonaIds: [],
          directorBios: {},
          personaModels: { ...DEFAULT_PERSONA_MODELS },
        }),

      setEditorDefaultLocked: (editorDefaultLocked) => set({ editorDefaultLocked }),

      setParagraphRenderQuality: (paragraphRenderQuality) => set({ paragraphRenderQuality }),

      toggleNodeLabels: () => set((s) => ({ showNodeLabels: !s.showNodeLabels })),

      addTagPreset: (tag) =>
        set((s) => ({
          tagPresets: s.tagPresets.includes(tag) ? s.tagPresets : [...s.tagPresets, tag],
        })),

      removeTagPreset: (tag) =>
        set((s) => ({
          tagPresets: s.tagPresets.filter(t => t !== tag),
          tagColors: Object.fromEntries(Object.entries(s.tagColors).filter(([k]) => k !== tag)),
        })),

      setTagColor: (tag, color) =>
        set((s) => ({ tagColors: { ...s.tagColors, [tag]: color } })),

      setFolderColor: (folderPath, color) =>
        set((s) => ({ folderColors: { ...s.folderColors, [folderPath]: color } })),

      setResponseInstructions: (responseInstructions) => set({ responseInstructions }),

      setPersonaDocumentId: (personaId, docId) =>
        set((s) => ({
          personaDocumentIds: docId
            ? { ...s.personaDocumentIds, [personaId]: docId }
            : Object.fromEntries(Object.entries(s.personaDocumentIds).filter(([k]) => k !== personaId)),
        })),

      setReportModelId: (reportModelId) => set({ reportModelId }),
      setMultiAgentRAG: (multiAgentRAG) => set({ multiAgentRAG }),
      setRagInstruction: (ragInstruction) => set({ ragInstruction }),
    }),
    {
      name: 'rembrandt-settings',
      partialize: (state) => ({
        personaModels: state.personaModels,
        apiKeys: state.apiKeys,
        theme: state.theme,
        projectInfo: state.projectInfo,
        directorBios: state.directorBios,
        customPersonas: state.customPersonas,
        personaPromptOverrides: state.personaPromptOverrides,
        disabledPersonaIds: state.disabledPersonaIds,
        editorDefaultLocked: state.editorDefaultLocked,
        paragraphRenderQuality: state.paragraphRenderQuality,
        showNodeLabels: state.showNodeLabels,
        tagPresets: state.tagPresets,
        tagColors: state.tagColors,
        folderColors: state.folderColors,
        responseInstructions: state.responseInstructions,
        personaDocumentIds: state.personaDocumentIds,
        reportModelId: state.reportModelId,
        multiAgentRAG: state.multiAgentRAG,
        ragInstruction: state.ragInstruction,
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
