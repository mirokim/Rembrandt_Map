import { create } from 'zustand'
import type { GraphNode, GraphLink, PhysicsParams } from '@/types'
import { MOCK_NODES, MOCK_LINKS } from '@/data/mockGraph'

const DEFAULT_PHYSICS: PhysicsParams = {
  centerForce: 0.8,
  charge: -80,
  linkStrength: 0.7,
  linkDistance: 60,
}

const PHYSICS_BOUNDS = {
  centerForce: { min: 0, max: 1 },
  charge: { min: -1000, max: 0 },
  linkStrength: { min: 0, max: 2 },
  linkDistance: { min: 20, max: 300 },
}

function clampPhysics(params: Partial<PhysicsParams>): Partial<PhysicsParams> {
  const clamped: Partial<PhysicsParams> = {}
  for (const [k, v] of Object.entries(params) as [keyof PhysicsParams, number][]) {
    const { min, max } = PHYSICS_BOUNDS[k]
    clamped[k] = Math.min(max, Math.max(min, v))
  }
  return clamped
}

interface GraphState {
  nodes: GraphNode[]
  links: GraphLink[]
  selectedNodeId: string | null
  hoveredNodeId: string | null
  physics: PhysicsParams

  setSelectedNode: (id: string | null) => void
  setHoveredNode: (id: string | null) => void
  updatePhysics: (params: Partial<PhysicsParams>) => void
  resetPhysics: () => void
  /** Phase 6: replace nodes/links with vault-derived data */
  setNodes: (nodes: GraphNode[]) => void
  setLinks: (links: GraphLink[]) => void
  /** Phase 6: restore original mock graph */
  resetToMock: () => void
}

export const useGraphStore = create<GraphState>()((set) => ({
  nodes: MOCK_NODES,
  links: MOCK_LINKS,
  selectedNodeId: null,
  hoveredNodeId: null,
  physics: { ...DEFAULT_PHYSICS },

  setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
  setHoveredNode: (hoveredNodeId) => set({ hoveredNodeId }),
  updatePhysics: (params) =>
    set((state) => ({
      physics: { ...state.physics, ...clampPhysics(params) },
    })),
  resetPhysics: () => set({ physics: { ...DEFAULT_PHYSICS } }),
  setNodes: (nodes) => set({ nodes }),
  setLinks: (links) => set({ links }),
  resetToMock: () => set({ nodes: MOCK_NODES, links: MOCK_LINKS }),
}))

export { DEFAULT_PHYSICS, PHYSICS_BOUNDS }
