/**
 * useDocumentFilter.ts — Phase 6 update
 *
 * Provides filtered and grouped document lists for the FileTree.
 * Mock fallback: if no vault is loaded, falls back to MOCK_DOCUMENTS.
 */

import { useState, useMemo } from 'react'
import type { SpeakerId } from '@/types'
import type { MockDocument } from '@/types'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'
import { useVaultStore } from '@/stores/vaultStore'
import { SPEAKER_IDS } from '@/lib/speakerConfig'

type AnyDoc = MockDocument  // LoadedDocument is structurally compatible

export function useDocumentFilter() {
  const { vaultPath, loadedDocuments } = useVaultStore()
  const [search, setSearch] = useState('')

  // Mock fallback: if no vault is loaded, use MOCK_DOCUMENTS
  const allDocuments = (vaultPath && loadedDocuments) ? loadedDocuments as AnyDoc[] : MOCK_DOCUMENTS

  const filtered = useMemo(() => {
    if (!search.trim()) return allDocuments
    const q = search.toLowerCase()
    return allDocuments.filter(doc =>
      doc.filename.toLowerCase().includes(q) ||
      doc.tags.some(t => t.toLowerCase().includes(q)) ||
      doc.sections.some(s => s.heading.toLowerCase().includes(q))
    )
  }, [allDocuments, search])

  const grouped = useMemo(() => {
    const map: Partial<Record<SpeakerId, AnyDoc[]>> = {}
    for (const id of SPEAKER_IDS) {
      map[id] = filtered.filter(d => d.speaker === id)
    }
    // Collect 'unknown' speaker docs separately
    const unknownDocs = filtered.filter(d => d.speaker === 'unknown')
    if (unknownDocs.length > 0) {
      map['unknown' as SpeakerId] = unknownDocs
    }
    return map
  }, [filtered])

  return {
    search,
    setSearch,
    filtered,
    grouped,
    totalCount: allDocuments.length,
    isVaultLoaded: Boolean(vaultPath && loadedDocuments),
  }
}
