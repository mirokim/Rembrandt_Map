import { useState, useMemo, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { DocSection, SpeakerId } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { useSettingsStore } from '@/stores/settingsStore'
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

/** Strip wiki-link syntax to plain display text for fast mode */
function stripWikiLinks(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => {
    const parts = inner.split('|')
    return parts.length > 1 ? parts[1].trim() : parts[0].split('#')[0].trim()
  })
}

function ParagraphBlock({ section, speaker }: Props) {
  const [hovered, setHovered] = useState(false)
  const speakerColor = SPEAKER_CONFIG[speaker].color
  const paragraphRenderQuality = useSettingsStore(s => s.paragraphRenderQuality)

  const processedBody = useMemo(() => {
    if (paragraphRenderQuality === 'high') return preprocessWikiLinks(section.body)
    if (paragraphRenderQuality === 'fast') return stripWikiLinks(section.body)
    return section.body // medium: raw body, ReactMarkdown handles standard markdown
  }, [section.body, paragraphRenderQuality])

  const bodyContent = useMemo(() => {
    if (paragraphRenderQuality === 'fast') {
      return (
        <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
          {processedBody}
        </p>
      )
    }

    if (paragraphRenderQuality === 'medium') {
      return (
        <ReactMarkdown urlTransform={(url) => url}>
          {processedBody}
        </ReactMarkdown>
      )
    }

    // high: full markdown + interactive wiki-links
    return (
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
        {processedBody}
      </ReactMarkdown>
    )
  }, [processedBody, paragraphRenderQuality])

  const isFast = paragraphRenderQuality === 'fast'

  return (
    <div
      className="mb-6 pl-3"
      style={{
        borderLeft: hovered
          ? `2px solid ${speakerColor}`
          : '2px solid transparent',
        background: hovered
          ? `${speakerColor}0d` // ~5% opacity tint
          : 'transparent',
        transition: isFast ? undefined : 'background 0.15s, border-color 0.15s',
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
        {bodyContent}
      </div>
    </div>
  )
}

export default memo(ParagraphBlock)
