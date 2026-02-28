import { useState } from 'react'
import { Plus, Trash } from 'lucide-react'
import { useSettingsStore, type ColorRule } from '@/stores/settingsStore'
import { fieldInputStyle } from '../settingsShared'

export default function ColorsTab() {
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
