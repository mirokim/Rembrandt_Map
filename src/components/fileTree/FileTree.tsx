import { useState, useCallback } from 'react'
import {
  SortAsc, SortDesc, ChevronsUpDown, ChevronsDownUp,
  Clock, Type, FilePlus,
} from 'lucide-react'
import { SPEAKER_IDS } from '@/lib/speakerConfig'
import { useDocumentFilter } from '@/hooks/useDocumentFilter'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { useUIStore } from '@/stores/uiStore'
import { parseVaultFiles } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
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
  const { setNodes, setLinks } = useGraphStore()
  const { openInEditor, editingDocId } = useUIStore()

  const rebuildGraph = useCallback((docs: LoadedDocument[]) => {
    const { nodes, links } = buildGraph(docs)
    setNodes(nodes)
    setLinks(links)
  }, [setNodes, setLinks])

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
    if (newFilename === filename) return

    // 이름 변경 전에 현재 편집 중인 파일인지 확인
    const oldDoc = loadedDocuments?.find(d => (d as LoadedDocument).absolutePath === absolutePath)
    const wasEditing = Boolean(oldDoc && editingDocId === oldDoc.id)

    try {
      await window.vaultAPI?.renameFile(absolutePath, newFilename)
      if (vaultPath && window.vaultAPI) {
        const files = await window.vaultAPI.loadFiles(vaultPath)
        if (files) {
          const docs = parseVaultFiles(files) as LoadedDocument[]
          setLoadedDocuments(docs)
          rebuildGraph(docs)

          // 편집 중이던 파일이면 새 ID로 에디터 업데이트
          if (wasEditing) {
            const sep = absolutePath.includes('\\') ? '\\' : '/'
            const dir = absolutePath.replace(/[\\/][^\\/]+$/, '')
            const newAbsPath = `${dir}${sep}${newFilename}`
            const newDoc = docs.find(d =>
              d.absolutePath.replace(/\\/g, '/') === newAbsPath.replace(/\\/g, '/')
            )
            if (newDoc) openInEditor(newDoc.id)
          }
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
      if (vaultPath && window.vaultAPI) {
        const files = await window.vaultAPI.loadFiles(vaultPath)
        const docs = (files ? parseVaultFiles(files) : []) as LoadedDocument[]
        setLoadedDocuments(docs)
        rebuildGraph(docs)
      }
    } catch (e) {
      console.error('[FileTree] delete failed:', e)
    }
  }

  const handleNewDocument = async () => {
    if (!vaultPath || !window.vaultAPI) return
    const sep = vaultPath.includes('\\') ? '\\' : '/'
    // Find a unique filename: 무제.md, 무제 2.md, 무제 3.md ...
    const existing = new Set(
      (loadedDocuments ?? []).map(d => (d as LoadedDocument).absolutePath.replace(/\\/g, '/'))
    )
    let name = '무제'
    let counter = 1
    let newPath = `${vaultPath}${sep}${name}.md`
    while (existing.has(newPath.replace(/\\/g, '/'))) {
      counter++
      name = `무제 ${counter}`
      newPath = `${vaultPath}${sep}${name}.md`
    }
    try {
      await window.vaultAPI.saveFile(newPath, `# ${name}\n\n`)
      const files = await window.vaultAPI.loadFiles(vaultPath)
      if (files) {
        const docs = parseVaultFiles(files) as LoadedDocument[]
        setLoadedDocuments(docs)
        rebuildGraph(docs)
        const newDoc = docs.find(d =>
          d.absolutePath.replace(/\\/g, '/') === newPath.replace(/\\/g, '/')
        )
        if (newDoc) openInEditor(newDoc.id)
      }
    } catch (e) {
      console.error('[FileTree] new document failed:', e)
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
        <button
          style={iconBtn(sortBy === 'name')}
          title={`이름순${sortBy === 'name' ? (sortDir === 'asc' ? ' (오름차순)' : ' (내림차순)') : ''}`}
          onClick={() => sortBy === 'name' ? toggleSortDir() : setSortBy('name')}
        >
          {sortBy === 'name'
            ? (sortDir === 'asc' ? <SortAsc size={11} /> : <SortDesc size={11} />)
            : <Type size={11} />}
        </button>

        <button
          style={iconBtn(sortBy === 'date')}
          title={`수정일순${sortBy === 'date' ? (sortDir === 'asc' ? ' (오름차순)' : ' (내림차순)') : ''}`}
          onClick={() => sortBy === 'date' ? toggleSortDir() : setSortBy('date')}
        >
          {sortBy === 'date'
            ? (sortDir === 'asc' ? <SortAsc size={11} /> : <SortDesc size={11} />)
            : <Clock size={11} />}
        </button>

        <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 2px' }} />

        <button style={iconBtn()} title="모두 펼치기" onClick={handleExpandAll}>
          <ChevronsUpDown size={11} />
        </button>

        <button style={iconBtn()} title="모두 접기" onClick={handleCollapseAll}>
          <ChevronsDownUp size={11} />
        </button>

        <div style={{ width: 1, height: 14, background: 'var(--color-border)', margin: '0 2px' }} />

        <button
          style={iconBtn()}
          title={vaultPath ? '새 문서 만들기' : '볼트를 먼저 선택하세요'}
          onClick={handleNewDocument}
          disabled={!vaultPath}
        >
          <FilePlus size={11} />
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
