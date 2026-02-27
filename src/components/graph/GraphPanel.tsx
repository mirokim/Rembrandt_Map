import { useRef, useState, useEffect } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { Settings } from 'lucide-react'
import Graph2D from './Graph2D'
import Graph3D from './Graph3D'
import PhysicsControls from './PhysicsControls'

export default function GraphPanel() {
  const { graphMode } = useUIStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [showPhysics, setShowPhysics] = useState(false)

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

      {/* Physics toggle button — bottom-left corner */}
      <button
        onClick={() => setShowPhysics(v => !v)}
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          background: 'var(--color-bg-overlay)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 6,
          padding: '5px 7px',
          color: showPhysics ? 'var(--color-accent)' : 'var(--color-text-muted)',
          cursor: 'pointer',
          lineHeight: 1,
          transition: 'color 0.15s',
        }}
        title="Physics controls"
        aria-label="Toggle physics controls"
        data-testid="physics-toggle"
      >
        <Settings size={12} />
      </button>

      {/* Physics panel — hidden by default, shown on toggle */}
      {showPhysics && <PhysicsControls />}
    </div>
  )
}
