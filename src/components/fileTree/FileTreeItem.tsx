import type { MockDocument } from '@/types'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import { FileText } from 'lucide-react'

interface FileTreeItemProps {
  doc: MockDocument
}

export default function FileTreeItem({ doc }: FileTreeItemProps) {
  const { selectedDocId, setSelectedDoc, setCenterTab } = useUIStore()
  const isSelected = selectedDocId === doc.id
  const speakerColor = SPEAKER_CONFIG[doc.speaker].color

  const handleClick = () => {
    setSelectedDoc(doc.id)
    setCenterTab('document')
  }

  // Display name: strip speaker prefix and extension
  const displayName = doc.filename
    .replace(/^(chief|art|plan|level|prog)_/, '')
    .replace(/\.md$/, '')
    .replace(/_/g, ' ')

  return (
    <button
      onClick={handleClick}
      data-doc-id={doc.id}
      className={cn(
        'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
        'hover:bg-[var(--color-bg-hover)]'
      )}
      style={{
        background: isSelected ? 'var(--color-bg-active)' : undefined,
        color: isSelected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        borderLeft: isSelected ? `2px solid ${speakerColor}` : '2px solid transparent',
      }}
      title={doc.filename}
      aria-current={isSelected ? 'page' : undefined}
    >
      <FileText size={11} style={{ color: speakerColor, flexShrink: 0 }} />
      <span className="truncate">{displayName}</span>
    </button>
  )
}
