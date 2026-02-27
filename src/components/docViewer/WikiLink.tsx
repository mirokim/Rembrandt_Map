import { useCallback } from 'react'
import { useGraphStore } from '@/stores/graphStore'
import { useUIStore } from '@/stores/uiStore'
import { MOCK_NODES } from '@/data/mockGraph'

interface Props {
  slug: string
}

/**
 * Renders a [[wiki-link]] token.
 * Click → find the matching graph node and navigate to it.
 */
export default function WikiLink({ slug }: Props) {
  const { setSelectedNode } = useGraphStore()
  const { setSelectedDoc, setCenterTab } = useUIStore()

  const handleClick = useCallback(() => {
    // Find a node whose id matches the slug
    const node = MOCK_NODES.find(n => n.id === slug)
    if (node) {
      setSelectedNode(node.id)
      setSelectedDoc(node.docId)
      setCenterTab('graph')
    }
  }, [slug, setSelectedNode, setSelectedDoc, setCenterTab])

  return (
    <span
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={e => { if (e.key === 'Enter') handleClick() }}
      data-testid={`wiki-link-${slug}`}
      style={{
        color: 'var(--color-accent)',
        cursor: 'pointer',
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        textUnderlineOffset: 2,
      }}
    >
      {slug}
    </span>
  )
}
