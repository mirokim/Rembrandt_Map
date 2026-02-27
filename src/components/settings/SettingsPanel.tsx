import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronDown } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { MODEL_OPTIONS } from '@/lib/modelConfig'
import { SPEAKER_CONFIG, SPEAKER_IDS } from '@/lib/speakerConfig'
import type { SpeakerId, DirectorId } from '@/types'
import VaultSelector from './VaultSelector'
import { DebateSettingsContent } from '@/components/chat/debate/DebateSettingsContent'

// Group model options by provider for the select dropdown
const GROUPED_OPTIONS = MODEL_OPTIONS.reduce<Record<string, typeof MODEL_OPTIONS>>(
  (acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = []
    acc[m.provider].push(m)
    return acc
  },
  {}
)

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  gemini: 'Google (Gemini)',
  grok: 'xAI (Grok)',
}

// ── Env key hint ───────────────────────────────────────────────────────────────

function EnvHint({ provider }: { provider: string }) {
  const envKey = `VITE_${provider.toUpperCase()}_API_KEY`
  const hasKey = Boolean(
    (import.meta.env as Record<string, string>)[envKey]
  )

  return (
    <span
      className="text-[10px] ml-1"
      style={{ color: hasKey ? '#4caf50' : 'var(--color-text-muted)' }}
      title={hasKey ? 'API 키가 설정되어 있습니다' : `.env에 ${envKey}를 추가하세요`}
    >
      {hasKey ? '●' : '○'}
    </span>
  )
}

// ── Collapsible section ────────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  'data-testid': testId,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  'data-testid'?: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div data-testid={testId}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-2 text-xs font-semibold tracking-wider uppercase transition-colors"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {title}
        <ChevronDown
          size={13}
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        />
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function SettingsPanel() {
  const { settingsPanelOpen, personaModels, setPersonaModel, resetPersonaModels, setSettingsPanelOpen } =
    useSettingsStore()

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
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setSettingsPanelOpen(false)}
            data-testid="settings-backdrop"
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring' as const, stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
            style={{
              width: 360,
              background: 'var(--color-bg-secondary)',
              borderLeft: '1px solid var(--color-border)',
            }}
            data-testid="settings-panel"
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 h-10 shrink-0"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <span
                className="text-xs font-semibold tracking-widest"
                style={{ color: 'var(--color-text-muted)' }}
              >
                설정
              </span>
              <button
                onClick={() => setSettingsPanelOpen(false)}
                className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}
                aria-label="Close settings"
                data-testid="settings-close"
              >
                <X size={14} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
              {/* AI Model Settings */}
              <CollapsibleSection title="AI 모델 설정" defaultOpen data-testid="model-section">
                <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
                  각 디렉터 페르소나에 사용할 AI 모델을 선택하세요.
                  API 키가 없는 경우 Mock 응답을 사용합니다.
                </p>

                <div className="flex flex-col gap-3">
                  {SPEAKER_IDS.map((persona) => {
                    const meta = SPEAKER_CONFIG[persona]
                    const selectedModel = personaModels[persona]
                    const currentProvider = MODEL_OPTIONS.find((m) => m.id === selectedModel)?.provider ?? ''

                    return (
                      <div
                        key={persona}
                        className="flex items-center gap-3"
                        data-testid={`persona-row-${persona}`}
                      >
                        {/* Persona chip */}
                        <div
                          className="shrink-0 text-xs px-2 py-1 rounded font-mono"
                          style={{
                            background: meta.darkBg,
                            color: meta.color,
                            minWidth: 44,
                            textAlign: 'center',
                          }}
                        >
                          {meta.label}
                        </div>

                        {/* Model select */}
                        <div className="flex-1 relative">
                          <select
                            value={selectedModel}
                            onChange={(e) => setPersonaModel(persona as DirectorId, e.target.value)}
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
                                {models.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          {/* Dropdown arrow */}
                          <span
                            className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[10px]"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            ▾
                          </span>
                        </div>

                        {/* API key status */}
                        <EnvHint provider={currentProvider} />
                      </div>
                    )
                  })}
                </div>
              </CollapsibleSection>

              {/* Divider */}
              <div style={{ borderTop: '1px solid var(--color-border)', margin: '8px 0' }} />

              {/* Vault Settings */}
              <CollapsibleSection title="볼트 설정" defaultOpen data-testid="vault-section">
                <VaultSelector />
              </CollapsibleSection>

              {/* Divider */}
              <div style={{ borderTop: '1px solid var(--color-border)', margin: '8px 0' }} />

              {/* Debate Settings */}
              <CollapsibleSection title="⚔️ 토론 설정" data-testid="debate-section">
                <DebateSettingsContent />
              </CollapsibleSection>
            </div>

            {/* Footer */}
            <div
              className="px-4 py-3 shrink-0 flex items-center justify-between"
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
                className="text-xs px-3 py-1.5 rounded transition-colors"
                style={{
                  background: 'var(--color-accent)',
                  color: '#fff',
                }}
                data-testid="settings-save"
              >
                저장
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
