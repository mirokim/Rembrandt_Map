import { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { DocSection, SpeakerId } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import WikiLink from './WikiLink'

interface Props {
  section: DocSection
  speaker: SpeakerId
}

/** Convert [[slug]], [[target|display]], [[target#heading]] to markdown links */
function preprocessWikiLinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
    const parts = inner.split('|')
    const rawTarget = parts[0].trim()
    // Strip heading anchor for node resolution; keep alias or full ref for display
    const target = rawTarget.split('#')[0].trim()
    const display = parts.length > 1 ? parts[1].trim() : rawTarget
    // Use fragment URL (#wikilink-...) — react-markdown allows fragments without sanitization
    return `[${display}](#wikilink-${encodeURIComponent(target)})`
  })
}

export default function ParagraphBlock({ section, speaker }: Props) {
  const [hovered, setHovered] = useState(false)
  const speakerColor = SPEAKER_CONFIG[speaker].color

  const markdownBody = useMemo(
    () => preprocessWikiLinks(section.body),
    [section.body]
  )

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
      <div
        className="text-sm leading-relaxed prose-vault"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        <ReactMarkdown
          urlTransform={(url) => url}
          components={{
            a({ href, children }) {
              if (href?.startsWith('#wikilink-')) {
                const slug = decodeURIComponent(href.slice('#wikilink-'.length))
                return <WikiLink slug={slug} />
              }
              return (
                <a href={href} target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}
                >
                  {children}
                </a>
              )
            },
          }}
        >
          {markdownBody}
        </ReactMarkdown>
      </div>
    </div>
  )
}
