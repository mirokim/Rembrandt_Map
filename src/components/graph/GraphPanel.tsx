import { useRef, useState, useEffect } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { Palette } from 'lucide-react'
import Graph2D from './Graph2D'
import Graph3D from './Graph3D'
import type { NodeColorMode } from '@/types'

const COLOR_MODES: { mode: NodeColorMode; label: string }[] = [
  { mode: 'document', label: '문서' },
  { mode: 'auto',     label: '자동' },
  { mode: 'speaker',  label: '역할' },
  { mode: 'folder',   label: '폴더' },
  { mode: 'tag',      label: '태그' },
  { mode: 'topic',    label: '주제' },
]

const floatBtnStyle: React.CSSProperties = {
  background: 'var(--color-bg-overlay)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 6,
  padding: '5px 7px',
  cursor: 'pointer',
  lineHeight: 1,
  transition: 'color 0.15s',
}

export default function GraphPanel() {
  const { graphMode, nodeColorMode, setNodeColorMode } = useUIStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [showColorPicker, setShowColorPicker] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setSize({ width: e.contentRect.width, height: e.contentRect.height })
      }
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="relative overflow-hidden h-full" data-testid="graph-panel">
      {size.width > 0 && size.height > 0 && (
        graphMode === '3d'
          ? <Graph3D width={size.width} height={size.height} />
          : <Graph2D width={size.width} height={size.height} />
      )}

      {/* Bottom-left buttons */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6 }}>
        {/* Color mode toggle */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowColorPicker(v => !v)}
            style={{
              ...floatBtnStyle,
              color: nodeColorMode !== 'speaker' ? 'var(--color-accent)' : 'var(--color-text-muted)',
            }}
            title={`노드 색상: ${COLOR_MODES.find(m => m.mode === nodeColorMode)?.label}`}
            aria-label="Node color mode"
          >
            <Palette size={12} />
          </button>

          {showColorPicker && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 6,
                background: 'var(--color-bg-overlay)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 80,
                zIndex: 50,
              }}
            >
              {COLOR_MODES.map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => { setNodeColorMode(mode); setShowColorPicker(false) }}
                  style={{
                    background: nodeColorMode === mode ? 'var(--color-bg-active)' : 'transparent',
                    color: nodeColorMode === mode ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    border: 'none',
                    borderRadius: 5,
                    padding: '5px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}별 색상
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
