import { useSettingsStore } from '@/stores/settingsStore'
import { fieldInputStyle, fieldLabelStyle } from '../settingsShared'

export default function ProjectTab() {
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
