/**
 * mockGraph.ts — Phase 6 refactor
 *
 * Now a thin wrapper around the generic graphBuilder.ts.
 * The original buildGraphNodes() / buildGraphLinks() signatures are preserved
 * so existing tests and imports continue to work without changes.
 */

import type { GraphNode, GraphLink } from '@/types'
import { MOCK_DOCUMENTS } from './mockDocuments'
import {
  buildGraphNodes as _buildGraphNodes,
  buildGraphLinks as _buildGraphLinks,
} from '@/lib/graphBuilder'

/**
 * Derive GraphNode[] from mock documents.
 * @deprecated Use graphBuilder.buildGraphNodes(docs) directly for non-mock data.
 */
export function buildGraphNodes(): GraphNode[] {
  return _buildGraphNodes(MOCK_DOCUMENTS)
}

/**
 * Derive GraphLink[] from mock documents.
 * @deprecated Use graphBuilder.buildGraphLinks(docs, nodes) directly for non-mock data.
 */
export function buildGraphLinks(nodes: GraphNode[]): GraphLink[] {
  return _buildGraphLinks(MOCK_DOCUMENTS, nodes)
}

export const MOCK_NODES: GraphNode[] = buildGraphNodes()
export const MOCK_LINKS: GraphLink[] = buildGraphLinks(MOCK_NODES)
