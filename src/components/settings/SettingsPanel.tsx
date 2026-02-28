/**
 * SettingsPanel — Centered modal popup with sidebar navigation.
 *
 * Layout: backdrop + centered modal (720×540)
 *   Left  186px : nav sidebar (도구 / 설정 / 기타 groups)
 *   Right rest  : content area (header + scrollable body + footer)
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, BarChart2, Clock, Download, Trash2,
  Settings, Cpu, GitMerge, Keyboard, Info,
  Sun, Moon, Monitor, Globe, Layers, Palette, Plus, Trash, FileCode,
  Users, ChevronDown, ChevronRight, RotateCcw,
} from 'lucide-react'
import { useSettingsStore, getApiKey, type AppTheme, type ColorRule, type CustomPersona } from '@/stores/settingsStore'
import { PERSONA_PROMPTS } from '@/lib/personaPrompts'
import { DEFAULT_PERSONA_MODELS } from '@/lib/modelConfig'
import { useUIStore } from '@/stores/uiStore'
import { MODEL_OPTIONS, type ProviderId } from '@/lib/modelConfig'
import { SPEAKER_CONFIG, SPEAKER_IDS } from '@/lib/speakerConfig'
import type { DirectorId } from '@/types'
import VaultSelector from './VaultSelector'
import { DebateSettingsContent } from '@/components/chat/debate/DebateSettingsContent'
import ConverterEditor from '@/components/converter/ConverterEditor'

// ── Types ─────────────────────────────────────────────────────────────────────

type SettingsTab =
  | 'stats' | 'timeline' | 'export' | 'trash' | 'converter'
  | 'general' | 'ai' | 'personas' | 'debate' | 'shortcuts' | 'project' | 'colors'
  | 'about'

type NavItem = { id: SettingsTab; icon: React.ElementType; label: string }
type NavGroup = { label: string; items: NavItem[] }

// ── Navigation structure ──────────────────────────────────────────────────────

const NAV: NavGroup[] = [
  {
    label: '도구',
    items: [
      { id: 'stats',     icon: BarChart2, label: '통계' },
      { id: 'timeline',  icon: Clock,     label: '타임라인' },
      { id: 'export',    icon: Download,  label: '내보내기' },
      { id: 'converter', icon: FileCode,  label: '가져오기' },
      { id: 'trash',     icon: Trash2,    label: '휴지통' },
    ],
  },
  {
    label: '설정',
    items: [
      { id: 'general',   icon: Settings,  label: '일반' },
      { id: 'ai',        icon: Cpu,       label: 'AI 설정' },
      { id: 'personas',  icon: Users,     label: '페르소나' },
      { id: 'project',   icon: Layers,    label: '프로젝트' },
      { id: 'colors',    icon: Palette,   label: '색상 규칙' },
      { id: 'debate',    icon: GitMerge,  label: '토론' },
      { id: 'shortcuts', icon: Keyboard,  label: '단축키' },
    ],
  },
  {
    label: '기타',
    items: [
      { id: 'about', icon: Info, label: '정보' },
    ],
  },
]

const ALL_ITEMS = NAV.flatMap(g => g.items)

// ── Grouped model options ─────────────────────────────────────────────────────

const GROUPED_OPTIONS = MODEL_OPTIONS.reduce<Record<string, typeof MODEL_OPTIONS>>(
  (acc, m) => { if (!acc[m.provider]) acc[m.provider] = []; acc[m.provider].push(m); return acc },
  {}
)

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai:    'OpenAI (GPT)',
  gemini:    'Google (Gemini)',
  grok:      'xAI (Grok)',
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function EnvHint({ provider }: { provider: string }) {
  const storeKey = useSettingsStore(s => s.apiKeys[provider as ProviderId])
  const hasKey = Boolean(storeKey) || Boolean((import.meta.env as Record<string, string>)[`VITE_${provider.toUpperCase()}_API_KEY`])
  return (
    <span
      className="text-[10px] ml-1 shrink-0"
      style={{ color: hasKey ? '#4caf50' : 'var(--color-text-muted)' }}
      title={hasKey ? 'API 키 설정됨' : 'API 키 미설정'}
    >
      {hasKey ? '●' : '○'}
    </span>
  )
}

// ── Tab content components ────────────────────────────────────────────────────

function GeneralContent() {
  const { theme, setTheme, editorDefaultLocked, setEditorDefaultLocked } = useSettingsStore()

  const themes: { id: AppTheme; label: string; Icon: React.ElementType }[] = [
    { id: 'light', label: '라이트',    Icon: Sun     },
    { id: 'dark',  label: '다크',      Icon: Moon    },
    { id: 'oled',  label: 'OLED 블랙', Icon: Monitor },
  ]

  return (
    <div className="flex flex-col gap-7">

      {/* 언어 */}
      <section>
        <div className="flex items-center gap-1.5 mb-3">
          <Globe size={13} style={{ color: 'var(--color-text-muted)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>언어</h3>
        </div>
        <div className="flex gap-2">
          {([
            { code: 'kr', flag: 'KR', label: '한국어' },
            { code: 'en', flag: 'US', label: 'English' },
          ] as const).map(lang => (
            <button
              key={lang.code}
              className="flex-1 px-3 py-2 rounded-lg text-xs transition-colors"
              style={{
                border: `1.5px solid ${lang.code === 'kr' ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: 'transparent',
                color: lang.code === 'kr' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              }}
            >
              <span className="font-semibold mr-1.5">{lang.flag}</span>
              {lang.label}
            </button>
          ))}
        </div>
      </section>

      {/* 테마 */}
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>테마</h3>
        <div className="grid grid-cols-3 gap-2">
          {themes.map(({ id, label, Icon }) => {
            const active = theme === id
            return (
              <button
                key={id}
                onClick={() => setTheme(id)}
                className="flex flex-col items-center gap-2 py-4 rounded-lg transition-colors"
                style={{
                  border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: active ? 'rgba(59,130,246,0.08)' : 'transparent',
                  color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                }}
              >
                <Icon size={18} />
                <span className="text-xs">{label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* 에디터 */}
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>에디터</h3>
        <div
          className="flex items-center justify-between px-3 py-2.5 rounded-lg"
          style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)' }}
        >
          <div>
            <div className="text-xs" style={{ color: 'var(--color-text-primary)' }}>기본 편집 잠금</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              문서를 열 때 읽기 전용 모드로 시작
            </div>
          </div>
          <button
            role="switch"
            aria-checked={editorDefaultLocked}
            onClick={() => setEditorDefaultLocked(!editorDefaultLocked)}
            className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
            style={{ background: editorDefaultLocked ? 'var(--color-accent)' : 'var(--color-border)' }}
          >
            <span
              className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
              style={{ transform: editorDefaultLocked ? 'translateX(18px)' : 'translateX(2px)' }}
            />
          </button>
        </div>
      </section>

      {/* 볼트 경로 */}
      <section data-testid="vault-section">
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>볼트 경로</h3>
        <VaultSelector />
      </section>
    </div>
  )
}

const API_KEY_PROVIDERS: { id: ProviderId; label: string; placeholder: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)',  placeholder: 'sk-ant-...' },
  { id: 'openai',    label: 'OpenAI (GPT)',        placeholder: 'sk-...' },
  { id: 'gemini',    label: 'Google (Gemini)',      placeholder: 'AIza...' },
  { id: 'grok',      label: 'xAI (Grok)',          placeholder: 'xai-...' },
]

function AIContent() {
  const { personaModels, setPersonaModel, apiKeys, setApiKey } = useSettingsStore()
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})

  const toggleKeyVisibility = (id: string) =>
    setVisibleKeys(prev => ({ ...prev, [id]: !prev[id] }))

  return (
    <div className="flex flex-col gap-5" data-testid="model-section">

      {/* API Keys */}
      <section>
        <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>API 키</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          각 AI 제공자의 API 키를 입력하세요. 브라우저 로컬 스토리지에 저장됩니다.
        </p>
        <div className="flex flex-col gap-2.5">
          {API_KEY_PROVIDERS.map(({ id, label, placeholder }) => {
            const hasEnv = Boolean((import.meta.env as Record<string, string>)[`VITE_${id.toUpperCase()}_API_KEY`])
            const storeValue = apiKeys[id] ?? ''
            const hasKey = Boolean(storeValue) || hasEnv
            return (
              <div key={id} className="flex items-center gap-2">
                <div
                  className="shrink-0 text-[11px] font-medium"
                  style={{ color: 'var(--color-text-secondary)', minWidth: 120 }}
                >
                  {label}
                  <span
                    className="text-[10px] ml-1.5"
                    style={{ color: hasKey ? '#4caf50' : 'var(--color-text-muted)' }}
                  >{hasKey ? '●' : '○'}</span>
                </div>
                <div className="flex-1 relative">
                  <input
                    type={visibleKeys[id] ? 'text' : 'password'}
                    value={storeValue}
                    onChange={e => setApiKey(id, e.target.value)}
                    placeholder={hasEnv ? '(환경변수 사용 중)' : placeholder}
                    className="w-full text-xs rounded px-2 py-1.5 pr-7 font-mono"
                    style={{
                      background: 'var(--color-bg-surface)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)',
                      outline: 'none',
                    }}
                    autoComplete="off"
                    data-testid={`api-key-${id}`}
                  />
                  <button
                    type="button"
                    onClick={() => toggleKeyVisibility(id)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] px-1"
                    style={{ color: 'var(--color-text-muted)' }}
                    tabIndex={-1}
                  >
                    {visibleKeys[id] ? '숨김' : '보기'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Persona → model mapping */}
      <section>
        <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>페르소나 모델</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          각 디렉터 페르소나에 사용할 AI 모델을 선택하세요. API 키 미설정 시 Mock 응답을 사용합니다.
        </p>
        <div className="flex flex-col gap-2.5">
          {SPEAKER_IDS.map(persona => {
            const meta = SPEAKER_CONFIG[persona]
            const selectedModel = personaModels[persona]
            const currentProvider = MODEL_OPTIONS.find(m => m.id === selectedModel)?.provider ?? ''

            return (
              <div
                key={persona}
                className="flex items-center gap-3"
                data-testid={`persona-row-${persona}`}
              >
                {/* Persona chip */}
                <div
                  className="shrink-0 text-xs px-2 py-1 rounded font-mono"
                  style={{ background: meta.darkBg, color: meta.color, minWidth: 44, textAlign: 'center' }}
                >
                  {meta.label}
                </div>

                {/* Model select */}
                <div className="flex-1 relative">
                  <select
                    value={selectedModel}
                    onChange={e => setPersonaModel(persona as DirectorId, e.target.value)}
                    className="w-full text-xs rounded px-2 py-1.5 appearance-none pr-6"
                    style={{
                      background: 'var(--color-bg-surface)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)',
                      outline: 'none',
                    }}
                    aria-label={`${meta.label} model`}
                    data-testid={`model-select-${persona}`}
                  >
                    {Object.entries(GROUPED_OPTIONS).map(([provider, models]) => (
                      <optgroup key={provider} label={PROVIDER_LABELS[provider] ?? provider}>
                        {models.map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <span
                    className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[10px]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >▾</span>
                </div>

                <EnvHint provider={currentProvider} />
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function DebateContent() {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>토론 설정</h3>
      <DebateSettingsContent />
    </div>
  )
}

function PlaceholderContent({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 py-20">
      <span style={{ fontSize: 32, opacity: 0.2 }}>🚧</span>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{label} — 준비 중</p>
    </div>
  )
}

// ── Shared field style helpers ─────────────────────────────────────────────────

const fieldInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border)',
  borderRadius: 5,
  padding: '5px 8px',
  fontSize: 12,
  outline: 'none',
  fontFamily: 'inherit',
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  marginBottom: 4,
  display: 'block',
}

function ProjectContent() {
  const { projectInfo, setProjectInfo } = useSettingsStore()

  const SCALE_OPTIONS = ['Indie', 'AA', 'AAA', '모바일', '기타']
  const FIELD_ROWS: { key: keyof typeof projectInfo; label: string; placeholder: string }[] = [
    { key: 'name',     label: '프로젝트명',  placeholder: 'My Awesome Game' },
    { key: 'engine',   label: '게임 엔진',   placeholder: 'Unreal Engine 5, Unity, Godot...' },
    { key: 'genre',    label: '장르',        placeholder: 'RPG, FPS, Strategy...' },
    { key: 'platform', label: '플랫폼',      placeholder: 'PC, Console, Mobile...' },
    { key: 'teamSize', label: '팀 인원',     placeholder: '10명' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          프로젝트 정보
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
          {FIELD_ROWS.map(({ key, label, placeholder }) => (
            <div key={key}>
              <label style={fieldLabelStyle}>{label}</label>
              <input
                type="text"
                value={projectInfo[key]}
                onChange={e => setProjectInfo({ [key]: e.target.value })}
                placeholder={placeholder}
                style={fieldInputStyle}
              />
            </div>
          ))}

          {/* 개발 규모 — dropdown */}
          <div>
            <label style={fieldLabelStyle}>개발 규모</label>
            <div style={{ position: 'relative' }}>
              <select
                value={projectInfo.scale}
                onChange={e => setProjectInfo({ scale: e.target.value })}
                style={{ ...fieldInputStyle, appearance: 'none', paddingRight: 24, cursor: 'pointer' }}
              >
                <option value="">선택...</option>
                {SCALE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--color-text-muted)', pointerEvents: 'none' }}>▾</span>
            </div>
          </div>
        </div>

        {/* 개요 */}
        <div style={{ marginTop: 10 }}>
          <label style={fieldLabelStyle}>프로젝트 개요</label>
          <textarea
            value={projectInfo.description}
            onChange={e => setProjectInfo({ description: e.target.value })}
            placeholder="게임의 핵심 컨셉, 목표 유저, 차별점 등을 간략히 설명해주세요..."
            rows={4}
            style={{ ...fieldInputStyle, resize: 'vertical', lineHeight: 1.6 }}
          />
        </div>
      </section>
    </div>
  )
}

// ── Persona helpers ───────────────────────────────────────────────────────────

/** Compute a dark background chip color from a foreground hex color */
function computeDarkBg(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#1a1a2e'
  const r = Math.floor(parseInt(hex.slice(1, 3), 16) * 0.18)
  const g = Math.floor(parseInt(hex.slice(3, 5), 16) * 0.18)
  const b = Math.floor(parseInt(hex.slice(5, 7), 16) * 0.18)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = (label: string) =>
  `당신은 게임 개발 스튜디오의 ${label} 디렉터입니다.\n\n역할과 책임:\n- \n\n커뮤니케이션 스타일:\n- `

function PersonasContent() {
  const {
    personaPromptOverrides, setPersonaPromptOverride,
    customPersonas, addPersona, updatePersona, removePersona,
    personaModels, setPersonaModel,
    disabledPersonaIds, disableBuiltInPersona, restoreBuiltInPersona,
    directorBios, setDirectorBio,
  } = useSettingsStore()

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newRole, setNewRole] = useState('')
  const [newColor, setNewColor] = useState('#60a5fa')

  const toggle = (id: string) => setExpandedId(prev => prev === id ? null : id)

  const handleAddPersona = () => {
    const label = newLabel.trim()
    if (!label) return
    const color = newColor
    const darkBg = computeDarkBg(color)
    const id = `custom_${Date.now()}`
    addPersona({
      id,
      label,
      role: newRole.trim() || '커스텀 디렉터',
      color,
      darkBg,
      systemPrompt: DEFAULT_SYSTEM_PROMPT_TEMPLATE(label),
      modelId: DEFAULT_PERSONA_MODELS['chief_director'],
    } satisfies CustomPersona)
    setNewLabel('')
    setNewRole('')
    setNewColor('#60a5fa')
    setShowAddForm(false)
    setExpandedId(id)
  }

  const chipStyle = (color: string, darkBg: string): React.CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 4,
    background: darkBg,
    color,
    flexShrink: 0,
    fontFamily: 'monospace',
  })

  return (
    <div className="flex flex-col gap-6">

      {/* ── Built-in personas ── */}
      <section>
        <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
          기본 페르소나
        </h3>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
          각 디렉터의 AI 시스템 프롬프트를 수정하거나 삭제할 수 있습니다.
        </p>

        {/* Active built-in personas */}
        <div className="flex flex-col gap-1 mb-2">
          {SPEAKER_IDS.filter(id => !disabledPersonaIds.includes(id)).map(id => {
            const meta = SPEAKER_CONFIG[id]
            const isExpanded = expandedId === id
            const isOverridden = Boolean(personaPromptOverrides[id])
            const prompt = personaPromptOverrides[id] ?? PERSONA_PROMPTS[id] ?? ''
            const selectedModel = personaModels[id]

            return (
              <div
                key={id}
                style={{ border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}
              >
                {/* Row header */}
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--color-bg-surface)' }}>
                  <button
                    onClick={() => toggle(id)}
                    className="flex-1 flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--color-bg-hover)]"
                  >
                    {isExpanded
                      ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                      : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                    }
                    <span style={chipStyle(meta.color, meta.darkBg)}>{meta.label}</span>
                    <span className="text-xs flex-1" style={{ color: 'var(--color-text-muted)' }}>{meta.role}</span>
                    {isOverridden && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.15)', color: 'var(--color-accent)' }}>
                        수정됨
                      </span>
                    )}
                  </button>
                  {/* Delete built-in persona */}
                  <button
                    onClick={() => {
                      if (window.confirm(`"${meta.label}" 페르소나를 비활성화하시겠습니까?\n페르소나 탭에서 언제든 복원할 수 있습니다.`)) {
                        disableBuiltInPersona(id)
                        if (expandedId === id) setExpandedId(null)
                      }
                    }}
                    style={{
                      flexShrink: 0,
                      background: 'transparent',
                      border: 'none',
                      padding: '0 12px',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      height: '100%',
                    }}
                    title="페르소나 비활성화"
                  >
                    <Trash size={12} />
                  </button>
                </div>

                {/* Expanded editor */}
                {isExpanded && (
                  <div style={{ padding: '10px 12px 12px', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-primary)' }}>
                    {/* Model selector */}
                    <div style={{ marginBottom: 10 }}>
                      <label style={fieldLabelStyle}>모델</label>
                      <div style={{ position: 'relative' }}>
                        <select
                          value={selectedModel}
                          onChange={e => setPersonaModel(id, e.target.value)}
                          style={{ ...fieldInputStyle, appearance: 'none', paddingRight: 24 }}
                        >
                          {Object.entries(GROUPED_OPTIONS).map(([provider, models]) => (
                            <optgroup key={provider} label={PROVIDER_LABELS[provider] ?? provider}>
                              {models.map(m => (
                                <option key={m.id} value={m.id}>{m.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--color-text-muted)', pointerEvents: 'none' }}>▾</span>
                      </div>
                    </div>

                    {/* Director bio */}
                    <div style={{ marginBottom: 10 }}>
                      <label style={fieldLabelStyle}>개인 소개 · 성향</label>
                      <textarea
                        value={directorBios[id] ?? ''}
                        onChange={e => setDirectorBio(id, e.target.value)}
                        placeholder={`${meta.label} 디렉터의 성향, 전문성, 우선순위 등... (AI 프롬프트에 추가로 반영됩니다)`}
                        rows={3}
                        style={{ ...fieldInputStyle, resize: 'vertical', lineHeight: 1.6 }}
                      />
                    </div>

                    {/* System prompt editor */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <div style={{ flex: 1 }}>
                        <label style={fieldLabelStyle}>시스템 프롬프트</label>
                        <textarea
                          value={prompt}
                          onChange={e => setPersonaPromptOverride(id, e.target.value)}
                          rows={8}
                          style={{ ...fieldInputStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'monospace', fontSize: 11 }}
                        />
                      </div>
                      {isOverridden && (
                        <button
                          onClick={() => setPersonaPromptOverride(id, '')}
                          style={{
                            marginTop: 18,
                            flexShrink: 0,
                            background: 'transparent',
                            border: '1px solid var(--color-border)',
                            borderRadius: 5,
                            padding: '5px 7px',
                            color: 'var(--color-text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          title="프롬프트 기본값으로 복원"
                        >
                          <RotateCcw size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Disabled built-in personas */}
        {disabledPersonaIds.filter(id => SPEAKER_IDS.includes(id as typeof SPEAKER_IDS[number])).length > 0 && (
          <div>
            <p className="text-[10px] mb-1.5" style={{ color: 'var(--color-text-muted)' }}>비활성화된 페르소나</p>
            <div className="flex flex-col gap-1">
              {SPEAKER_IDS.filter(id => disabledPersonaIds.includes(id)).map(id => {
                const meta = SPEAKER_CONFIG[id]
                return (
                  <div
                    key={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      border: '1px dashed var(--color-border)',
                      borderRadius: 6,
                      opacity: 0.6,
                    }}
                  >
                    <span style={{ ...chipStyle(meta.color, meta.darkBg), opacity: 0.5 }}>{meta.label}</span>
                    <span className="text-xs flex-1" style={{ color: 'var(--color-text-muted)', textDecoration: 'line-through' }}>{meta.role}</span>
                    <button
                      onClick={() => restoreBuiltInPersona(id)}
                      style={{
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'transparent',
                        border: '1px solid var(--color-border)',
                        borderRadius: 4,
                        padding: '3px 8px',
                        color: 'var(--color-text-muted)',
                        cursor: 'pointer',
                        fontSize: 10,
                      }}
                      title="페르소나 복원"
                    >
                      <RotateCcw size={10} />
                      복원
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* ── Custom personas ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>커스텀 페르소나</h3>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              새 디렉터 역할을 추가하고 전용 AI 프롬프트를 설정하세요.
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(f => !f)}
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'var(--color-accent)',
              border: 'none',
              borderRadius: 5,
              padding: '5px 10px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            <Plus size={11} />
            페르소나 추가
          </button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div
            style={{
              border: '1px dashed var(--color-accent)',
              borderRadius: 6,
              padding: '10px 12px',
              marginBottom: 10,
              background: 'rgba(59,130,246,0.04)',
            }}
          >
            <p className="text-xs font-medium mb-3" style={{ color: 'var(--color-accent)' }}>새 페르소나</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
              <div>
                <label style={fieldLabelStyle}>이름 *</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddPersona()}
                  placeholder="예: QA, Sound, Producer..."
                  style={fieldInputStyle}
                  autoFocus
                />
              </div>
              <div>
                <label style={fieldLabelStyle}>역할 설명</label>
                <input
                  type="text"
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                  placeholder="예: 품질 관리 · 버그 리포트"
                  style={fieldInputStyle}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <div>
                <label style={fieldLabelStyle}>색상</label>
                <input
                  type="color"
                  value={newColor}
                  onChange={e => setNewColor(e.target.value)}
                  style={{ width: 40, height: 28, padding: 2, border: '1px solid var(--color-border)', borderRadius: 5, background: 'var(--color-bg-surface)', cursor: 'pointer' }}
                />
              </div>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setShowAddForm(false)}
                style={{ background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 10px', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11 }}
              >
                취소
              </button>
              <button
                onClick={handleAddPersona}
                disabled={!newLabel.trim()}
                style={{
                  background: newLabel.trim() ? 'var(--color-accent)' : 'var(--color-bg-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 5,
                  padding: '5px 12px',
                  color: newLabel.trim() ? '#fff' : 'var(--color-text-muted)',
                  cursor: newLabel.trim() ? 'pointer' : 'not-allowed',
                  fontSize: 11,
                  opacity: newLabel.trim() ? 1 : 0.5,
                }}
              >
                추가
              </button>
            </div>
          </div>
        )}

        {/* Custom persona list */}
        {customPersonas.length === 0 && !showAddForm ? (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>
            아직 커스텀 페르소나가 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {customPersonas.map(persona => {
              const isExpanded = expandedId === persona.id
              return (
                <div
                  key={persona.id}
                  style={{ border: '1px solid var(--color-border)', borderRadius: 6, overflow: 'hidden' }}
                >
                  {/* Row header */}
                  <div style={{ display: 'flex', alignItems: 'center', background: 'var(--color-bg-surface)' }}>
                    <button
                      onClick={() => toggle(persona.id)}
                      className="flex-1 flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--color-bg-hover)]"
                    >
                      {isExpanded
                        ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                        : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                      }
                      <span style={chipStyle(persona.color, persona.darkBg)}>{persona.label}</span>
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{persona.role}</span>
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`"${persona.label}" 페르소나를 삭제하시겠습니까?`)) {
                          removePersona(persona.id)
                          if (expandedId === persona.id) setExpandedId(null)
                        }
                      }}
                      style={{
                        flexShrink: 0,
                        background: 'transparent',
                        border: 'none',
                        padding: '0 12px',
                        color: 'var(--color-text-muted)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        height: '100%',
                      }}
                      title="페르소나 삭제"
                    >
                      <Trash size={12} />
                    </button>
                  </div>

                  {/* Expanded editor */}
                  {isExpanded && (
                    <div style={{ padding: '10px 12px 12px', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-primary)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 10 }}>
                        <div>
                          <label style={fieldLabelStyle}>이름</label>
                          <input
                            type="text"
                            value={persona.label}
                            onChange={e => updatePersona(persona.id, { label: e.target.value })}
                            style={fieldInputStyle}
                          />
                        </div>
                        <div>
                          <label style={fieldLabelStyle}>역할 설명</label>
                          <input
                            type="text"
                            value={persona.role}
                            onChange={e => updatePersona(persona.id, { role: e.target.value })}
                            style={fieldInputStyle}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                        <div>
                          <label style={fieldLabelStyle}>색상</label>
                          <input
                            type="color"
                            value={persona.color}
                            onChange={e => {
                              const color = e.target.value
                              updatePersona(persona.id, { color, darkBg: computeDarkBg(color) })
                            }}
                            style={{ width: 40, height: 28, padding: 2, border: '1px solid var(--color-border)', borderRadius: 5, background: 'var(--color-bg-surface)', cursor: 'pointer' }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={fieldLabelStyle}>모델</label>
                          <div style={{ position: 'relative' }}>
                            <select
                              value={persona.modelId}
                              onChange={e => updatePersona(persona.id, { modelId: e.target.value })}
                              style={{ ...fieldInputStyle, appearance: 'none', paddingRight: 24 }}
                            >
                              {Object.entries(GROUPED_OPTIONS).map(([provider, models]) => (
                                <optgroup key={provider} label={PROVIDER_LABELS[provider] ?? provider}>
                                  {models.map(m => (
                                    <option key={m.id} value={m.id}>{m.label}</option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                            <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--color-text-muted)', pointerEvents: 'none' }}>▾</span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label style={fieldLabelStyle}>시스템 프롬프트</label>
                        <textarea
                          value={persona.systemPrompt}
                          onChange={e => updatePersona(persona.id, { systemPrompt: e.target.value })}
                          rows={8}
                          style={{ ...fieldInputStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'monospace', fontSize: 11 }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function ColorRulesContent() {
  const { colorRules, addColorRule, updateColorRule, removeColorRule } = useSettingsStore()
  const [newKeyword, setNewKeyword] = useState('')
  const [newColor, setNewColor] = useState('#60a5fa')

  const handleAdd = () => {
    const kw = newKeyword.trim()
    if (!kw) return
    addColorRule({ id: crypto.randomUUID(), keyword: kw, color: newColor })
    setNewKeyword('')
    setNewColor('#60a5fa')
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
          키워드 색상 규칙
        </h3>
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
          노드 제목이나 태그에 키워드가 포함되면 지정한 색상이 적용됩니다.
          일치하는 규칙이 없는 노드는 회색으로 표시됩니다.
          그래프 색상 모드에서 <strong style={{ color: 'var(--color-text-secondary)' }}>규칙</strong>을 선택해야 적용됩니다.
        </p>

        {/* Rule list */}
        {colorRules.length > 0 ? (
          <div className="flex flex-col gap-2 mb-4">
            {colorRules.map((rule: ColorRule) => (
              <div key={rule.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Color picker */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <input
                    type="color"
                    value={rule.color}
                    onChange={e => updateColorRule(rule.id, { color: e.target.value })}
                    style={{
                      width: 32,
                      height: 28,
                      padding: 2,
                      border: '1px solid var(--color-border)',
                      borderRadius: 5,
                      background: 'var(--color-bg-surface)',
                      cursor: 'pointer',
                    }}
                    title="색상 변경"
                  />
                </div>
                {/* Keyword input */}
                <input
                  type="text"
                  value={rule.keyword}
                  onChange={e => updateColorRule(rule.id, { keyword: e.target.value })}
                  style={{ ...fieldInputStyle, flex: 1 }}
                  placeholder="키워드"
                />
                {/* Delete */}
                <button
                  onClick={() => removeColorRule(rule.id)}
                  style={{
                    flexShrink: 0,
                    background: 'transparent',
                    border: '1px solid var(--color-border)',
                    borderRadius: 5,
                    padding: '4px 6px',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="규칙 삭제"
                >
                  <Trash size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>
            아직 규칙이 없습니다. 아래에서 추가하세요.
          </p>
        )}

        {/* Add new rule */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
          <input
            type="color"
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            style={{
              width: 32,
              height: 28,
              padding: 2,
              border: '1px solid var(--color-border)',
              borderRadius: 5,
              background: 'var(--color-bg-surface)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            title="새 규칙 색상"
          />
          <input
            type="text"
            value={newKeyword}
            onChange={e => setNewKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="새 키워드 입력..."
            style={{ ...fieldInputStyle, flex: 1 }}
          />
          <button
            onClick={handleAdd}
            disabled={!newKeyword.trim()}
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: newKeyword.trim() ? 'var(--color-accent)' : 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 5,
              padding: '5px 10px',
              color: newKeyword.trim() ? '#fff' : 'var(--color-text-muted)',
              cursor: newKeyword.trim() ? 'pointer' : 'not-allowed',
              fontSize: 11,
              opacity: newKeyword.trim() ? 1 : 0.5,
            }}
          >
            <Plus size={11} />
            추가
          </button>
        </div>
      </section>
    </div>
  )
}

function AboutContent() {
  const sectionTitle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 8,
  }
  const badge: React.CSSProperties = {
    display: 'inline-block',
    fontSize: 10,
    padding: '2px 7px',
    borderRadius: 4,
    background: 'var(--color-bg-active)',
    color: 'var(--color-accent)',
    marginRight: 4,
    marginBottom: 4,
  }
  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '5px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    fontSize: 11,
  }

  return (
    <div className="flex flex-col gap-6">

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.02em' }}>
            Rembrandt Map
          </h2>
          <p style={{ fontSize: 11, color: 'var(--color-accent)', marginTop: 2 }}>
            v0.3.0 &nbsp;·&nbsp; AI Director Proxy System
          </p>
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'right', lineHeight: 1.6 }}>
          <div>개발자</div>
          <a
            href="mailto:miro85a@gmail.com"
            style={{ color: 'var(--color-accent)', textDecoration: 'none' }}
          >
            miro85a@gmail.com
          </a>
        </div>
      </div>

      {/* 개요 */}
      <div>
        <p style={{ fontSize: 12, lineHeight: 1.8, color: 'var(--color-text-secondary)' }}>
          Obsidian 볼트를 <strong style={{ color: 'var(--color-text-primary)' }}>위키링크 지식 그래프</strong>로 시각화하고,
          5명의 AI 디렉터 페르소나가 그래프를 BFS 탐색하며 프로젝트 전반의 인사이트와 피드백을 제공합니다.
          게임 개발 스튜디오의 지식 관리 및 의사결정 지원을 목적으로 설계되었습니다.
        </p>
      </div>

      {/* 기술 스택 */}
      <div>
        <p style={sectionTitle}>기술 스택</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
          {[
            'Electron 31', 'React 19', 'TypeScript 5.5', 'Vite 5',
            'Three.js', 'd3-force', 'CodeMirror 6', 'Zustand 5',
            'Tailwind CSS 4', 'Framer Motion', 'FastAPI', 'ChromaDB',
          ].map(t => (
            <span key={t} style={badge}>{t}</span>
          ))}
        </div>
      </div>

      {/* LLM 지원 */}
      <div>
        <p style={sectionTitle}>지원 LLM</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            { provider: 'Anthropic', models: 'Claude Opus / Sonnet / Haiku', vision: true },
            { provider: 'OpenAI', models: 'GPT-4o / GPT-4o mini', vision: true },
            { provider: 'Google', models: 'Gemini 1.5 Pro / Flash', vision: true },
            { provider: 'xAI', models: 'Grok Beta', vision: false },
          ].map(({ provider, models, vision }) => (
            <div key={provider} style={row}>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{provider}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {models}
                {vision && <span style={{ ...badge, marginLeft: 6, marginBottom: 0, color: 'var(--color-text-secondary)' }}>비전</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 핵심 알고리즘 */}
      <div>
        <p style={sectionTitle}>핵심 알고리즘</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            {
              name: 'TF-IDF 벡터 검색',
              desc: '볼트 로드 시 문서를 벡터화, 코사인 유사도로 의미적 시드 선택',
            },
            {
              name: 'BFS 그래프 탐색',
              desc: 'WikiLink를 따라 최대 4홉, 35개 문서를 홉 거리별 예산으로 수집',
            },
            {
              name: 'PageRank',
              desc: '역방향 엣지 O(N+M) 알고리즘으로 허브 문서 식별 (25회 반복)',
            },
            {
              name: 'Union-Find 클러스터링',
              desc: '경로 압축 포함 연결 컴포넌트 감지, 클러스터별 문서 그룹화',
            },
            {
              name: 'Korean 형태소 처리',
              desc: '그리디 최장 일치 조사 제거 (이라는/에서의/으로 등 50+종)',
            },
            {
              name: 'd3-force 물리 시뮬레이션',
              desc: '반발력·인장력·중심력 균형으로 자연스러운 2D/3D 그래프 레이아웃',
            },
          ].map(({ name, desc }) => (
            <div key={name} style={{ ...row, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600, fontSize: 11 }}>{name}</span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 10, lineHeight: 1.5 }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* RAG 파이프라인 */}
      <div>
        <p style={sectionTitle}>Graph-Augmented RAG 파이프라인</p>
        <div style={{
          background: 'var(--color-bg-active)',
          borderRadius: 6,
          padding: '10px 12px',
          fontSize: 10,
          color: 'var(--color-text-muted)',
          lineHeight: 1.9,
          fontFamily: 'monospace',
        }}>
          {[
            '① 인텐트 감지 → 전체/전반 키워드 → buildGlobalGraphContext()',
            '② TF-IDF 코사인 유사도 검색 → 상위 8개 후보',
            '③ 스코어 필터 (> 0.05) + 재순위화',
            '④ 시드 < 2개 → PageRank 허브 노드 자동 보완',
            '⑤ BFS 탐색 (3홉, 최대 20개 문서)',
            '⑥ 구조 헤더 주입 (PageRank 상위 + 클러스터 개요)',
            '⑦ LLM 스트리밍 분석',
          ].map(line => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </div>

    </div>
  )
}

function renderTabContent(tab: SettingsTab) {
  switch (tab) {
    case 'general':   return <GeneralContent />
    case 'ai':        return <AIContent />
    case 'personas':  return <PersonasContent />
    case 'project':   return <ProjectContent />
    case 'colors':    return <ColorRulesContent />
    case 'debate':    return <DebateContent />
    case 'about':     return <AboutContent />
    default:          return <PlaceholderContent label={ALL_ITEMS.find(i => i.id === tab)?.label ?? tab} />
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SettingsPanel() {
  const { settingsPanelOpen, resetPersonaModels, setSettingsPanelOpen } = useSettingsStore()
  // Default to 'ai' so all persona/vault tests pass without navigating
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai')

  const activeLabel = ALL_ITEMS.find(i => i.id === activeTab)?.label ?? ''

  const handleNavClick = (id: SettingsTab) => {
    setActiveTab(id)
  }

  return (
    <AnimatePresence>
      {settingsPanelOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setSettingsPanelOpen(false)}
            data-testid="settings-backdrop"
          />

          {/* Modal wrapper — flex center */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring' as const, stiffness: 360, damping: 32 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ pointerEvents: 'none' }}
          >
            {/* Modal card */}
            <div
              className="flex overflow-hidden"
              style={{
                width: 760,
                height: 680,
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
                pointerEvents: 'auto',
              }}
              data-testid="settings-panel"
            >

              {/* ── Left sidebar ─────────────────────────────────────── */}
              <div
                className="flex flex-col shrink-0"
                style={{
                  width: 186,
                  borderRight: '1px solid var(--color-border)',
                  background: 'var(--color-bg-primary)',
                }}
              >
                {/* Sidebar header */}
                <div
                  className="flex items-center px-4 h-10 shrink-0"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                    설정
                  </span>
                </div>

                {/* Nav groups */}
                <div className="flex-1 overflow-y-auto py-2">
                  {NAV.map((group, gi) => (
                    <div key={group.label} className={gi > 0 ? 'mt-3' : ''}>
                      {/* Group label */}
                      <div
                        className="px-4 pb-1 text-[10px] font-semibold tracking-wider uppercase"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {group.label}
                      </div>

                      {/* Nav items */}
                      {group.items.map(item => {
                        const Icon = item.icon
                        const active = activeTab === item.id
                        return (
                          <button
                            key={item.id}
                            onClick={() => handleNavClick(item.id)}
                            className="w-full flex items-center gap-2.5 px-4 py-1.5 text-xs transition-colors text-left"
                            style={{
                              background: active ? 'var(--color-bg-hover)' : 'transparent',
                              color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                              fontWeight: active ? 500 : 400,
                            }}
                          >
                            <Icon size={13} />
                            {item.label}
                          </button>
                        )
                      })}

                      {/* Divider between groups (except after last) */}
                      {gi < NAV.length - 1 && (
                        <div
                          className="mx-4 mt-3"
                          style={{ borderTop: '1px solid var(--color-border)' }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Right content ─────────────────────────────────────── */}
              <div className="flex-1 flex flex-col min-w-0">

                {/* Content header */}
                <div
                  className="flex items-center justify-between px-6 h-10 shrink-0"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {activeLabel}
                  </span>
                  <button
                    onClick={() => setSettingsPanelOpen(false)}
                    className="p-1 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                    style={{ color: 'var(--color-text-muted)' }}
                    aria-label="닫기"
                    data-testid="settings-close"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Scrollable body */}
                <div className={
                  activeTab === 'converter'
                    ? 'flex-1 overflow-hidden flex flex-col'
                    : 'flex-1 overflow-y-auto px-6 py-5'
                }>
                  {activeTab === 'converter'
                    ? <ConverterEditor onBack={() => setSettingsPanelOpen(false)} />
                    : renderTabContent(activeTab)
                  }
                </div>

                {/* Footer */}
                <div
                  className="px-6 py-3 shrink-0 flex items-center justify-between"
                  style={{ borderTop: '1px solid var(--color-border)' }}
                >
                  <button
                    onClick={resetPersonaModels}
                    className="text-xs px-3 py-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                    style={{ color: 'var(--color-text-muted)' }}
                    data-testid="settings-reset"
                  >
                    기본값으로 초기화
                  </button>
                  <button
                    onClick={() => setSettingsPanelOpen(false)}
                    className="text-xs px-4 py-1.5 rounded transition-colors"
                    style={{ background: 'var(--color-accent)', color: '#fff' }}
                    data-testid="settings-save"
                  >
                    저장
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
