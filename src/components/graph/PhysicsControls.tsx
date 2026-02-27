import { useGraphStore, DEFAULT_PHYSICS, PHYSICS_BOUNDS } from '@/stores/graphStore'
import { RotateCcw } from 'lucide-react'

interface SliderDef {
  key: keyof typeof DEFAULT_PHYSICS
  label: string
  min: number
  max: number
  step: number
}

const SLIDERS: SliderDef[] = [
  { key: 'centerForce', label: 'Center', min: 0, max: 1, step: 0.01 },
  { key: 'charge', label: 'Repulsion', min: -1000, max: 0, step: 10 },
  { key: 'linkStrength', label: 'Link', min: 0, max: 2, step: 0.01 },
  { key: 'linkDistance', label: 'Distance', min: 20, max: 300, step: 5 },
]

export default function PhysicsControls() {
  const { physics, updatePhysics, resetPhysics } = useGraphStore()

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        padding: '10px 12px',
        minWidth: 180,
        backdropFilter: 'blur(4px)',
      }}
      aria-label="Physics controls"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--color-text-muted)' }}>
          Physics
        </span>
        <button
          onClick={resetPhysics}
          title="Reset physics"
          aria-label="Reset physics"
          className="hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <RotateCcw size={11} />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {SLIDERS.map(({ key, label, min, max, step }) => (
          <div key={key} className="flex items-center gap-2">
            <label
              className="text-[10px] w-14 shrink-0"
              style={{ color: 'var(--color-text-secondary)' }}
              htmlFor={`slider-${key}`}
            >
              {label}
            </label>
            <input
              id={`slider-${key}`}
              type="range"
              min={min}
              max={max}
              step={step}
              value={physics[key]}
              onChange={e => updatePhysics({ [key]: Number(e.target.value) })}
              className="flex-1"
              aria-label={label}
            />
            <span className="text-[10px] w-10 text-right" style={{ color: 'var(--color-text-muted)' }}>
              {key === 'charge'
                ? physics[key].toFixed(0)
                : physics[key].toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
