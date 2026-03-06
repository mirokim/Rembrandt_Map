/**
 * useRagApi.ts — Slack bot의 HTTP RAG 요청을 처리하는 훅
 *
 * Electron main.cjs의 HTTP 서버(7331)가 rag:search IPC를 보내면
 * 기존 TF-IDF + directVaultSearch로 검색하여 결과를 돌려줍니다.
 */
import { useEffect } from 'react'
import { useVaultStore } from '@/stores/vaultStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { tfidfIndex } from '@/lib/graphAnalysis'
import { directVaultSearch } from '@/lib/graphRAG'
import { generateSlackAnswer } from '@/services/llmClient'
import type { RagDocResult } from '@/vite-env'

export function useRagApi() {
  useEffect(() => {
    if (!window.ragAPI) return

    const cleanup = window.ragAPI.onSearch(({ requestId, query, topN }) => {
      try {
        const docs = useVaultStore.getState().loadedDocuments
        if (!docs.length) {
          window.ragAPI!.sendResult(requestId, [])
          return
        }

        // TF-IDF 인덱스가 미빌드 상태면 빌드
        if (!tfidfIndex.isBuilt) {
          tfidfIndex.build(docs)
        }

        // TF-IDF 검색 + 직접 문자열 검색 병합
        const tfidfHits = tfidfIndex.search(query, topN)
        const directHits = directVaultSearch(query, topN)

        // doc_id 기준 dedup, 높은 score 우선
        const scoreMap = new Map<string, number>()
        for (const r of [...tfidfHits, ...directHits]) {
          const prev = scoreMap.get(r.doc_id) ?? -1
          if (r.score > prev) scoreMap.set(r.doc_id, r.score)
        }

        const sorted = [...scoreMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, topN)

        const docMap = new Map(docs.map(d => [d.id, d]))
        const results: RagDocResult[] = []

        for (const [docId, score] of sorted) {
          const doc = docMap.get(docId)
          if (!doc) continue
          results.push({
            doc_id:   docId,
            filename: doc.filename,
            stem:     doc.filename.replace(/\.md$/i, ''),
            title:    doc.title || doc.filename,
            date:     doc.date  || '',
            tags:     doc.tags  || [],
            body:     (doc.rawContent || '').slice(0, 2000),
            score,
          })
        }

        window.ragAPI!.sendResult(requestId, results)
      } catch (err) {
        console.error('[useRagApi] search error:', err)
        window.ragAPI!.sendResult(requestId, [])
      }
    })

    // Handle settings requests
    const cleanupSettings = window.ragAPI.onGetSettings(({ requestId }) => {
      const { personaModels } = useSettingsStore.getState()
      window.ragAPI!.sendResult(requestId, { personaModels })
    })

    // Handle full answer generation (Slack /ask endpoint)
    const cleanupAsk = window.ragAPI.onAsk(async ({ requestId, query, directorId, history, images }) => {
      try {
        const answer = await generateSlackAnswer(query, directorId, history ?? [], images)
        window.ragAPI!.sendResult(requestId, { answer })
      } catch (err) {
        console.error('[useRagApi] ask error:', err)
        window.ragAPI!.sendResult(requestId, { answer: '' })
      }
    })

    return () => { cleanup(); cleanupSettings(); cleanupAsk() }
  }, [])
}
