/**
 * graphBuilder.ts — Phase 6
 *
 * Generic graph construction from any document type (MockDocument or LoadedDocument).
 * Replaces the hard-coded mockGraph.ts functions with document-agnostic versions.
 */

import type { GraphNode, GraphLink, MockDocument, LoadedDocument, SpeakerId } from '@/types'
import { truncate } from '@/lib/utils'

// Internal union type — both shapes are structurally compatible
type AnyDocument = MockDocument | LoadedDocument

// ── buildGraphNodes ───────────────────────────────────────────────────────────

/**
 * Derive GraphNode[] from a document array.
 * One node per DocSection. Node id === section id (wiki-link slug).
 */
export function buildGraphNodes(documents: AnyDocument[]): GraphNode[] {
  const nodes: GraphNode[] = []
  for (const doc of documents) {
    for (const section of doc.sections) {
      nodes.push({
        id: section.id,
        docId: doc.id,
        speaker: doc.speaker as SpeakerId,
        label: truncate(section.heading, 36),
      })
    }
  }
  return nodes
}

// ── buildGraphLinks ───────────────────────────────────────────────────────────

/**
 * Derive GraphLink[] by matching wikiLinks in sections to node ids.
 * Deduplicates bidirectional pairs (A→B same as B→A).
 */
export function buildGraphLinks(
  documents: AnyDocument[],
  nodes: GraphNode[]
): GraphLink[] {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const links: GraphLink[] = []
  const seen = new Set<string>()

  for (const doc of documents) {
    for (const section of doc.sections) {
      for (const wikiLink of section.wikiLinks) {
        if (!nodeIds.has(wikiLink)) continue
        // Canonical sorted pair for deduplication
        const key = [section.id, wikiLink].sort().join('→')
        if (seen.has(key)) continue
        seen.add(key)
        links.push({ source: section.id, target: wikiLink, strength: 0.5 })
      }
    }
  }
  return links
}

// ── buildGraph ────────────────────────────────────────────────────────────────

/** Convenience: build both nodes and links in one call */
export function buildGraph(
  documents: AnyDocument[]
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes = buildGraphNodes(documents)
  const links = buildGraphLinks(documents, nodes)
  return { nodes, links }
}
