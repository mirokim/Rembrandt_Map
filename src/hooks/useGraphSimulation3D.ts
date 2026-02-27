import { useEffect, useRef } from 'react'
import { useGraphStore } from '@/stores/graphStore'
import type { GraphNode } from '@/types'

export interface SimNode3D extends GraphNode {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export interface SimLink3D {
  source: SimNode3D | string
  target: SimNode3D | string
  strength?: number
}

interface Options {
  onTick: (nodes: SimNode3D[], links: SimLink3D[]) => void
}

/**
 * 3D force simulation hook using d3-force-3d.
 * Reads nodes/links from graphStore so vault data is reflected automatically.
 * Reinitializes whenever the node/link dataset changes (vault load or clear).
 */
export function useGraphSimulation3D({ onTick }: Options) {
  const { nodes, links, physics } = useGraphStore()
  const simRef = useRef<unknown>(null)
  const simNodesRef = useRef<SimNode3D[]>([])
  const simLinksRef = useRef<SimLink3D[]>([])
  const onTickRef = useRef(onTick)
  onTickRef.current = onTick

  // Initialize (or reinitialize) simulation when nodes/links dataset changes
  useEffect(() => {
    let cancelled = false

    const spread = 200
    simNodesRef.current = nodes.map(n => ({
      ...n,
      x: (Math.random() - 0.5) * spread,
      y: (Math.random() - 0.5) * spread,
      z: (Math.random() - 0.5) * spread,
      vx: 0, vy: 0, vz: 0,
    }))
    simLinksRef.current = links.map(l => ({ ...l })) as SimLink3D[]

    // Dynamically import d3-force-3d so Vitest can easily mock it
    import('d3-force-3d').then(({
      forceSimulation,
      forceLink,
      forceManyBody,
      forceCenter,
    }) => {
      if (cancelled) return

      const sim = (forceSimulation as (nodes: SimNode3D[]) => any)(simNodesRef.current)
        .numDimensions(3)
        .force(
          'link',
          (forceLink as (links: SimLink3D[]) => any)(simLinksRef.current)
            .id((d: SimNode3D) => d.id)
            .strength(physics.linkStrength)
            .distance(physics.linkDistance),
        )
        .force('charge', (forceManyBody as () => any)().strength(physics.charge))
        .force('center', (forceCenter as (x: number, y: number, z: number) => any)(0, 0, 0).strength(physics.centerForce))

      sim.on('tick', () => {
        onTickRef.current(simNodesRef.current, simLinksRef.current)
      })

      simRef.current = sim
    })

    return () => {
      cancelled = true
      if (simRef.current) {
        (simRef.current as any).stop?.()
        simRef.current = null
      }
    }
    // physics is intentionally excluded: reheating is handled in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links])

  // Reheat when physics params change (without reinitializing nodes/links)
  useEffect(() => {
    const sim = simRef.current as any
    if (!sim) return
    sim.force('link')?.strength(physics.linkStrength).distance(physics.linkDistance)
    sim.force('charge')?.strength(physics.charge)
    sim.force('center')?.strength(physics.centerForce)
    sim.alpha(0.3).restart()
  }, [physics])

  return { simRef, simNodesRef, simLinksRef }
}
