import { SPEAKER_IDS } from '@/lib/speakerConfig'
import { useDocumentFilter } from '@/hooks/useDocumentFilter'
import SearchBar from './SearchBar'
import SpeakerGroup from './SpeakerGroup'
import type { SpeakerId } from '@/types'

export default function FileTree() {
  const { search, setSearch, filtered, grouped, totalCount, isVaultLoaded } =
    useDocumentFilter()

  // Determine which speaker groups to show:
  // - Always show the 5 named directors
  // - Optionally show 'unknown' if vault docs have no speaker
  const groupsToShow: SpeakerId[] = [...SPEAKER_IDS]
  if (grouped['unknown' as SpeakerId]?.length) {
    groupsToShow.push('unknown' as SpeakerId)
  }

  return (
    <div className="flex flex-col h-full" data-testid="file-tree">
      {/* Header */}
      <div
        className="px-3 py-2 text-[10px] font-semibold tracking-widest uppercase shrink-0"
        style={{ color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}
      >
        {isVaultLoaded ? 'Vault' : 'Knowledge Base'}
      </div>

      <SearchBar value={search} onChange={setSearch} />

      {/* Document groups */}
      <div className="flex-1 overflow-y-auto py-1">
        {groupsToShow.map(id => (
          <SpeakerGroup
            key={id}
            speakerId={id}
            docs={grouped[id] ?? []}
          />
        ))}

        {filtered.length === 0 && (
          <div
            className="px-4 py-6 text-xs text-center"
            style={{ color: 'var(--color-text-muted)' }}
          >
            검색 결과 없음
          </div>
        )}
      </div>

      {/* Footer — uses totalCount from hook (not hardcoded MOCK_DOCUMENTS.length) */}
      <div
        className="px-3 py-2 text-[10px] shrink-0"
        style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}
      >
        {filtered.length} / {totalCount} 문서
      </div>
    </div>
  )
}
