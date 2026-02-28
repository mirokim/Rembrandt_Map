/**
 * graphRAG.ts — Graph-Augmented RAG
 *
 * Enhances ChromaDB search results using wiki-link graph relationships:
 *  1. Graph expansion: include content from neighbor sections
 *  2. Keyword reranking with speaker affinity: reorder candidates by term overlap
 *  3. Compressed formatting: token-efficient context for LLM
 */

import type { SearchResult, GraphLink, LoadedDocument, DocSection } from '@/types'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultStore } from '@/stores/vaultStore'

// ── Types ────────────────────────────────────────────────────────────────────

export interface NeighborContext {
  sectionId: string
  heading: string
  content: string
  linkedFrom: string
  filename: string
}

// ── Korean tokenization helpers ──────────────────────────────────────────────

/**
 * Common Korean particles/suffixes sorted longest-first for greedy stripping.
 * Stripping these from query tokens vastly improves keyword matching
 * against vault documents (e.g. "스칼렛이라는" → "스칼렛").
 */
const KO_SUFFIXES = [
  '이라는', '이라고', '에서는', '에게서', '한테서', '으로서', '으로써', '으로는',
  '에서의', '으로의', '에서도', '으로도',
  '이라', '에서', '에게', '한테', '까지', '부터', '처럼', '같은', '같이',
  '만큼', '으로', '이랑', '라는', '라고', '이란', '에는', '하고',
  '은', '는', '이', '가', '을', '를', '와', '과',
  '에', '도', '만', '의', '로',
]

/**
 * Strip Korean particles from a token to extract the stem.
 * Returns an array of [original, stem] (deduplicated).
 * Only strips if the remaining stem is >= 2 characters.
 */
function stemKorean(token: string): string[] {
  const results = [token]
  for (const suffix of KO_SUFFIXES) {
    if (token.endsWith(suffix) && token.length > suffix.length + 1) {
      results.push(token.slice(0, -suffix.length))
      break // greedy: strip longest matching suffix only
    }
  }
  return [...new Set(results)]
}

/**
 * Tokenize a Korean/English query string into search stems.
 * Splits on whitespace/punctuation, filters short tokens, then strips Korean particles.
 */
