import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, Folder } from 'lucide-react'
import type { MockDocument, LoadedDocument } from '@/types'
import FileTreeItem from './FileTreeItem'
import type { ContextMenuState } from './ContextMenu'

interface FolderGroupProps {
  folderPath: string
  docs: MockDocument[]
  /** null/undefined = local state; true/false = controlled open state */
  isOpenOverride?: boolean | null
  onContextMenu?: (state: ContextMenuState) => void
}

export default function FolderGroup({
  folderPath,
  docs,
  isOpenOverride,
  onContextMenu,
}: FolderGroupProps) {
  const [localOpen, setLocalOpen] = useState(true)

  // Sync local state when override changes
  useEffect(() => {
    if (isOpenOverride !== null && isOpenOverride !== undefined) {
      setLocalOpen(isOpenOverride)
    }
  }, [isOpenOverride])

  const isOpen = (isOpenOverride !== null && isOpenOverride !== undefined)
    ? isOpenOverride
    : localOpen

  if (docs.length === 0) return null

  const displayName = folderPath || '/'

  return (
    <div>
      <button
        onClick={() => setLocalOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-bg-hover)]"
        style={{ color: 'var(--color-text-primary)' }}
        aria-expanded={isOpen}
        data-folder={folderPath}
      >
        <span
          className="flex items-center justify-center w-4 h-4 rounded"
          style={{ background: 'var(--color-bg-active)' }}
        >
          <Folder size={9} style={{ color: 'var(--color-accent)' }} />
        </span>

        <span className="flex-1 text-left text-[11px]">{displayName}</span>

        <span style={{ color: 'var(--color-text-muted)' }} className="text-[10px]">
          {docs.length}
        </span>

        {isOpen
          ? <ChevronDown size={11} style={{ color: 'var(--color-text-muted)' }} />
          : <ChevronRight size={11} style={{ color: 'var(--color-text-muted)' }} />
        }
      </button>

      {isOpen && (
        <div>
          {docs.map(doc => (
            <FileTreeItem key={(doc as LoadedDocument).absolutePath ?? doc.id} doc={doc} onContextMenu={onContextMenu} />
          ))}
        </div>
      )}
    </div>
  )
}
