/**
 * useVaultLoader — Shared vault loading logic.
 *
 * Extracted so it can be used by both:
 *   - App.tsx (auto-load on startup when vaultPath is persisted)
 *   - VaultSelector.tsx (manual load/reload from settings UI)
 */

import { useCallback } from 'react'
import { PERSONA_CONFIG_PATH } from '@/lib/constants'
import { logger } from '@/lib/logger'
import { useVaultStore } from '@/stores/vaultStore'
import { useGraphStore } from '@/stores/graphStore'
import { useBackendStore } from '@/stores/backendStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { parseVaultFiles } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
import { vaultDocsToChunks } from '@/lib/vaultToChunks'
import { parsePersonaConfig } from '@/lib/personaVaultConfig'
import { tfidfIndex } from '@/lib/graphAnalysis'
import { buildAdjacencyMap } from '@/lib/graphRAG'

export function useVaultLoader() {
  const { vaultPath, setLoadedDocuments, setVaultFolders, setIsLoading, setError } =
    useVaultStore()
  const { setNodes, setLinks, resetToMock } = useGraphStore()
  const { setIndexing, setChunkCount, setError: setBackendError } = useBackendStore()
  const { loadVaultPersonas, resetVaultPersonas } = useSettingsStore()

  const loadVault = useCallback(
    async (dirPath: string) => {
      if (!window.vaultAPI) {
        setError('Electron 환경이 아닙니다. 브라우저에서는 볼트를 로드할 수 없습니다.')
        return
      }
      setIsLoading(true)
      setError(null)
      try {
        const { files, folders } = await window.vaultAPI.loadFiles(dirPath)
        logger.debug(`[vault] ${files?.length ?? 0}개 파일, ${folders?.length ?? 0}개 폴더 로드됨 (${dirPath})`)
        setVaultFolders(folders ?? [])

        if (!files || files.length === 0) {
          setLoadedDocuments(null)
          resetToMock()
          setIsLoading(false)
          return
        }

        const docs = parseVaultFiles(files)
        logger.debug(`[vault] ${docs.length}/${files.length}개 문서 파싱 성공`)
        setLoadedDocuments(docs)

        // Load vault-scoped persona config (.rembrant/personas.md)
        try {
          const configPath = `${dirPath}/${PERSONA_CONFIG_PATH}`
          const configContent = await window.vaultAPI!.readFile(configPath)
          if (configContent) {
            const config = parsePersonaConfig(configContent)
            if (config) {
              loadVaultPersonas(config)
              logger.debug('[vault] 페르소나 설정 로드됨')
            } else {
              resetVaultPersonas()
            }
          } else {
            resetVaultPersonas()
          }
        } catch {
          resetVaultPersonas()
        }

        // Update graph
        const { nodes, links } = buildGraph(docs)
        logger.debug(`[vault] 그래프: ${nodes.length}개 노드, ${links.length}개 링크`)
        setNodes(nodes)
        setLinks(links)

        // TF-IDF 인덱스 빌드 (비동기적으로 백그라운드 실행 — UI 블로킹 방지)
        setTimeout(() => {
          tfidfIndex.build(docs)
          // 묵시적 연결 사전 계산 — TF-IDF 빌드 직후 adjacency 기반 캐시 워밍
          const { links: currentLinks } = useGraphStore.getState()
          if (currentLinks.length > 0) {
            const adj = buildAdjacencyMap(currentLinks)
            tfidfIndex.findImplicitLinks(adj)
          }
        }, 0)

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
        logger.error('[vault] 로드 실패:', msg)
        setError(msg)
        setLoadedDocuments(null)
        resetToMock()
      } finally {
        setIsLoading(false)
      }
    },
    [setLoadedDocuments, setVaultFolders, setIsLoading, setError, setNodes, setLinks, resetToMock,
     setIndexing, setChunkCount, setBackendError, loadVaultPersonas, resetVaultPersonas]
  )

  return { vaultPath, loadVault }
}
