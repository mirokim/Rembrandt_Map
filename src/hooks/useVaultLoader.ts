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
import { parseVaultFilesAsync } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
import { vaultDocsToChunks } from '@/lib/vaultToChunks'
import { parsePersonaConfig } from '@/lib/personaVaultConfig'
import { tfidfIndex } from '@/lib/graphAnalysis'
import { buildAdjacencyMap } from '@/lib/graphRAG'
import { buildFingerprint, loadTfIdfCache, saveTfIdfCache } from '@/lib/tfidfCache'

export function useVaultLoader() {
  const { vaultPath, setLoadedDocuments, setVaultFolders, setImagePathRegistry, addImageDataCache, clearImageDataCache, setIsLoading, setVaultReady, setLoadingProgress, setError } =
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
      setVaultReady(false)
      setLoadingProgress(0, '볼트 초기화 중...')
      setError(null)
      try {
        const { files, folders, imageRegistry } = await window.vaultAPI.loadFiles(dirPath)
        logger.debug(`[vault] ${files?.length ?? 0}개 파일, ${folders?.length ?? 0}개 폴더, ${Object.keys(imageRegistry ?? {}).length}개 이미지 로드됨 (${dirPath})`)
        setVaultFolders(folders ?? [])
        setImagePathRegistry(imageRegistry ?? null)
        setLoadingProgress(5, '파일 목록 로드 완료')

        if (!files || files.length === 0) {
          setLoadedDocuments(null)
          resetToMock()
          setIsLoading(false)
          return
        }

        const total = files.length
        const docs = await parseVaultFilesAsync(files, (parsed) => {
          const pct = 5 + Math.round((parsed / total) * 80)
          setLoadingProgress(pct, `문서 파싱 중... (${parsed}/${total})`)
        })
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
        setLoadingProgress(90, '그래프 구성 중...')
        const { nodes, links } = buildGraph(docs)
        logger.debug(`[vault] 그래프: ${nodes.length}개 노드, ${links.length}개 링크`)
        setNodes(nodes)
        setLinks(links)
        setLoadingProgress(95, '설정 불러오는 중...')

        // TF-IDF 인덱스: 캐시 히트 시 복원, 미스 시 빌드 후 저장
        // setTimeout(0)으로 UI 블로킹 방지
        const fingerprint = buildFingerprint(docs)
        setTimeout(async () => {
          const cached = await loadTfIdfCache(dirPath, fingerprint)
          if (cached) {
            tfidfIndex.restore(cached)
          } else {
            tfidfIndex.build(docs)
            void saveTfIdfCache(dirPath, tfidfIndex.serialize(fingerprint))
          }
          // 묵시적 연결 사전 계산 — adjacency 기반 캐시 워밍
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
        // 이미지 사전 인덱싱 — 로딩 완료 후 백그라운드로 실행 (UI 블로킹 없음)
        if (window.vaultAPI) {
          void (async () => {
            const registry = useVaultStore.getState().imagePathRegistry
            if (!registry) return
            // 모든 문서의 imageRefs 수집 (중복 제거)
            const refsToPreload = [...new Set(
              docs.flatMap(d => d.imageRefs ?? []).filter(ref => !!registry[ref])
            )]
            if (refsToPreload.length === 0) return
            clearImageDataCache()
            logger.debug(`[vault] 이미지 사전 인덱싱 시작: ${refsToPreload.length}개`)
            // 10개씩 배치 병렬 처리
            const BATCH = 10
            for (let i = 0; i < refsToPreload.length; i += BATCH) {
              const batch = refsToPreload.slice(i, i + BATCH)
              const results = await Promise.allSettled(
                batch.map(async (ref) => {
                  const entry = registry[ref]
                  const dataUrl = await window.vaultAPI!.readImage(entry.absolutePath)
                  return { ref, dataUrl }
                })
              )
              const batchEntries: Record<string, string> = {}
              for (const r of results) {
                if (r.status === 'fulfilled' && r.value.dataUrl) {
                  batchEntries[r.value.ref] = r.value.dataUrl
                }
              }
              if (Object.keys(batchEntries).length > 0) addImageDataCache(batchEntries)
            }
            logger.debug('[vault] 이미지 사전 인덱싱 완료')
          })()
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '파일 로드 실패'
        logger.error('[vault] 로드 실패:', msg)
        setError(msg)
        setLoadedDocuments(null)
        resetToMock()
      } finally {
        setLoadingProgress(100, '')
        setVaultReady(true)
        setIsLoading(false)
      }
    },
    [setLoadedDocuments, setVaultFolders, setImagePathRegistry, addImageDataCache, clearImageDataCache,
     setIsLoading, setVaultReady, setLoadingProgress, setError,
     setNodes, setLinks, resetToMock, setIndexing, setChunkCount, setBackendError,
     loadVaultPersonas, resetVaultPersonas]
  )

  return { vaultPath, loadVault }
}
