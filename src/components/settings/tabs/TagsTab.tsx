import { useState } from 'react'
import { Tag, Plus, X, Shuffle } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { getAutoPaletteColor } from '@/lib/nodeColors'

export default function TagsTab() {
  const { tagPresets, addTagPreset, removeTagPreset, tagColors, setTagColor } = useSettingsStore()
  const [input, setInput] = useState('')
  const [isAutoAssigning, setIsAutoAssigning] = useState(false)
  const [assignProgress, setAssignProgress] = useState(0)

  const handleAdd = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    addTagPreset(trimmed)
    // 기존에 색상이 지정되지 않은 경우에만 자동 팔레트 색상 배정
    if (!tagColors[trimmed]) setTagColor(trimmed, getAutoPaletteColor(trimmed))
    setInput('')
  }

  const handleAutoAssign = () => {
    if (isAutoAssigning) return
    setIsAutoAssigning(true)
    setAssignProgress(0)
    tagPresets.forEach(t => setTagColor(t, getAutoPaletteColor(t)))
    // 20ms 뒤 트랜지션 시작 (0% 렌더 후 100%로 이동)
    setTimeout(() => setAssignProgress(100), 20)
    setTimeout(() => setIsAutoAssigning(false), 700)
  }

  return (
    <div className="flex flex-col gap-7">

      {/* 태그 프리셋 */}
      <section>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Tag size={13} style={{ color: 'var(--color-text-muted)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>태그 프리셋</h3>
          {tagPresets.length > 0 && (
            <button
              onClick={handleAutoAssign}
              disabled={isAutoAssigning}
              title="모든 태그 색상을 자동 팔레트로 일괄 배정"
              className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors"
              style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                color: isAutoAssigning ? 'var(--color-accent)' : 'var(--color-text-muted)',
                cursor: isAutoAssigning ? 'default' : 'pointer',
                opacity: isAutoAssigning ? 0.7 : 1,
              }}
              onMouseEnter={e => { if (!isAutoAssigning) { e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' } }}
              onMouseLeave={e => { if (!isAutoAssigning) { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.borderColor = 'var(--color-border)' } }}
            >
              <Shuffle size={10} />
              {isAutoAssigning ? '배정 중…' : '자동 배정'}
            </button>
          )}
        </div>

        {/* 자동 배정 프로그레스 바 */}
        {isAutoAssigning && (
          <div style={{ height: 2, background: 'var(--color-bg-active)', borderRadius: 1, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{
              height: '100%',
              width: `${assignProgress}%`,
              background: 'var(--color-accent)',
              borderRadius: 1,
              transition: 'width 0.55s ease-out',
            }} />
          </div>
        )}

        <p className="text-[11px] mb-4" style={{ color: 'var(--color-text-muted)' }}>
          AI 태그 제안 시 이 목록에서만 선택합니다. 왼쪽 색상 점을 클릭해 그래프 노드 색상을 지정하세요.
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
            {tagPresets.map(tag => {
              const customColor = tagColors[tag]
              return (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 rounded"
                  style={{
                    fontSize: 12,
                    color: customColor ?? 'var(--color-accent)',
                    background: 'var(--color-bg-active)',
                    padding: '3px 8px 3px 6px',
                    border: `1px solid ${customColor ? customColor + '55' : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  {/* Color picker swatch */}
                  <label
                    title={`"${tag}" 노드 색상 변경`}
                    style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0 }}
                  >
                    <span style={{
                      width: 10, height: 10, borderRadius: 2, display: 'inline-block',
                      background: customColor ?? 'var(--color-accent)',
                      border: '1px solid rgba(255,255,255,0.3)',
                      boxShadow: customColor ? `0 0 4px ${customColor}66` : undefined,
                    }} />
                    <input
                      type="color"
                      value={customColor ?? '#60a5fa'}
                      onChange={e => setTagColor(tag, e.target.value)}
                      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', padding: 0, border: 'none' }}
                    />
                  </label>
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
              )
            })}
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
