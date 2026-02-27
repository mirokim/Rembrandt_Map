import { describe, it, expect } from 'vitest'
import {
  buildGraphNodes,
  buildGraphLinks,
  buildGraph,
} from '@/lib/graphBuilder'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'
import type { LoadedDocument } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

const makeDoc = (
  id: string,
  overrides: Partial<LoadedDocument> = {}
): LoadedDocument => ({
  id,
  filename: `${id}.md`,
  speaker: 'art_director',
  date: '2024-01-01',
  tags: [],
  links: [],
  sections: [
    { id: `${id}_intro`, heading: '섹션', body: '내용', wikiLinks: [] },
  ],
  rawContent: '내용',
  ...overrides,
})

// ── buildGraphNodes ────────────────────────────────────────────────────────────

describe('buildGraphNodes()', () => {
  it('produces one node per section', () => {
    const docs = [
      makeDoc('d1', {
        sections: [
          { id: 'd1_s1', heading: 'A', body: 'b', wikiLinks: [] },
          { id: 'd1_s2', heading: 'B', body: 'c', wikiLinks: [] },
        ],
      }),
    ]
    const nodes = buildGraphNodes(docs)
    expect(nodes).toHaveLength(2)
  })

  it('each node has id, docId, speaker, label', () => {
    const docs = [makeDoc('d1')]
    const nodes = buildGraphNodes(docs)
    expect(nodes[0]).toHaveProperty('id')
    expect(nodes[0]).toHaveProperty('docId')
    expect(nodes[0]).toHaveProperty('speaker')
    expect(nodes[0]).toHaveProperty('label')
  })

  it('node id matches section id', () => {
    const docs = [makeDoc('d1', {
      sections: [{ id: 'd1_intro', heading: '섹션', body: '내용', wikiLinks: [] }],
    })]
    const nodes = buildGraphNodes(docs)
    expect(nodes[0].id).toBe('d1_intro')
  })

  it('works with MOCK_DOCUMENTS', () => {
    const nodes = buildGraphNodes(MOCK_DOCUMENTS)
    expect(nodes.length).toBeGreaterThanOrEqual(40)
  })

  it('returns empty array for empty input', () => {
    expect(buildGraphNodes([])).toEqual([])
  })
})

// ── buildGraphLinks ────────────────────────────────────────────────────────────

describe('buildGraphLinks()', () => {
  it('creates link for wikiLink reference that resolves to a node', () => {
    const docs = [
      makeDoc('doc_a', {
        // wikiLinks must reference section IDs — graphBuilder matches against node IDs (= section IDs)
        sections: [{ id: 'doc_a_s1', heading: 'A', body: 'b', wikiLinks: ['doc_b_s1'] }],
      }),
      makeDoc('doc_b', {
        sections: [{ id: 'doc_b_s1', heading: 'B', body: 'c', wikiLinks: [] }],
      }),
    ]
    const nodes = buildGraphNodes(docs)
    const links = buildGraphLinks(docs, nodes)
    expect(links.length).toBeGreaterThanOrEqual(1)
    const sourceIds = links.map((l) => l.source)
    const targetIds = links.map((l) => l.target)
    expect(sourceIds.some((s) => s === 'doc_a_s1')).toBe(true)
    expect(targetIds.some((t) => t === 'doc_b_s1')).toBe(true)
  })

  it('does not create link for unresolvable wikiLink', () => {
    const docs = [
      makeDoc('doc_a', {
        sections: [
          { id: 'doc_a_s1', heading: 'A', body: 'b', wikiLinks: ['nonexistent_doc'] },
        ],
      }),
    ]
    const nodes = buildGraphNodes(docs)
    const links = buildGraphLinks(docs, nodes)
    expect(links).toHaveLength(0)
  })

  it('link source and target are valid node ids', () => {
    const nodes = buildGraphNodes(MOCK_DOCUMENTS)
    const links = buildGraphLinks(MOCK_DOCUMENTS, nodes)
    const nodeIds = new Set(nodes.map((n) => n.id))
    for (const link of links) {
      expect(nodeIds.has(link.source)).toBe(true)
      expect(nodeIds.has(link.target)).toBe(true)
    }
  })
})

// ── buildGraph ─────────────────────────────────────────────────────────────────

describe('buildGraph()', () => {
  it('returns nodes and links', () => {
    const { nodes, links } = buildGraph(MOCK_DOCUMENTS)
    expect(Array.isArray(nodes)).toBe(true)
    expect(Array.isArray(links)).toBe(true)
  })

  it('graph from LoadedDocuments has correct structure', () => {
    const docs: LoadedDocument[] = [
      makeDoc('ld1', {
        sections: [
          { id: 'ld1_s1', heading: '섹션1', body: '내용', wikiLinks: [] },
          { id: 'ld1_s2', heading: '섹션2', body: '내용', wikiLinks: [] },
        ],
      }),
    ]
    const { nodes, links } = buildGraph(docs)
    expect(nodes).toHaveLength(2)
    expect(links).toHaveLength(0) // no cross-doc wikiLinks
  })
})
