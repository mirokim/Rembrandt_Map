/**
 * VaultSelector.tsx — Phase 6
 *
 * Settings panel section for vault file management:
 * - Select vault folder via Electron dialog
 * - Auto-reload on change (fs.watch)
 * - Reload and Clear buttons
 * - Shows document count and indexing status
 */

import { useEffect, useCallback, useRef } from 'react'
import { FolderOpen, RefreshCw, X, Loader2, AlertCircle } from 'lucide-react'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { useBackendStore } from '@/stores/backendStore'
import { parseVaultFiles } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
import { vaultDocsToChunks } from '@/lib/vaultToChunks'

// ── Hook: vault loading logic ─────────────────────────────────────────────────

function useVaultLoader() {
  const { vaultPath, setLoadedDocuments, setIsLoading, setError, setVaultPath } =
    useVaultStore()
  const { setNodes, setLinks, resetToMock } = useGraphStore()
  const { setIndexing, setChunkCount, setError: setBackendError } = useBackendStore()

  const loadVault = useCallback(
    async (dirPath: string) => {
      if (!window.vaultAPI) return
      setIsLoading(true)
      setError(null)
      try {
        const files = await window.vaultAPI.loadFiles(dirPath)
        const docs = parseVaultFiles(files)
        setLoadedDocuments(docs)

        // Update graph
        const { nodes, links } = buildGraph(docs)
        setNodes(nodes)
        setLinks(links)

        // Index into backend if available
        if (window.backendAPI && docs.length > 0) {
          const chunks = vaultDocsToChunks(docs)
          setIndexing(true)
          window.backendAPI
            .indexDocuments(chunks)
            .then(({ indexed }) => setChunkCount(indexed))
            .catch((err: unknown) =>
              setBackendError(err instanceof Error ? err.message : String(err))
            )
            .finally(() => setIndexing(false))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '파일 로드 실패')
        setLoadedDocuments(null)
        resetToMock()
      } finally {
        setIsLoading(false)
      }
    },
    [setLoadedDocuments, setIsLoading, setError, setNodes, setLinks, resetToMock,
     setIndexing, setChunkCount, setBackendError]
  )

  return { vaultPath, loadVault }
}

// ── VaultSelector component ───────────────────────────────────────────────────

export default function VaultSelector() {
  const {
    vaultPath, loadedDocuments, isLoading, error,
    setVaultPath, clearVault,
  } = useVaultStore()
  const { isIndexing, chunkCount } = useBackendStore()
  const { loadVault } = useVaultLoader()
  const cleanupWatcherRef = useRef<(() => void) | null>(null)

  // ── Auto-load persisted vault on mount ────────────────────────────────────
  useEffect(() => {
    if (vaultPath && window.vaultAPI) {
      loadVault(vaultPath).then(() => {
        window.vaultAPI!.watchStart(vaultPath)
      })
    }
    // Cleanup watcher on unmount
    return () => {
      window.vaultAPI?.watchStop()
      cleanupWatcherRef.current?.()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Subscribe to vault:changed events ────────────────────────────────────
  useEffect(() => {
    if (!window.vaultAPI || !vaultPath) return
    const cleanup = window.vaultAPI.onChanged(() => {
      loadVault(vaultPath)
    })
    cleanupWatcherRef.current = cleanup
    return cleanup
  }, [vaultPath, loadVault])

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSelectFolder = useCallback(async () => {
    if (!window.vaultAPI) return
    const selected = await window.vaultAPI.selectFolder()
    if (!selected) return
    setVaultPath(selected)
    await loadVault(selected)

    // If the vault is empty (no .md files), create a default "Project.md"
    const { loadedDocuments: freshDocs } = useVaultStore.getState()
    if ((!freshDocs || freshDocs.length === 0) && window.vaultAPI.saveFile) {
      const today = new Date().toISOString().slice(0, 10)
      const defaultContent = [
        '---',
        'speaker: chief_director',
        `date: ${today}`,
        'tags: [project]',
        '---',
        '',
        '# Project',
        '',
        '새 볼트의 기본 문서입니다. 내용을 자유롭게 편집하세요.',
        '',
      ].join('\n')
      // Node.js accepts forward slashes on Windows as well
      const projectPath = selected.replace(/[/\\]$/, '') + '/Project.md'
      await window.vaultAPI.saveFile(projectPath, defaultContent)
      // Reload vault to pick up the newly created file
      await loadVault(selected)
    }

    await window.vaultAPI.watchStart(selected)
  }, [setVaultPath, loadVault])

  const handleReload = useCallback(async () => {
    if (!vaultPath) return
    await loadVault(vaultPath)
  }, [vaultPath, loadVault])

  const handleClear = useCallback(async () => {
    window.vaultAPI?.watchStop()
    clearVault()
    const { resetToMock } = useGraphStore.getState()
    resetToMock()
    if (window.backendAPI) {
      window.backendAPI.clearIndex().catch(() => {})
    }
  }, [clearVault])

  const docCount = loadedDocuments?.length ?? 0

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div data-testid="vault-selector">
      {/* Section header */}
      <p
        className="text-xs font-semibold tracking-widest mb-3"
        style={{ color: 'var(--color-text-muted)' }}
      >
        VAULT
      </p>

      {/* Current vault path display */}
      {vaultPath ? (
        <div
          className="text-xs px-2 py-1.5 rounded mb-2 font-mono break-all"
          style={{
            background: 'var(--color-bg-surface)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
          data-testid="vault-path"
        >
          {vaultPath}
        </div>
      ) : (
        <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
          볼트를 선택하지 않으면 Mock 데이터가 표시됩니다.
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mb-2">
        <button
          onClick={handleSelectFolder}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            opacity: isLoading ? 0.5 : 1,
          }}
          data-testid="vault-select-btn"
        >
          <FolderOpen size={12} />
          볼트 선택
        </button>

        {vaultPath && (
          <>
            <button
              onClick={handleReload}
              disabled={isLoading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)',
                opacity: isLoading ? 0.5 : 1,
              }}
              data-testid="vault-reload-btn"
            >
              {isLoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              새로고침
            </button>

            <button
              onClick={handleClear}
              disabled={isLoading}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
                opacity: isLoading ? 0.5 : 1,
              }}
              data-testid="vault-clear-btn"
            >
              <X size={12} />
              해제
            </button>
          </>
        )}
      </div>

      {/* Status: doc count + indexing */}
      {vaultPath && !isLoading && !error && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {docCount > 0 ? (
            <>
              <span data-testid="vault-doc-count">{docCount}</span>개 문서 로드됨
              {chunkCount > 0 && ` · ${chunkCount}개 청크 인덱싱됨`}
              {isIndexing && ' · 인덱싱 중…'}
            </>
          ) : (
            '.md 파일이 없습니다'
          )}
        </p>
      )}

      {isLoading && (
        <p className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
          <Loader2 size={10} className="animate-spin" />
          파일 로딩 중…
        </p>
      )}

      {error && (
        <p
          className="text-xs flex items-center gap-1"
          style={{ color: '#ef4444' }}
          data-testid="vault-error"
        >
          <AlertCircle size={10} />
          {error}
        </p>
      )}
    </div>
  )
}
