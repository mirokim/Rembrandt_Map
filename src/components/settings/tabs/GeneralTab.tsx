import { Globe, Sun, Moon, Monitor, Zap } from 'lucide-react'
import { useSettingsStore, type AppTheme, type ParagraphRenderQuality } from '@/stores/settingsStore'
import VaultSelector from '../VaultSelector'

const THEMES: { id: AppTheme; label: string; Icon: React.ElementType }[] = [
  { id: 'light', label: '라이트',    Icon: Sun     },
  { id: 'dark',  label: '다크',      Icon: Moon    },
  { id: 'oled',  label: 'OLED 블랙', Icon: Monitor },
]

const PARAGRAPH_QUALITIES: { id: ParagraphRenderQuality; label: string; desc: string }[] = [
  { id: 'high',   label: '고품질', desc: '마크다운 + 위키링크' },
  { id: 'medium', label: '보통',   desc: '마크다운만' },
  { id: 'fast',   label: '빠름',   desc: '일반 텍스트' },
]

export default function GeneralTab() {
  const { theme, setTheme, editorDefaultLocked, setEditorDefaultLocked, paragraphRenderQuality, setParagraphRenderQuality } = useSettingsStore()

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
          {THEMES.map(({ id, label, Icon }) => {
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

      {/* 문서 뷰어 렌더링 */}
      <section>
        <div className="flex items-center gap-1.5 mb-3">
          <Zap size={13} style={{ color: 'var(--color-text-muted)' }} />
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>문서 렌더링 품질</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PARAGRAPH_QUALITIES.map(({ id, label, desc }) => {
            const active = paragraphRenderQuality === id
            return (
              <button
                key={id}
                onClick={() => setParagraphRenderQuality(id)}
                className="flex flex-col items-center gap-1.5 py-3 rounded-lg transition-colors"
                style={{
                  border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: active ? 'rgba(59,130,246,0.08)' : 'transparent',
                  color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
                }}
              >
                <span className="text-xs font-semibold">{label}</span>
                <span className="text-[10px] opacity-70">{desc}</span>
              </button>
            )
          })}
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
