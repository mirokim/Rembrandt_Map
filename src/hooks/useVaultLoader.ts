/**
 * useVaultLoader — Shared vault loading logic.
 *
 * Extracted so it can be used by both:
 *   - App.tsx (auto-load on startup when vaultPath is persisted)
 *   - VaultSelector.tsx (manual load/reload from settings UI)
 */

import { useCallback } from 'react'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { useBackendStore } from '@/stores/backendStore'
import { parseVaultFiles } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
import { vaultDocsToChunks } from '@/lib/vaultToChunks'

export function useVaultLoader() {
  const { vaultPath, setLoadedDocuments, setIsLoading, setError } =
    useVaultStore()
  const { setNodes, setLinks, resetToMock } = useGraphStore()
  const { setIndexing, setChunkCount, setError: setBackendError } = useBackendStore()

  const loadVault = useCallback(
    async (dirPath: string) => {
      if (!window.vaultAPI) {
        setError('Electron 환경이 아닙니다. 브라우저에서는 볼트를 로드할 수 없습니다.')
        return
      }
      setIsLoading(true)
      setError(null)
      try {
        const files = await window.vaultAPI.loadFiles(dirPath)
        console.log(`[vault] ${files?.length ?? 0}개 파일 로드됨 (${dirPath})`)

        if (!files || files.length === 0) {
          setLoadedDocuments(null)
          resetToMock()
          setIsLoading(false)
          return
        }

        const docs = parseVaultFiles(files)
        console.log(`[vault] ${docs.length}/${files.length}개 문서 파싱 성공`)
        setLoadedDocuments(docs)

        // Update graph
        const { nodes, links } = buildGraph(docs)
        console.log(`[vault] 그래프: ${nodes.length}개 노드, ${links.length}개 링크`)
        setNodes(nodes)
        setLinks(links)

        // Index into backend if available (check readiness first to avoid noisy errors)
        if (window.backendAPI && docs.length > 0) {
          try {
            const status = await window.backendAPI.getStatus()
            if (status?.ready) {
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
          } catch {
            // Backend not running — silently skip indexing
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '파일 로드 실패'
        console.error('[vault] 로드 실패:', msg)
        setError(msg)
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
