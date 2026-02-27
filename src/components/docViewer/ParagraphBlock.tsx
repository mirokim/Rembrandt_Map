import { useState } from 'react'
import type { DocSection, SpeakerId } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { parseWikiLinks } from '@/lib/wikiLinkParser'
import WikiLink from './WikiLink'

interface Props {
  section: DocSection
  speaker: SpeakerId
}

export default function ParagraphBlock({ section, speaker }: Props) {
  const [hovered, setHovered] = useState(false)
  const speakerColor = SPEAKER_CONFIG[speaker].color
  const segments = parseWikiLinks(section.body)

  return (
    <div
      className="mb-6 pl-3 transition-all"
      style={{
        borderLeft: hovered
          ? `2px solid ${speakerColor}`
          : '2px solid transparent',
        background: hovered
          ? `${speakerColor}0d` // ~5% opacity tint
          : 'transparent',
        transition: 'background 0.15s, border-color 0.15s',
        borderRadius: '0 4px 4px 0',
        padding: '4px 0 4px 12px',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid={`paragraph-block-${section.id}`}
      data-hovered={hovered ? 'true' : undefined}
    >
      <h2
        className="text-xs font-semibold mb-2 uppercase tracking-wide"
        style={{ color: speakerColor, letterSpacing: '0.07em' }}
      >
        {section.heading}
      </h2>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        {segments.map((seg, i) =>
          seg.type === 'wikilink'
            ? <WikiLink key={i} slug={seg.slug} />
            : <span key={i}>{seg.value}</span>
        )}
      </p>
    </div>
  )
}
