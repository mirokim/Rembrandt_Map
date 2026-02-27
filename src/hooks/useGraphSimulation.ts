import { useEffect, useRef } from 'react'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  type Simulation,
} from 'd3-force'
import type { GraphNode, GraphLink } from '@/types'
import { useGraphStore } from '@/stores/graphStore'

export interface SimNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
}

export interface SimLink {
  source: SimNode | string
  target: SimNode | string
  strength?: number
}

interface Options {
  width: number
  height: number
  onTick: (simNodes: SimNode[], simLinks: SimLink[]) => void
}

/**
 * Shared 2D force simulation hook.
 * Reads nodes/links from graphStore so vault data is reflected automatically.
 * Reinitializes whenever the node/link dataset changes (vault load or clear).
 * Reheats separately when physics params change.
 */
export function useGraphSimulation({ width, height, onTick }: Options) {
  const { nodes, links, physics } = useGraphStore()
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const simNodesRef = useRef<SimNode[]>([])
  const simLinksRef = useRef<SimLink[]>([])
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick

  // Initialize (or reinitialize) simulation when nodes/links dataset changes
  useEffect(() => {
    simNodesRef.current = nodes.map(n => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
    }))
    simLinksRef.current = links.map(l => ({ ...l })) as SimLink[]

    const sim = forceSimulation<SimNode>(simNodesRef.current)
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinksRef.current)
          .id(d => d.id)
          .strength(physics.linkStrength)
          .distance(physics.linkDistance)
      )
      .force('charge', forceManyBody<SimNode>().strength(physics.charge))
      .force('center', forceCenter<SimNode>(width / 2, height / 2).strength(physics.centerForce))

    sim.on('tick', () => {
      onTickRef.current(simNodesRef.current, simLinksRef.current)
    })

    simRef.current = sim
    return () => {
      sim.stop()
      simRef.current = null
    }
    // physics is intentionally excluded: reheating is handled in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, nodes, links])

  // Reheat when physics params change (without reinitializing nodes/links)
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    ;(sim.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>> | null)
      ?.strength(physics.linkStrength)
      .distance(physics.linkDistance)
    ;(sim.force('charge') as ReturnType<typeof forceManyBody<SimNode>> | null)
      ?.strength(physics.charge)
    ;(sim.force('center') as ReturnType<typeof forceCenter<SimNode>> | null)
      ?.strength(physics.centerForce)
    sim.alpha(0.3).restart()
  }, [physics])

  return { simRef, simNodesRef, simLinksRef }
}
