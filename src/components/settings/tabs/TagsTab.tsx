import { useState } from 'react'
import { Tag, Plus, X } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'

export default function TagsTab() {
  const { tagPresets, addTagPreset, removeTagPreset } = useSettingsStore()
  const [input, setInput] = useState('')

  const handleAdd = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    addTagPreset(trimmed)
    setInput('')
  }

  return (
    <div className="flex flex-col gap-7">

      {/* 태그 프리셋 */}
      <section>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Tag size={13} style={{ color: 'var(--color-text-muted)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>태그 프리셋</h3>
        </div>
        <p className="text-[11px] mb-4" style={{ color: 'var(--color-text-muted)' }}>
          AI 태그 제안 시 이 목록에서만 선택합니다. 확신이 없으면 빈 태그로 남깁니다.
        </p>

        {/* 현재 프리셋 목록 */}
        {tagPresets.length === 0 ? (
          <div
            className="flex items-center justify-center py-6 rounded-lg mb-4"
            style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-muted)', fontSize: 12 }}
          >
            아직 태그 프리셋이 없습니다
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 mb-4">
            {tagPresets.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-1.5 rounded"
                style={{
                  fontSize: 12,
                  color: 'var(--color-accent)',
                  background: 'var(--color-bg-active)',
                  padding: '3px 8px 3px 10px',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                #{tag}
                <button
                  onClick={() => removeTagPreset(tag)}
                  title={`"${tag}" 제거`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 추가 입력 */}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
            placeholder="새 태그 이름 입력"
            className="flex-1 px-3 py-2 rounded-lg text-xs outline-none"
            style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
          />
          <button
            onClick={handleAdd}
            disabled={!input.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-colors"
            style={{
              background: input.trim() ? 'var(--color-accent)' : 'var(--color-bg-surface)',
              color: input.trim() ? '#fff' : 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
              cursor: input.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            <Plus size={12} />
            추가
          </button>
        </div>
      </section>

    </div>
  )
}
