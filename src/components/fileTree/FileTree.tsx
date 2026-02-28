import { useState, useCallback } from 'react'
import {
  SortAsc, SortDesc, ChevronsUpDown, ChevronsDownUp,
  Clock, Type,
} from 'lucide-react'
import { SPEAKER_IDS } from '@/lib/speakerConfig'
import { useDocumentFilter } from '@/hooks/useDocumentFilter'
import { useVaultStore } from '@/stores/vaultStore'
import { useUIStore } from '@/stores/uiStore'
import { parseVaultFiles } from '@/lib/markdownParser'
import SearchBar from './SearchBar'
import SpeakerGroup from './SpeakerGroup'
import FolderGroup from './FolderGroup'
import ContextMenu from './ContextMenu'
import type { SpeakerId, LoadedDocument } from '@/types'
import type { ContextMenuState } from './ContextMenu'

export default function FileTree() {
  const {
    search, setSearch,
    sortBy, setSortBy,
    sortDir, toggleSortDir,
    filtered, grouped, folderGroups, totalCount, isVaultLoaded,
  } = useDocumentFilter()

  const { vaultPath, loadedDocuments, setLoadedDocuments } = useVaultStore()
  const { openInEditor } = useUIStore()

  // Expand/collapse all state: null = each folder uses its own local state
  const [expandOverride, setExpandOverride] = useState<boolean | null>(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const handleExpandAll = () => setExpandOverride(true)
  const handleCollapseAll = () => setExpandOverride(false)
  // After an individual group is toggled, clear the override so each group owns its state again
  const handleGroupToggle = useCallback(() => {
    if (expandOverride !== null) setExpandOverride(null)
  }, [expandOverride])

  const groupsToShow: SpeakerId[] = [...SPEAKER_IDS]
  if (grouped['unknown' as SpeakerId]?.length) {
    groupsToShow.push('unknown' as SpeakerId)
  }

  // ── Context menu actions ───────────────────────────────────────────────────

  const handleOpenInEditor = (docId: string) => openInEditor(docId)

  const handleCreateCopy = async (absolutePath: string, filename: string) => {
    if (!window.vaultAPI) return
    const ext = filename.endsWith('.md') ? '.md' : ''
    const base = filename.replace(/\.md$/i, '')
    const copyFilename = `${base} copy${ext}`
    const dir = absolutePath.replace(/[\\/][^\\/]+$/, '')
    const sep = absolutePath.includes('\\') ? '\\' : '/'
    const destPath = `${dir}${sep}${copyFilename}`
    try {
      const content = loadedDocuments?.find(d =>
        (d as LoadedDocument).absolutePath === absolutePath
      )?.rawContent ?? ''
      await window.vaultAPI.saveFile(destPath, content)
    } catch (e) {
      console.error('[FileTree] createCopy failed:', e)
    }
  }

  const handleBookmark = (docId: string) => {
    // TODO: persist bookmarks in a store
    console.log('[FileTree] bookmark:', docId)
  }

  const handleRename = async (absolutePath: string, filename: string) => {
    const newName = window.prompt('새 파일 이름:', filename.replace(/\.md$/i, ''))
    if (!newName || newName.trim() === '') return
    const newFilename = newName.trim().endsWith('.md')
      ? newName.trim()
      : `${newName.trim()}.md`
    try {
      await window.vaultAPI?.renameFile(absolutePath, newFilename)
      // Reload vault to reflect changes
      if (vaultPath && window.vaultAPI) {
        const files = await window.vaultAPI.loadFiles(vaultPath)
        if (files) {
          const docs = parseVaultFiles(files)
          setLoadedDocuments(docs as LoadedDocument[])
        }
      }
    } catch (e) {
      console.error('[FileTree] rename failed:', e)
    }
  }

  const handleDelete = async (absolutePath: string, filename: string) => {
    const confirmed = window.confirm(`"${filename}" 을(를) 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)
    if (!confirmed) return
    try {
      await window.vaultAPI?.deleteFile(absolutePath)
      // Reload vault
      if (vaultPath && window.vaultAPI) {
        const files = await window.vaultAPI.loadFiles(vaultPath)
        const docs = files ? parseVaultFiles(files) : []
        setLoadedDocuments(docs as LoadedDocument[])
      }
    } catch (e) {
      console.error('[FileTree] delete failed:', e)
    }
  }

  // ── Icon button style ──────────────────────────────────────────────────────
  const iconBtn = (active = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    border: 'none',
    background: active ? 'var(--color-bg-active)' : 'transparent',
    borderRadius: 4,
    color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.1s, color 0.1s',
  })

  return (
    <div className="flex flex-col h-full" data-testid="file-tree">

      {/* ── Toolbar ── */}
      <div
        style={{
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: '0 4px',
          minHeight: 34,
          flexShrink: 0,
          justifyContent: 'center',
        }}
      >
        <button style={iconBtn(sortBy === 'name')} title="이름순 정렬" onClick={() => setSortBy('name')}>
          <Type size={11} />
        </button>

        <button style={iconBtn(sortBy === 'date')} title="수정일순 정렬" onClick={() => setSortBy('date')}>
          <Clock size={11} />
        </button>

        <button
          style={iconBtn()}
          title={sortDir === 'asc' ? '오름차순 → 내림차순' : '내림차순 → 오름차순'}
          onClick={toggleSortDir}
        >
          {sortDir === 'asc' ? <SortAsc size={11} /> : <SortDesc size={11} />}
        </button>

        <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 2px' }} />

        <button style={iconBtn()} title="모두 펼치기" onClick={handleExpandAll}>
          <ChevronsUpDown size={11} />
        </button>

        <button style={iconBtn()} title="모두 접기" onClick={handleCollapseAll}>
          <ChevronsDownUp size={11} />
        </button>
      </div>

      <SearchBar value={search} onChange={setSearch} />

      {/* ── Document groups ── */}
      <div className="flex-1 overflow-y-auto py-1" onClick={handleGroupToggle}>
        {isVaultLoaded
          ? folderGroups.map(fg => (
              <FolderGroup
                key={fg.folderPath}
                folderPath={fg.folderPath}
                docs={fg.docs}
                isOpenOverride={expandOverride}
                onContextMenu={setContextMenu}
              />
            ))
          : groupsToShow.map(id => (
              <SpeakerGroup
                key={id}
                speakerId={id}
                docs={grouped[id] ?? []}
                isOpenOverride={expandOverride}
                onContextMenu={setContextMenu}
              />
            ))
        }

        {filtered.length === 0 && (
          <div className="px-4 py-6 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
            검색 결과 없음
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div
        className="px-3 py-2 text-[10px] shrink-0"
        style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}
      >
        {filtered.length} / {totalCount} 문서
      </div>

      {/* ── Context menu (portal to document.body) ── */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpenInEditor={handleOpenInEditor}
          onCreateCopy={handleCreateCopy}
          onBookmark={handleBookmark}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