function tokenizeQuery(text: string): string[] {
  const raw = text
    .toLowerCase()
    .split(/[\s,.\-_?!;:()[\]{}'"]+/)
    .filter(t => t.length > 1)

  const stems: string[] = []
  for (const token of raw) {
    for (const stem of stemKorean(token)) {
      stems.push(stem)
    }
  }
  return [...new Set(stems)]
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build an undirected adjacency map from graph links.
 * Handles both string IDs and resolved GraphNode objects (d3-force mutates these).
 */
function buildAdjacencyMap(links: GraphLink[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()

  for (const link of links) {
    const source = typeof link.source === 'string' ? link.source : link.source.id
    const target = typeof link.target === 'string' ? link.target : link.target.id

    if (!adj.has(source)) adj.set(source, [])
    if (!adj.has(target)) adj.set(target, [])
    adj.get(source)!.push(target)
    adj.get(target)!.push(source)
  }

  return adj
}

/** Build a lookup map: section_id → { section, filename, docId } */
function buildSectionMap(
  docs: LoadedDocument[]
): Map<string, { section: DocSection; filename: string; docId: string }> {
  const map = new Map<string, { section: DocSection; filename: string; docId: string }>()
  for (const doc of docs) {
    for (const section of doc.sections) {
      map.set(section.id, { section, filename: doc.filename, docId: doc.id })
    }
  }
  return map
}

// ── 0. Frontend-only keyword search (fallback when no Python backend) ────────

/**
 * Search loaded vault documents using keyword matching.
 * Used as a fallback when ChromaDB backend is unavailable.
 *
 * Scoring: proportion of query terms found in section heading + body.
 * Returns results sorted by score descending.
 *
 * @param query      User's search query
 * @param topN       Max results to return
 */
export function frontendKeywordSearch(
  query: string,
  topN: number = 8
): SearchResult[] {
  const { loadedDocuments } = useVaultStore.getState()
  if (!loadedDocuments || loadedDocuments.length === 0) return []

  // Tokenize query with Korean particle stripping
  const queryStems = tokenizeQuery(query)

  if (queryStems.length === 0) return []

  const scored: { result: SearchResult; score: number }[] = []

  for (const doc of loadedDocuments) {
    for (const section of doc.sections) {
      if (!section.body.trim()) continue

      const headingLower = section.heading.toLowerCase()
      const bodyLower = section.body.toLowerCase()

      // TF-weighted scoring: heading match × 3, body frequency bonus
      let score = 0
      let matchedTerms = 0
      for (const stem of queryStems) {
        const inHeading = headingLower.includes(stem)
        const bodyCount = bodyLower.split(stem).length - 1
        if (inHeading || bodyCount > 0) {
          matchedTerms++
          // Heading match is 3× more valuable
          score += inHeading ? 0.3 : 0
          // Body frequency: diminishing returns via log
          score += bodyCount > 0 ? 0.1 * (1 + Math.log(bodyCount)) : 0
        }
      }

      if (matchedTerms === 0) continue

      // Coverage bonus: fraction of query stems matched
      const coverage = matchedTerms / queryStems.length
      score = score * 0.6 + coverage * 0.4
      // Normalize to 0..1 range (cap at 1.0)
      score = Math.min(1, score)

      scored.push({
        score,
        result: {
          doc_id: doc.id,
          filename: doc.filename,
          section_id: section.id,
          heading: section.heading,
          speaker: doc.speaker,
          content: section.body.length > 400
            ? section.body.slice(0, 400).trimEnd() + '…'
            : section.body,
          score,
          tags: doc.tags,
        },
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN).map(s => s.result)
}

// ── Graph data cache ────────────────────────────────────────────────────────

let _cachedAdjacency: Map<string, string[]> | null = null
let _cachedSectionMap: Map<string, { section: DocSection; filename: string; docId: string }> | null = null
let _cachedLinksRef: GraphLink[] | null = null
let _cachedDocsRef: LoadedDocument[] | null = null

function getCachedMaps(links: GraphLink[], docs: LoadedDocument[]) {
  // Invalidate when array reference or length changes
  if (links !== _cachedLinksRef || docs !== _cachedDocsRef) {
    _cachedAdjacency = buildAdjacencyMap(links)
    _cachedSectionMap = buildSectionMap(docs)
    _cachedLinksRef = links
    _cachedDocsRef = docs
  }
  return { adjacency: _cachedAdjacency!, sectionMap: _cachedSectionMap! }
}

// ── 1. Graph expansion ───────────────────────────────────────────────────────

/**
 * Expand search results with graph-connected neighbor sections.
 *
 * For each ChromaDB result, looks up wiki-link neighbors in the graph
 * and includes truncated content from connected sections.
 *
 * @param results                ChromaDB search results (already reranked)
 * @param maxNeighborsPerResult  Max neighbor sections to include per result
 */
export function expandWithGraphNeighbors(
  results: SearchResult[],
  maxNeighborsPerResult: number = 2
): NeighborContext[] {
  const { links } = useGraphStore.getState()
  const { loadedDocuments } = useVaultStore.getState()

  if (!loadedDocuments || loadedDocuments.length === 0 || links.length === 0) {
    return []
  }

  const { adjacency, sectionMap } = getCachedMaps(links, loadedDocuments)

  // Map result section_ids to their parent doc IDs
  const primaryDocIds = new Set<string>()
  for (const r of results) {
    if (!r.section_id) continue
    const entry = sectionMap.get(r.section_id)
    if (entry) primaryDocIds.add(entry.docId)
  }

  const seenDocIds = new Set<string>()
  const neighbors: NeighborContext[] = []

  for (const result of results) {
    if (!result.section_id) continue

    // Find the parent doc ID for this result
    const resultEntry = sectionMap.get(result.section_id)
    if (!resultEntry) continue
    const resultDocId = resultEntry.docId

    // Graph adjacency is now document-level (doc.id → doc.id)
    const connectedDocIds = adjacency.get(resultDocId) ?? []
    let added = 0

    for (const neighborDocId of connectedDocIds) {
      if (added >= maxNeighborsPerResult) break
      if (primaryDocIds.has(neighborDocId)) continue
      if (seenDocIds.has(neighborDocId)) continue

      // Find first non-empty section from the neighbor document
      const neighborDoc = loadedDocuments.find(d => d.id === neighborDocId)
      if (!neighborDoc) continue
      const firstSection = neighborDoc.sections.find(s => s.body.trim())
      if (!firstSection) continue

      seenDocIds.add(neighborDocId)
      const body = firstSection.body
      neighbors.push({
        sectionId: firstSection.id,
        heading: firstSection.heading,
        content: body.length > 300 ? body.slice(0, 300).trimEnd() + '…' : body,
        linkedFrom: result.section_id,
        filename: neighborDoc.filename,
      })
      added++
    }
  }

  return neighbors
}

// ── 2. 2-stage reranking ─────────────────────────────────────────────────────

/**
 * Rerank search results by combining vector similarity score
 * with keyword overlap and optional speaker affinity.
 *
 * Formula:
 *   keyword_score = |query_terms ∩ content_terms| / |query_terms|
 *   speaker_boost = 0.1 if speaker matches current persona, else 0
 *   final_score   = 0.6 × vector_score + 0.3 × keyword_score + speaker_boost
 *
 * @param results         ChromaDB search results (pre-filtered by score > 0.3)
 * @param query           Original user query
 * @param topN            Number of results to return after reranking
 * @param currentSpeaker  Current director persona (for speaker affinity boost)
 */
export function rerankResults(
  results: SearchResult[],
  query: string,
  topN: number = 3,
  currentSpeaker?: string
): SearchResult[] {
  if (results.length <= topN) return results

  // Tokenize query with Korean particle stripping
  const queryStems = new Set(tokenizeQuery(query))

  if (queryStems.size === 0) return results.slice(0, topN)

  const scored = results.map(r => {
    // Check content using substring matching (handles Korean particles in content too)
    const contentLower = (r.content + ' ' + (r.heading ?? '')).toLowerCase()

    // Count stem matches via substring inclusion
    let overlap = 0
    for (const stem of queryStems) {
      if (contentLower.includes(stem)) overlap++
    }
    const keywordScore = overlap / queryStems.size

    // Speaker affinity boost (same speaker → 10% bonus)
    const speakerBoost =
      currentSpeaker && currentSpeaker !== 'unknown' && r.speaker === currentSpeaker
        ? 0.1
        : 0

    const finalScore = 0.6 * r.score + 0.3 * keywordScore + speakerBoost

    return { result: r, finalScore }
  })

  scored.sort((a, b) => b.finalScore - a.finalScore)

  return scored.slice(0, topN).map(s => s.result)
}

// ── 3. Compressed context formatting ─────────────────────────────────────────

/**
 * Format search results and neighbor contexts into a compressed,
 * token-efficient context string for LLM injection.
 *
 * Format:
 *   ## 관련 문서
 *   [문서] filename > heading (speaker)
 *   content...
 *
 *   ### 연결 문서
 *   [연결] filename > heading
 *   neighbor content...
 */
/**
 * Max total characters for the context string.
 * ~2000 chars ≈ ~600 tokens — keeps LLM context lean while providing
 * enough reference material for accurate answers.
 */
const CONTEXT_BUDGET = 3000

export function formatCompressedContext(
  results: SearchResult[],
  neighbors: NeighborContext[]
): string {
  if (results.length === 0) return ''

  const parts: string[] = ['## 관련 문서\n']
  let charCount = 10 // header length

  for (const r of results) {
    const header = [
      `[문서]`,
      r.filename,
      r.heading ? `> ${r.heading}` : null,
      r.speaker && r.speaker !== 'unknown' ? `(${r.speaker})` : null,
    ]
      .filter(Boolean)
      .join(' ')

    // Truncate content to fit budget
    const maxContent = Math.min(300, CONTEXT_BUDGET - charCount - header.length - 10)
    if (maxContent <= 0) break
    const content = r.content.length > maxContent
      ? r.content.slice(0, maxContent).trimEnd() + '…'
      : r.content

    parts.push(header)
    parts.push(content)
    parts.push('')
    charCount += header.length + content.length + 2
  }

  if (neighbors.length > 0 && charCount < CONTEXT_BUDGET - 100) {
    parts.push('### 연결 문서\n')
    charCount += 12

    for (const n of neighbors) {
      const nHeader = `[연결] ${n.filename} > ${n.heading}`
      const maxContent = Math.min(200, CONTEXT_BUDGET - charCount - nHeader.length - 10)
      if (maxContent <= 0) break
      const content = n.content.length > maxContent
        ? n.content.slice(0, maxContent).trimEnd() + '…'
        : n.content

      parts.push(nHeader)
      parts.push(content)
      parts.push('')
      charCount += nHeader.length + content.length + 2
    }
  }

  return parts.join('\n') + '\n'
}
