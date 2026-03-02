import { useState } from 'react'
import { useSettingsStore, DEFAULT_RESPONSE_INSTRUCTIONS } from '@/stores/settingsStore'
import { MODEL_OPTIONS, type ProviderId } from '@/lib/modelConfig'
import { SPEAKER_CONFIG, SPEAKER_IDS } from '@/lib/speakerConfig'
import type { DirectorId } from '@/types'
import { GROUPED_OPTIONS, PROVIDER_LABELS } from '../settingsShared'

// ── Local helpers ─────────────────────────────────────────────────────────────

const API_KEY_PROVIDERS: { id: ProviderId; label: string; placeholder: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)',  placeholder: 'sk-ant-...' },
  { id: 'openai',    label: 'OpenAI (GPT)',        placeholder: 'sk-...' },
  { id: 'gemini',    label: 'Google (Gemini)',      placeholder: 'AIza...' },
  { id: 'grok',      label: 'xAI (Grok)',          placeholder: 'xai-...' },
]

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

// ── Component ─────────────────────────────────────────────────────────────────

export default function AITab() {
  const { personaModels, setPersonaModel, apiKeys, setApiKey, responseInstructions, setResponseInstructions } = useSettingsStore()
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

      <div style={{ borderTop: '1px solid var(--color-border)' }} />

      {/* Response instructions */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            AI 응답 지침
          </h3>
          <button
            onClick={() => setResponseInstructions(DEFAULT_RESPONSE_INSTRUCTIONS)}
            className="text-[10px] px-2 py-0.5 rounded"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
            title="기본 응답 원칙으로 복원"
          >
            기본값 복원
          </button>
        </div>
        <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
          모든 페르소나에 공통 적용되는 응답 형식·태도 지침입니다. 수정하거나 항목을 추가하세요.
        </p>
        <textarea
          value={responseInstructions}
          onChange={e => setResponseInstructions(e.target.value)}
          rows={8}
          spellCheck={false}
          style={{
            width: '100%',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 5,
            padding: '7px 9px',
            fontSize: 11,
            fontFamily: 'ui-monospace, monospace',
            color: 'var(--color-text-primary)',
            resize: 'vertical',
            lineHeight: 1.6,
            outline: 'none',
          }}
          placeholder="예: - 답변은 항상 3줄 이내로 요약해주세요."
        />
      </section>
    </div>
  )
}
