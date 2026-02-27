import { useChatStore } from '@/stores/chatStore'
import { SPEAKER_CONFIG, SPEAKER_IDS } from '@/lib/speakerConfig'
import { cn } from '@/lib/utils'

export default function PersonaChips() {
  const { activePersonas, togglePersona } = useChatStore()

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="persona-chips">
      {SPEAKER_IDS.map(id => {
        const { label, color, darkBg } = SPEAKER_CONFIG[id]
        const active = activePersonas.includes(id)
        return (
          <button
            key={id}
            onClick={() => togglePersona(id)}
            data-testid={`persona-chip-${id}`}
            data-active={active ? 'true' : undefined}
            className={cn(
              'text-xs px-2.5 py-1 rounded-full transition-all',
              'border hover:opacity-90'
            )}
            style={{
              borderColor: color,
              color: active ? '#fff' : color,
              background: active ? color : darkBg,
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
