import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { useGraphStore } from '@/stores/graphStore'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { parseVaultFiles } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
import type { LoadedDocument } from '@/types'
import { useGraphSimulation3D, type SimNode3D, type SimLink3D } from '@/hooks/useGraphSimulation3D'
import { useFrameRate } from '@/hooks/useFrameRate'
import { graphCallbacks } from '@/lib/graphEvents'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { buildNodeColorMap, getNodeColor } from '@/lib/nodeColors'
import type { GraphLink } from '@/types'
import NodeTooltip from './NodeTooltip'

interface Props {
  width: number
  height: number
}

const NODE_RADIUS = 4
const RING_SEGMENTS = 64
// Default edge color: #444444 normalised to [0,1]
const EDGE_DEF_R = 0x44 / 0xff
const EDGE_DEF_G = 0x44 / 0xff
const EDGE_DEF_B = 0x44 / 0xff

export default function Graph3D({ width, height }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const css2dRendererRef = useRef<CSS2DRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const nodeMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const lineGeoRef = useRef<THREE.BufferGeometry | null>(null)
  const linePosRef = useRef<Float32Array | null>(null)
  const lineColorArrayRef = useRef<Float32Array | null>(null)
  const lineColorAttrRef = useRef<THREE.BufferAttribute | null>(null)
  const lineMatRef = useRef<THREE.LineBasicMaterial | null>(null)
  const rafRef = useRef<number>(0)
  const selRingRef = useRef<THREE.Line | null>(null)
  const particlesRef = useRef<THREE.Points | null>(null)
  const particlePosRef = useRef<Float32Array | null>(null)
  const particleOffsets = useRef<Float32Array | null>(null)
  const tickRef = useRef(0)
  const raycasterRef = useRef(new THREE.Raycaster())

  // Drag state
  const draggingNodeIdRef = useRef<string | null>(null)
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane())
  const isDraggingRef = useRef(false)
  // Hover: local ref avoids store updates on every mousemove frame
  const lastHoveredRef = useRef<string | null>(null)
  // Adjacency map: nodeId → Set<linkIndex>
  const adjacencyRef = useRef<Map<string, Set<number>>>(new Map())

  const { nodes, links, selectedNodeId, hoveredNodeId, setSelectedNode, setHoveredNode, setNodes, setLinks, physics } = useGraphStore()
  const { setSelectedDoc, setCenterTab, centerTab, nodeColorMode, openInEditor } = useUIStore()
  const { vaultPath, loadedDocuments, setLoadedDocuments } = useVaultStore()
  const colorRules = useSettingsStore(s => s.colorRules)
  const tagColors = useSettingsStore(s => s.tagColors)
  const folderColors = useSettingsStore(s => s.folderColors)

  // Build color lookup map whenever nodes or color mode changes
  const nodeColorMap = useMemo(
    () => buildNodeColorMap(nodes, nodeColorMode, tagColors, folderColors),
    [nodes, nodeColorMode, tagColors, folderColors]
  )
  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId

  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null)

  useFrameRate()

  // ── Update node colors when color mode changes ────────────────────────────
  useEffect(() => {
    const meshMap = nodeMeshesRef.current
    nodes.forEach(node => {
      const mesh = meshMap.get(node.id)
      if (mesh) {
        const mat = mesh.material as THREE.MeshBasicMaterial
        mat.color.set(getNodeColor(node, nodeColorMode, nodeColorMap, colorRules))
      }
    })
  }, [nodes, nodeColorMode, nodeColorMap])

  // ── Build adjacency map whenever links change ──────────────────────────────
  useEffect(() => {
    const map = new Map<string, Set<number>>()
    links.forEach((link: GraphLink, i: number) => {
      const src = typeof link.source === 'string' ? link.source : (link.source as { id: string }).id
      const tgt = typeof link.target === 'string' ? link.target : (link.target as { id: string }).id
      if (!map.has(src)) map.set(src, new Set())
      if (!map.has(tgt)) map.set(tgt, new Set())
      map.get(src)!.add(i)
      map.get(tgt)!.add(i)
    })
    adjacencyRef.current = map
  }, [links])

  // ── Tick: update node mesh positions + edge lines ──────────────────────────
  const handleTick = useCallback((simNodes: SimNode3D[], simLinks: SimLink3D[]) => {
    const meshMap = nodeMeshesRef.current
    for (const n of simNodes) {
      const mesh = meshMap.get(n.id)
      if (mesh) {
        mesh.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
      }
    }

    // Update edge positions
    const pos = linePosRef.current
    if (pos) {
      simLinks.forEach((link, i) => {
        const src = link.source as SimNode3D
        const tgt = link.target as SimNode3D
        const base = i * 6
        pos[base + 0] = src.x ?? 0; pos[base + 1] = src.y ?? 0; pos[base + 2] = src.z ?? 0
        pos[base + 3] = tgt.x ?? 0; pos[base + 4] = tgt.y ?? 0; pos[base + 5] = tgt.z ?? 0
      })
      if (lineGeoRef.current) {
        const attr = lineGeoRef.current.getAttribute('position') as THREE.BufferAttribute
        attr.needsUpdate = true
      }
    }

    // Keep selection ring + particles tracking selected node
    const selId = selectedNodeIdRef.current
    if (selId && selRingRef.current) {
      const n = simNodes.find(x => x.id === selId)
      if (n) {
        selRingRef.current.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
        if (particlesRef.current) {
          particlesRef.current.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
        }
      }
    }
  }, [])

  const { simRef, simNodesRef } = useGraphSimulation3D({ onTick: handleTick })

  // ── Three.js scene setup ───────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // WebGL renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height)
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // CSS2DRenderer — HTML labels on top of WebGL canvas
    const css2dRenderer = new CSS2DRenderer()
    css2dRenderer.setSize(width, height)
    css2dRenderer.domElement.style.position = 'absolute'
    css2dRenderer.domElement.style.top = '0'
    css2dRenderer.domElement.style.left = '0'
    css2dRenderer.domElement.style.pointerEvents = 'none'
    mount.appendChild(css2dRenderer.domElement)
    css2dRendererRef.current = css2dRenderer

    // Scene + camera
    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(60, width / height, 1, 2000)
    camera.position.set(0, 0, 350)
    cameraRef.current = camera

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.4
    const onInteractStart = () => { controls.autoRotate = false }
    controls.addEventListener('start', onInteractStart)
    controlsRef.current = controls

    // Register camera reset callback for PhysicsControls
    graphCallbacks.resetCamera = () => {
      controls.reset()
    }

    // ── Nodes ────────────────────────────────────────────────────────────────
    const geo = new THREE.SphereGeometry(NODE_RADIUS, 16, 12)
    nodes.forEach(node => {
      const color = getNodeColor(node, nodeColorMode, nodeColorMap, colorRules)
      // transparent: true so we can dim opacity for non-neighbors
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1.0 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.userData.nodeId = node.id
      mesh.userData.docId = node.docId
      scene.add(mesh)
      nodeMeshesRef.current.set(node.id, mesh)

      // HTML label via CSS2DObject
      const labelDiv = document.createElement('div')
      labelDiv.textContent = node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label
      labelDiv.style.fontSize = '11px'
      labelDiv.style.fontWeight = 'normal'
      labelDiv.style.color = '#e3e2de'
      labelDiv.style.pointerEvents = 'none'
      labelDiv.style.whiteSpace = 'nowrap'
      labelDiv.style.textShadow = '0 0 6px #000, 0 0 4px #000, 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000'
      labelDiv.style.opacity = '0.95'
      labelDiv.style.userSelect = 'none'
      labelDiv.style.letterSpacing = '0.01em'
      const labelObj = new CSS2DObject(labelDiv)
      labelObj.position.set(0, -NODE_RADIUS - 6, 0)
      mesh.add(labelObj)
    })

    // ── Edges with vertex colors for per-edge highlight ─────────────────────
    const posArray = new Float32Array(links.length * 6)
    linePosRef.current = posArray

    // Vertex color buffer: 2 vertices per edge × 3 RGB components
    const colorArray = new Float32Array(links.length * 6)
    for (let i = 0; i < links.length * 2; i++) {
      colorArray[i * 3 + 0] = EDGE_DEF_R
      colorArray[i * 3 + 1] = EDGE_DEF_G
      colorArray[i * 3 + 2] = EDGE_DEF_B
    }
    lineColorArrayRef.current = colorArray

    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3))
    const colorAttr = new THREE.BufferAttribute(colorArray, 3)
    lineGeo.setAttribute('color', colorAttr)
    lineColorAttrRef.current = colorAttr
    lineGeoRef.current = lineGeo

    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: physics.linkOpacity })
    lineMatRef.current = lineMat
    const lineSegments = new THREE.LineSegments(lineGeo, lineMat)
    lineSegments.frustumCulled = false  // edges span the whole scene — never cull
    scene.add(lineSegments)

    // ── Selection ring (initially hidden) ─────────────────────────────────────
    const ringPoints: THREE.Vector3[] = []
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const angle = (i / RING_SEGMENTS) * Math.PI * 2
      ringPoints.push(new THREE.Vector3(Math.cos(angle) * 12, Math.sin(angle) * 12, 0))
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints)
    const ringMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 3, gapSize: 2 })
    const ring = new THREE.Line(ringGeo, ringMat)
    ring.computeLineDistances()
    ring.visible = false
    scene.add(ring)
    selRingRef.current = ring

    // ── Particles ─────────────────────────────────────────────────────────────
    const PARTICLE_COUNT = 20
    const pPos = new Float32Array(PARTICLE_COUNT * 3)
    const offsets = new Float32Array(PARTICLE_COUNT * 3)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      const r = 12 + Math.random() * 8
      offsets[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta)
      offsets[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      offsets[i * 3 + 2] = r * Math.cos(phi)
    }
    particlePosRef.current = pPos
    particleOffsets.current = offsets
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
    const pMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2 })
    const pts = new THREE.Points(pGeo, pMat)
    pts.visible = false
    scene.add(pts)
    particlesRef.current = pts

    // ── Animation loop ────────────────────────────────────────────────────────
    function animate() {
      rafRef.current = requestAnimationFrame(animate)
      tickRef.current++

      const selId = selectedNodeIdRef.current
      if (selId) {
        const mesh = nodeMeshesRef.current.get(selId)
        if (mesh) {
          controls.target.lerp(mesh.position, 0.04)
        }
      }

      controls.update()

      if (selRingRef.current?.visible) {
        selRingRef.current.rotation.z += 0.008
      }

      if (particlesRef.current?.visible && particlePosRef.current && particleOffsets.current) {
        const t = tickRef.current * 0.01
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const drift = Math.sin(t + i) * 0.5
          pPos[i * 3 + 0] = offsets[i * 3 + 0] + drift
          pPos[i * 3 + 1] = offsets[i * 3 + 1] + drift
          pPos[i * 3 + 2] = offsets[i * 3 + 2]
        }
        ;(pGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      }

      renderer.render(scene, camera)
      css2dRenderer.render(scene, camera)
    }
    animate()

    return () => {
      graphCallbacks.resetCamera = null
      cancelAnimationFrame(rafRef.current)
      controls.removeEventListener('start', onInteractStart)
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      if (css2dRenderer.domElement.parentNode) {
        mount.removeChild(css2dRenderer.domElement)
      }
      css2dRendererRef.current = null
      geo.dispose()
      lineGeo.dispose()
      ringGeo.dispose()
      pGeo.dispose()
      nodeMeshesRef.current.clear()
      linePosRef.current = null
      lineColorArrayRef.current = null
      lineColorAttrRef.current = null
      lineMatRef.current = null
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      selRingRef.current = null
      particlesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links])

  // ── Resize ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    if (!renderer || !camera) return
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    css2dRendererRef.current?.setSize(width, height)
  }, [width, height])

  // ── Selection ring visibility + stop auto-rotate ──────────────────────────
  useEffect(() => {
    if (!selRingRef.current || !particlesRef.current) return
    const visible = !!selectedNodeId

    if (visible && controlsRef.current) {
      controlsRef.current.autoRotate = false
    }

    selRingRef.current.visible = visible
    particlesRef.current.visible = visible

    if (visible && selectedNodeId) {
      const mesh = nodeMeshesRef.current.get(selectedNodeId)
      if (mesh) {
        selRingRef.current.position.copy(mesh.position)
        particlesRef.current.position.copy(mesh.position)

        const node = nodes.find(n => n.id === selectedNodeId)
        if (node) {
          const hex = SPEAKER_CONFIG[node.speaker].hex
          ;(selRingRef.current.material as THREE.LineDashedMaterial).color.setHex(hex)
          ;(particlesRef.current.material as THREE.PointsMaterial).color.setHex(hex)
        }
      }
    }
  }, [selectedNodeId, nodes])

  // ── Wire opacity 실시간 반영 ─────────────────────────────────────────────
  useEffect(() => {
    if (lineMatRef.current) {
      lineMatRef.current.opacity = physics.linkOpacity
      lineMatRef.current.needsUpdate = true
    }
  }, [physics.linkOpacity])

  // ── CSS2DRenderer labels: hide when overlay panel is active ──────────────
  useEffect(() => {
    const css2d = css2dRendererRef.current
    if (!css2d) return
    css2d.domElement.style.display = centerTab === 'graph' ? '' : 'none'
  }, [centerTab])

  // ── Neighbor highlight when hoveredNodeId changes ─────────────────────────
  useEffect(() => {
    const meshMap = nodeMeshesRef.current
    const colorArray = lineColorArrayRef.current
    const colorAttr = lineColorAttrRef.current

    if (!hoveredNodeId) {
      // Reset all nodes to full opacity
      nodes.forEach(n => {
        const mesh = meshMap.get(n.id)
        if (mesh) (mesh.material as THREE.MeshBasicMaterial).opacity = 1.0
      })
      // Reset all edge colors to default
      if (colorArray) {
        for (let v = 0; v < links.length * 2; v++) {
          colorArray[v * 3 + 0] = EDGE_DEF_R
          colorArray[v * 3 + 1] = EDGE_DEF_G
          colorArray[v * 3 + 2] = EDGE_DEF_B
        }
        if (colorAttr) colorAttr.needsUpdate = true
      }
      return
    }

    // Collect neighboring link indices and node IDs
    const neighborLinkIdxs = adjacencyRef.current.get(hoveredNodeId) ?? new Set<number>()
    const neighborIds = new Set<string>([hoveredNodeId])
    links.forEach((link: GraphLink, i: number) => {
      if (neighborLinkIdxs.has(i)) {
        const src = typeof link.source === 'string' ? link.source : (link.source as { id: string }).id
        const tgt = typeof link.target === 'string' ? link.target : (link.target as { id: string }).id
        neighborIds.add(src)
        neighborIds.add(tgt)
      }
    })

    // Use hovered node's speaker color as accent
    const hovNode = nodes.find(n => n.id === hoveredNodeId)
    const accentHex = hovNode ? SPEAKER_CONFIG[hovNode.speaker].hex : 0xffffff
    const accentR = ((accentHex >> 16) & 0xff) / 0xff
    const accentG = ((accentHex >> 8) & 0xff) / 0xff
    const accentB = (accentHex & 0xff) / 0xff

    // Dim non-neighbor nodes; keep neighbors fully opaque
    nodes.forEach(n => {
      const mesh = meshMap.get(n.id)
      if (!mesh) return
      ;(mesh.material as THREE.MeshBasicMaterial).opacity = neighborIds.has(n.id) ? 1.0 : 0.1
    })

    // Update edge vertex colors: neighbor → accent, others → very dark
    if (colorArray && colorAttr) {
      links.forEach((_: GraphLink, i: number) => {
        const isNeighbor = neighborLinkIdxs.has(i)
        // Each edge = 2 vertices in LineSegments; layout: vertex (2*i+v), offset (i*6 + v*3)
        for (let v = 0; v < 2; v++) {
          const base = i * 6 + v * 3
          if (isNeighbor) {
            colorArray[base + 0] = accentR
            colorArray[base + 1] = accentG
            colorArray[base + 2] = accentB
          } else {
            colorArray[base + 0] = 0.04
            colorArray[base + 1] = 0.04
            colorArray[base + 2] = 0.04
          }
        }
      })
      colorAttr.needsUpdate = true
    }
  }, [hoveredNodeId, nodes, links])

  // ── Helper: screen coords → NDC (Normalized Device Coordinates) ───────────
  const getNDC = useCallback((clientX: number, clientY: number): THREE.Vector2 => {
    const renderer = rendererRef.current
    if (!renderer) return new THREE.Vector2(0, 0)
    const rect = renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
  }, [])

  // ── Global mouseup: release drag even when mouse leaves the component ─────
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (!draggingNodeIdRef.current) return
      const simNode = simNodesRef.current.find(n => n.id === draggingNodeIdRef.current)
      if (simNode) {
        simNode.fx = null
        simNode.fy = null
        simNode.fz = null
      }
      ;(simRef.current as any)?.alphaTarget(0)
      if (controlsRef.current) controlsRef.current.enabled = true
      draggingNodeIdRef.current = null
      isDraggingRef.current = false
      setHoveredNode(null)
      lastHoveredRef.current = null
      setTooltip(null)
    }
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [simNodesRef, simRef, setHoveredNode])

  // ── Mouse down: start drag or just hover ──────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    if (!renderer || !camera) return

    const ndc = getNDC(e.clientX, e.clientY)
    raycasterRef.current.setFromCamera(ndc, camera)

    const meshes = Array.from(nodeMeshesRef.current.values())
    const hits = raycasterRef.current.intersectObjects(meshes)
    if (hits.length === 0) return

    const mesh = hits[0].object as THREE.Mesh
    const nodeId: string = mesh.userData.nodeId

    // Create drag plane: camera-facing, through the hit point
    const camDir = camera.getWorldDirection(new THREE.Vector3())
    dragPlaneRef.current.setFromNormalAndCoplanarPoint(camDir, hits[0].point)

    // Pin the node in the simulation
    const simNode = simNodesRef.current.find(n => n.id === nodeId)
    if (simNode) {
      simNode.fx = simNode.x
      simNode.fy = simNode.y
      simNode.fz = simNode.z
      ;(simRef.current as any)?.alphaTarget(0.3).restart()
    }

    // Disable orbit controls while dragging a node
    if (controlsRef.current) controlsRef.current.enabled = false

    draggingNodeIdRef.current = nodeId
    isDraggingRef.current = false

    // Set hover immediately for visual feedback
    if (nodeId !== lastHoveredRef.current) {
      lastHoveredRef.current = nodeId
      setHoveredNode(nodeId)
    }
    setTooltip({ nodeId, x: e.clientX, y: e.clientY })
  }, [getNDC, simNodesRef, simRef, setHoveredNode])

  // ── Mouse move: update drag position OR detect hover ─────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    if (!renderer || !camera) return

    const ndc = getNDC(e.clientX, e.clientY)
    raycasterRef.current.setFromCamera(ndc, camera)

    if (draggingNodeIdRef.current) {
      // Move dragged node: intersect ray with drag plane
      isDraggingRef.current = true
      const intersection = new THREE.Vector3()
      if (raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, intersection)) {
        const simNode = simNodesRef.current.find(n => n.id === draggingNodeIdRef.current)
        if (simNode) {
          simNode.fx = intersection.x
          simNode.fy = intersection.y
          simNode.fz = intersection.z
          ;(simRef.current as any)?.alphaTarget(0.3).restart()
        }
      }
      // Update tooltip position
      setTooltip({ nodeId: draggingNodeIdRef.current, x: e.clientX, y: e.clientY })
      return
    }

    // Hover detection via raycasting (not dragging)
    const meshes = Array.from(nodeMeshesRef.current.values())
    const hits = raycasterRef.current.intersectObjects(meshes)
    const newHoverId = hits.length > 0
      ? (hits[0].object as THREE.Mesh).userData.nodeId as string
      : null

    if (newHoverId !== lastHoveredRef.current) {
      lastHoveredRef.current = newHoverId
      setHoveredNode(newHoverId)
      setTooltip(newHoverId ? { nodeId: newHoverId, x: e.clientX, y: e.clientY } : null)
    } else if (newHoverId) {
      // Same node but update position
      setTooltip({ nodeId: newHoverId, x: e.clientX, y: e.clientY })
    }
  }, [getNDC, simNodesRef, simRef, setHoveredNode])

  // ── Mouse up: release drag; if no movement happened → treat as click ──────
  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const draggedNodeId = draggingNodeIdRef.current
    const wasActualDrag = isDraggingRef.current

    if (draggedNodeId) {
      // Release the pin
      const simNode = simNodesRef.current.find(n => n.id === draggedNodeId)
      if (simNode) {
        simNode.fx = null
        simNode.fy = null
        simNode.fz = null
      }
      ;(simRef.current as any)?.alphaTarget(0)
      if (controlsRef.current) controlsRef.current.enabled = true
      draggingNodeIdRef.current = null
      isDraggingRef.current = false

      // No movement → treat as click: select node + navigate to document
      if (!wasActualDrag) {
        const mesh = nodeMeshesRef.current.get(draggedNodeId)
        if (mesh) {
          const docId = mesh.userData.docId as string
          setSelectedNode(draggedNodeId)
          setSelectedDoc(docId)

          if (docId.startsWith('_phantom_')) {
            // Phantom node: create the file and open in editor
            const node = nodes.find(n => n.id === docId)
            const label = node?.label ?? docId.replace('_phantom_', '')
            if (vaultPath && window.vaultAPI) {
              const sep = vaultPath.includes('\\') ? '\\' : '/'
              const newPath = `${vaultPath}${sep}${label}.md`
              window.vaultAPI.saveFile(newPath, `# ${label}\n\n`).then(() => {
                return window.vaultAPI!.loadFiles(vaultPath)
              }).then(({ files }) => {
                if (!files) return
                const docs = parseVaultFiles(files) as LoadedDocument[]
                setLoadedDocuments(docs)
                const { nodes: newNodes, links: newLinks } = buildGraph(docs)
                setNodes(newNodes)
                setLinks(newLinks)
                const newDoc = docs.find(d =>
                  d.absolutePath.replace(/\\/g, '/') === newPath.replace(/\\/g, '/')
                )
                if (newDoc) openInEditor(newDoc.id)
              }).catch((e: unknown) => {
                console.error('[Graph3D] phantom node file creation failed:', e)
              })
            }
          } else {
            openInEditor(docId)
          }
        }
      }
    }

    // Clear hover on release (mousemove will re-detect if still hovering)
    setHoveredNode(null)
    lastHoveredRef.current = null
    setTooltip(null)
  }, [simNodesRef, simRef, setSelectedNode, setSelectedDoc, setCenterTab, setHoveredNode,
      openInEditor, nodes, vaultPath, loadedDocuments, setLoadedDocuments, setNodes, setLinks])

  // ── Mouse leave: clear hover when cursor leaves the 3D area ──────────────
  const handleMouseLeave = useCallback(() => {
    if (draggingNodeIdRef.current) return  // keep hover during drag
    if (lastHoveredRef.current !== null) {
      lastHoveredRef.current = null
      setHoveredNode(null)
      setTooltip(null)
    }
  }, [setHoveredNode])

  return (
    <div
      ref={mountRef}
      style={{
        width,
        height,
        overflow: 'hidden',
        cursor: draggingNodeIdRef.current ? 'grabbing' : 'grab',
        position: 'relative',
      }}
      data-testid="graph-3d"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {tooltip && <NodeTooltip nodeId={tooltip.nodeId} x={tooltip.x} y={tooltip.y} />}
    </div>
  )
}
