import { useMemo } from 'react'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import type { SpeakerId } from '@/types'

// ── 작은 수평 바 ────────────────────────────────────────────────────────────

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 2, width: '100%' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
    </div>
  )
}

// ── 요약 카드 ────────────────────────────────────────────────────────────────

function Card({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{
      background: 'var(--color-bg-active)',
      border: '1px solid var(--color-border)',
      borderRadius: 8,
      padding: '10px 14px',
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.6, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── 섹션 제목 ─────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--color-text-secondary)',
      textTransform: 'uppercase',
      letterSpacing: '0.07em',
      marginBottom: 8,
    }}>
      {children}
    </p>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function StatsTab() {
  const docs = useVaultStore(s => s.loadedDocuments)
  const vaultPath = useVaultStore(s => s.vaultPath)
  const { nodes, links } = useGraphStore()

  const stats = useMemo(() => {
    if (!docs || docs.length === 0) return null

    // Speaker 분포
    const speakerCounts: Record<string, number> = {}
    for (const d of docs) {
      speakerCounts[d.speaker] = (speakerCounts[d.speaker] ?? 0) + 1
    }

    // 태그 집계
    const tagMap: Record<string, number> = {}
    for (const d of docs) {
      for (const t of d.tags) tagMap[t] = (tagMap[t] ?? 0) + 1
    }
    const topTags = Object.entries(tagMap).sort((a, b) => b[1] - a[1]).slice(0, 10)

    // 링크 집계
    const linkCounts = docs.map(d => d.links.length)
    const totalLinks = linkCounts.reduce((a, b) => a + b, 0)
    const avgLinks = docs.length > 0 ? (totalLinks / docs.length).toFixed(1) : '0'
    const orphanCount = docs.filter(d => d.links.length === 0).length
    const topLinked = [...docs].sort((a, b) => b.links.length - a.links.length).slice(0, 8)

    // 날짜 범위
    const dates = docs.map(d => d.date).filter(Boolean).sort()
    const dateRange = dates.length >= 2 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : dates[0] ?? '-'

    // 이미지 refs
    const totalImages = docs.reduce((acc, d) => acc + (d.imageRefs?.length ?? 0), 0)

    // 총 단어 (rawContent 합산)
    const totalChars = docs.reduce((acc, d) => acc + (d.rawContent?.length ?? 0), 0)
    const charLabel = totalChars > 1000
      ? `${(totalChars / 1000).toFixed(1)}K`
      : String(totalChars)

    return {
      docCount: docs.length,
      nodeCount: nodes.length,
      linkCount: links.length,
      speakerCounts,
      topTags,
      totalTagTypes: Object.keys(tagMap).length,
      avgLinks,
      orphanCount,
      topLinked,
      dateRange,
      totalImages,
      charLabel,
    }
  }, [docs, nodes, links])

  if (!vaultPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
        <span style={{ fontSize: 28, opacity: 0.2 }}>📂</span>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>볼트를 먼저 로드하세요</p>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
        <span style={{ fontSize: 28, opacity: 0.2 }}>📊</span>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>문서가 없습니다</p>
      </div>
    )
  }

  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    fontSize: 11,
    gap: 8,
  }

  return (
    <div className="flex flex-col gap-6">

      {/* 요약 카드 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Card label="총 문서" value={stats.docCount} />
        <Card label="노드" value={stats.nodeCount} />
        <Card label="와이어" value={stats.linkCount} />
        <Card label="이미지 참조" value={stats.totalImages} />
        <Card label="총 글자" value={stats.charLabel} />
      </div>

      {/* 날짜 · 링크 개요 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <SectionTitle>개요</SectionTitle>
        {[
          ['날짜 범위', stats.dateRange],
          ['평균 링크 수', `${stats.avgLinks} / 문서`],
          ['고립 문서 (링크 없음)', `${stats.orphanCount}개`],
          ['고유 태그 수', `${stats.totalTagTypes}개`],
        ].map(([k, v]) => (
          <div key={k} style={row}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{k}</span>
            <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{v}</span>
          </div>
        ))}
      </div>

      {/* 스피커 분포 */}
      <div>
        <SectionTitle>스피커 분포</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(stats.speakerCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([speaker, count]) => {
              const meta = SPEAKER_CONFIG[speaker as SpeakerId]
              return (
                <div key={speaker} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 10,
                    color: meta?.color ?? '#888',
                    minWidth: 46,
                    fontWeight: 600,
                  }}>
                    {meta?.label ?? speaker}
                  </span>
                  <div style={{ flex: 1 }}>
                    <MiniBar value={count} max={stats.docCount} color={meta?.color ?? '#888'} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)', minWidth: 30, textAlign: 'right' }}>
                    {count}
                  </span>
                </div>
              )
            })}
        </div>
      </div>

      {/* 상위 연결 문서 */}
      <div>
        <SectionTitle>상위 연결 문서</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {stats.topLinked.map((doc, i) => (
            <div key={doc.id} style={row}>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 10, minWidth: 16 }}>{i + 1}</span>
              <span style={{ color: 'var(--color-text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {doc.filename}
              </span>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600, minWidth: 30, textAlign: 'right' }}>
                {doc.links.length}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 상위 태그 */}
      {stats.topTags.length > 0 && (
        <div>
          <SectionTitle>상위 태그</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {stats.topTags.map(([tag, count]) => (
              <span
                key={tag}
                style={{
                  fontSize: 10,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: 'var(--color-bg-active)',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {tag} <span style={{ opacity: 0.6 }}>{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
