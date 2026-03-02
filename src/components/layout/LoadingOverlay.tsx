import { useEffect, useRef, useState } from 'react'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { useSettingsStore, type ParagraphRenderQuality } from '@/stores/settingsStore'

// Satellite positions: 6 dots in a hexagon
const SATELLITES = [0, 60, 120, 180, 240, 300].map((deg, i) => {
  const rad = (deg * Math.PI) / 180
  return { x: Math.round(Math.cos(rad) * 22), y: Math.round(Math.sin(rad) * 22), delay: i * 0.28 }
})

const QUALITY_OPTIONS: { value: ParagraphRenderQuality; label: string; desc: string }[] = [
  { value: 'high',   label: '최고',  desc: '마크다운 + 위키링크 렌더링' },
  { value: 'medium', label: '중간',  desc: '마크다운만 렌더링' },
  { value: 'fast',   label: '빠름',  desc: '일반 텍스트 (가장 빠름)' },
]

// 퍼포먼스 선택창 노출 조건
// - 파일 100개 이상 (어떤 품질 모드든 눈에 띄는 속도 차이가 있는 규모)
// - 또는 high 모드에서 50개 이상 (high가 특히 무거움)
function shouldShowPerfSelector(fileCount: number | null, quality: ParagraphRenderQuality): boolean {
  if (fileCount === null) return false
  if (fileCount >= 100) return true
  if (quality === 'high' && fileCount >= 50) return true
  return false
}

export default function LoadingOverlay() {
  const { isLoading, vaultPath, vaultReady, loadingProgress, loadingPhase, pendingFileCount } = useVaultStore()
  const graphLayoutReady = useGraphStore(s => s.graphLayoutReady)
  const { paragraphRenderQuality, setParagraphRenderQuality } = useSettingsStore()

  // Stay visible until: vault parsed + graph simulation settled + fit-to-view applied
  const shouldShow = isLoading
    || (vaultPath !== null && !vaultReady)
    || (vaultReady && vaultPath !== null && !graphLayoutReady)

  const [visible, setVisible] = useState(shouldShow)
  const [fading, setFading] = useState(false)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (shouldShow) {
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
      setFading(false)
      setVisible(true)
    } else if (visible) {
      setFading(true)
      fadeTimer.current = setTimeout(() => {
        setVisible(false)
        setFading(false)
      }, 700)
    }
    return () => { if (fadeTimer.current) clearTimeout(fadeTimer.current) }
  }, [shouldShow, visible])

  if (!visible) return null

  const displayPhase = loadingPhase || '볼트 로딩 중...'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg-primary)',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.7s ease',
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      {/* ── Graph-dot animation ── */}
      <div style={{ marginBottom: 32 }}>
        <svg width="64" height="64" viewBox="-32 -32 64 64" overflow="visible">
          {/* Lines from center to each satellite */}
          {SATELLITES.map((s, i) => (
            <line
              key={`line-${i}`}
              x1="0" y1="0"
              x2={s.x} y2={s.y}
              stroke="var(--color-text-secondary)"
              strokeWidth="1"
            >
              <animate
                attributeName="opacity"
                values="0;0.35;0.35;0"
                dur="1.7s"
                begin={`${s.delay}s`}
                repeatCount="indefinite"
              />
            </line>
          ))}

          {/* Satellite dots — appear and fade with staggered delay */}
          {SATELLITES.map((s, i) => (
            <circle
              key={`sat-${i}`}
              cx={s.x} cy={s.y}
              r="0"
              fill="var(--color-text-muted)"
            >
              <animate
                attributeName="r"
                values="0;3;3;0"
                dur="1.7s"
                begin={`${s.delay}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0;0.9;0.9;0"
                dur="1.7s"
                begin={`${s.delay}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}

          {/* Center dot — continuous pulse */}
          <circle cx="0" cy="0" fill="var(--color-accent, #60a5fa)" r="6">
            <animate attributeName="r"       values="5;7.5;5"     dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0.45;0.9" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>

      {/* ── Info block ── */}
      <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            color: 'var(--color-text-primary)',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '0.04em',
            opacity: 0.85,
          }}
        >
          Rembrandt Map
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              background: 'var(--color-accent, #60a5fa)',
              width: `${loadingProgress}%`,
              borderRadius: 2,
              transition: 'width 0.25s ease',
            }}
          />
        </div>

        {/* Phase label + percentage */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            opacity: 0.65,
          }}
        >
          <span>{displayPhase}</span>
          {loadingProgress > 0 && <span>{loadingProgress}%</span>}
        </div>

        {/* 퍼포먼스 선택 — 파일 수가 많을 때 노출 */}
        {shouldShowPerfSelector(pendingFileCount, paragraphRenderQuality) && (
          <div
            style={{
              marginTop: 8,
              padding: '10px 12px',
              background: 'var(--color-bg-overlay)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: 'var(--color-text-muted)',
                marginBottom: 8,
                letterSpacing: '0.05em',
              }}
            >
              {pendingFileCount}개 파일 감지됨 — 렌더링 품질 선택
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {QUALITY_OPTIONS.map(({ value, label, desc }) => {
                const isActive = paragraphRenderQuality === value
                return (
                  <button
                    key={value}
                    onClick={() => setParagraphRenderQuality(value)}
                    title={desc}
                    style={{
                      flex: 1,
                      padding: '5px 4px',
                      borderRadius: 5,
                      border: isActive
                        ? '1px solid var(--color-accent, #60a5fa)'
                        : '1px solid var(--color-border)',
                      background: isActive
                        ? 'rgba(96,165,250,0.12)'
                        : 'var(--color-bg-surface)',
                      color: isActive
                        ? 'var(--color-accent, #60a5fa)'
                        : 'var(--color-text-secondary)',
                      fontSize: 11,
                      fontWeight: isActive ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
