import { useRef, useState, useCallback, useEffect } from 'react'
import { useGraphStore } from '@/stores/graphStore'
import { useUIStore } from '@/stores/uiStore'
import { useGraphSimulation, type SimNode, type SimLink } from '@/hooks/useGraphSimulation'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import type { GraphNode, GraphLink } from '@/types'
import NodeTooltip from './NodeTooltip'

interface Props {
  width: number
  height: number
}

const LABEL_Y_OFFSET = 16  // px below node center

export default function Graph2D({ width, height }: Props) {
  const { nodes, links, selectedNodeId, setSelectedNode, setHoveredNode } = useGraphStore()
  const { setSelectedDoc, setCenterTab, centerTab } = useUIStore()

  // DOM refs — updated imperatively in simulation tick (avoids React re-render per frame)
  const nodeEls = useRef<Map<string, SVGCircleElement>>(new Map())
  const labelEls = useRef<Map<string, SVGTextElement>>(new Map())
  const linkEls = useRef<Map<number, SVGLineElement>>(new Map())
  const selRingEl = useRef<SVGCircleElement | null>(null)

  // Ref-based selected ID — keeps handleTick stable (no deps on selectedNodeId)
  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId

  // Pan/zoom refs — using refs (not state) to avoid re-renders that would reset imperative cx/cy
  const svgRef = useRef<SVGSVGElement>(null)
  const graphGroupRef = useRef<SVGGElement>(null)
  const labelGroupRef = useRef<SVGGElement>(null)
  const viewRef = useRef({ x: 0, y: 0, scale: 1 })
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ mx: 0, my: 0, tx: 0, ty: 0 })

  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null)

  // ── Simulation tick — direct DOM mutation, no React state ──────────────────
  const handleTick = useCallback((simNodes: SimNode[], simLinks: SimLink[]) => {
    for (const node of simNodes) {
      const el = nodeEls.current.get(node.id)
      if (el) {
        el.setAttribute('cx', String(node.x))
        el.setAttribute('cy', String(node.y))
      }
      const lEl = labelEls.current.get(node.id)
      if (lEl) {
        lEl.setAttribute('x', String(node.x ?? 0))
        lEl.setAttribute('y', String((node.y ?? 0) + LABEL_Y_OFFSET))
      }
    }
    const selId = selectedNodeIdRef.current
    if (selRingEl.current && selId) {
      const sel = simNodes.find(n => n.id === selId)
      if (sel) {
        selRingEl.current.setAttribute('cx', String(sel.x))
        selRingEl.current.setAttribute('cy', String(sel.y))
      }
    }
    simLinks.forEach((link, i) => {
      const el = linkEls.current.get(i)
      if (!el) return
      const src = link.source as SimNode
      const tgt = link.target as SimNode
      el.setAttribute('x1', String(src.x ?? 0))
      el.setAttribute('y1', String(src.y ?? 0))
      el.setAttribute('x2', String(tgt.x ?? 0))
      el.setAttribute('y2', String(tgt.y ?? 0))
    })
  }, [])  // stable — reads selectedNodeId via ref, no deps needed

  useGraphSimulation({ width, height, onTick: handleTick })

  // ── Pan/zoom: wheel zoom ──────────────────────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const view = viewRef.current
    const el = svgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const newScale = Math.min(6, Math.max(0.15, view.scale * zoomFactor))
    const ratio = newScale / view.scale
    viewRef.current = {
      x: mouseX - ratio * (mouseX - view.x),
      y: mouseY - ratio * (mouseY - view.y),
      scale: newScale,
    }
    if (graphGroupRef.current) {
      const v = viewRef.current
      graphGroupRef.current.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.scale})`)
    }
  }, [])

  // Register non-passive wheel listener (React synthetic events are passive by default)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // Release pan on mouse-up outside SVG
  useEffect(() => {
    const handleGlobalUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false
        if (svgRef.current) svgRef.current.style.cursor = 'grab'
      }
    }
    window.addEventListener('mouseup', handleGlobalUp)
    return () => window.removeEventListener('mouseup', handleGlobalUp)
  }, [])

  // ── Pan/zoom: mouse drag ──────────────────────────────────────────────────
  const handleSVGMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    // Only pan on background, not on interactive nodes/text
    const target = e.target as Element
    if (target.closest('circle') || target.closest('text')) return
    isPanningRef.current = true
    panStartRef.current = {
      mx: e.clientX,
      my: e.clientY,
      tx: viewRef.current.x,
      ty: viewRef.current.y,
    }
    if (svgRef.current) svgRef.current.style.cursor = 'grabbing'
  }, [])

  const handleSVGMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isPanningRef.current) return
    const dx = e.clientX - panStartRef.current.mx
    const dy = e.clientY - panStartRef.current.my
    viewRef.current = {
      ...viewRef.current,
      x: panStartRef.current.tx + dx,
      y: panStartRef.current.ty + dy,
    }
    if (graphGroupRef.current) {
      const v = viewRef.current
      graphGroupRef.current.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.scale})`)
    }
  }, [])

  const handleSVGMouseUp = useCallback(() => {
    isPanningRef.current = false
    if (svgRef.current) svgRef.current.style.cursor = 'grab'
  }, [])

  // ── Hide labels when an overlay panel is active ───────────────────────────
  useEffect(() => {
    if (!labelGroupRef.current) return
    labelGroupRef.current.style.display = centerTab === 'graph' ? '' : 'none'
  }, [centerTab])

  // ── Node event handlers ───────────────────────────────────────────────────
  const handleNodeClick = useCallback((nodeId: string, docId: string) => {
    setSelectedNode(nodeId)
    setSelectedDoc(docId)
    setCenterTab('document')
  }, [setSelectedNode, setSelectedDoc, setCenterTab])

  const handleMouseEnter = useCallback((nodeId: string, e: React.MouseEvent) => {
    setHoveredNode(nodeId)
    setTooltip({ nodeId, x: e.clientX, y: e.clientY })
  }, [setHoveredNode])

  const handleMouseLeave = useCallback(() => {
    setHoveredNode(null)
    setTooltip(null)
  }, [setHoveredNode])

  const handleNodeMouseMove = useCallback((nodeId: string, e: React.MouseEvent) => {
    setTooltip(t => t?.nodeId === nodeId ? { nodeId, x: e.clientX, y: e.clientY } : t)
  }, [])

  return (
    <div style={{ position: 'relative', width, height }} data-testid="graph-2d">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ display: 'block', cursor: 'grab' }}
        onMouseDown={handleSVGMouseDown}
        onMouseMove={handleSVGMouseMove}
        onMouseUp={handleSVGMouseUp}
        onMouseLeave={handleSVGMouseUp}
      >
        {/* Single transform group — pan/zoom applied here, sim tick updates positions inside */}
        <g ref={graphGroupRef}>
          {/* Links */}
          <g data-testid="graph-links">
            {links.map((link: GraphLink, i: number) => {
              const src = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
              const tgt = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
              return (
                <line
                  key={`${src}-${tgt}-${i}`}
                  ref={el => { if (el) linkEls.current.set(i, el) }}
                  x1={width / 2} y1={height / 2}
                  x2={width / 2} y2={height / 2}
                  stroke="var(--color-border)"
                  strokeWidth={1}
                  strokeOpacity={0.6}
                />
              )
            })}
          </g>

          {/* Selection ring */}
          {selectedNodeId && (() => {
            const node = nodes.find(n => n.id === selectedNodeId)
            if (!node) return null
            const color = SPEAKER_CONFIG[node.speaker].color
            return (
              <circle
                ref={el => { selRingEl.current = el }}
                cx={width / 2} cy={height / 2}
                r={15}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.8}
                data-testid="selection-ring"
              />
            )
          })()}

          {/* Nodes */}
          <g data-testid="graph-nodes">
            {nodes.map(node => {
              const color = SPEAKER_CONFIG[node.speaker].color
              const isSelected = selectedNodeId === node.id
              return (
                <circle
                  key={node.id}
                  ref={el => { if (el) nodeEls.current.set(node.id, el) }}
                  cx={width / 2} cy={height / 2}
                  r={isSelected ? 10 : 7}
                  fill={color}
                  fillOpacity={isSelected ? 1 : 0.82}
                  style={{
                    cursor: 'pointer',
                    filter: isSelected ? `drop-shadow(0 0 6px ${color})` : undefined,
                    transition: 'r 0.15s, fill-opacity 0.15s',
                  }}
                  onClick={() => handleNodeClick(node.id, node.docId)}
                  onMouseEnter={e => handleMouseEnter(node.id, e)}
                  onMouseLeave={handleMouseLeave}
                  onMouseMove={e => handleNodeMouseMove(node.id, e)}
                  data-node-id={node.id}
                />
              )
            })}
          </g>

          {/* Labels group — hidden when overlay panel active; positions always live-updated by tick */}
          <g ref={labelGroupRef} data-testid="graph-labels">
            {nodes.map(node => (
              <text
                key={`label-${node.id}`}
                ref={el => { if (el) labelEls.current.set(node.id, el) }}
                x={width / 2}
                y={height / 2 + LABEL_Y_OFFSET}
                textAnchor="middle"
                fontSize={11}
                fontWeight="normal"
                fill="var(--color-text-secondary)"
                stroke="var(--color-bg-primary)"
                strokeWidth={3}
                strokeLinejoin="round"
                paintOrder="stroke"
                opacity={0.95}
                pointerEvents="none"
                style={{ userSelect: 'none' }}
                data-testid={`node-label-${node.id}`}
              >
                {node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}
              </text>
            ))}
          </g>
        </g>
      </svg>

      {tooltip && <NodeTooltip nodeId={tooltip.nodeId} x={tooltip.x} y={tooltip.y} />}
    </div>
  )
}
