import { useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { useGraphStore } from '@/stores/graphStore'
import { useUIStore } from '@/stores/uiStore'
import { useGraphSimulation3D, type SimNode3D, type SimLink3D } from '@/hooks/useGraphSimulation3D'
import { useFrameRate } from '@/hooks/useFrameRate'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'

interface Props {
  width: number
  height: number
}

const NODE_RADIUS = 4
const RING_SEGMENTS = 64

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
  const rafRef = useRef<number>(0)
  const selRingRef = useRef<THREE.Line | null>(null)
  const particlesRef = useRef<THREE.Points | null>(null)
  const particlePosRef = useRef<Float32Array | null>(null)
  const particleOffsets = useRef<Float32Array | null>(null)
  const tickRef = useRef(0)
  const raycasterRef = useRef(new THREE.Raycaster())

  const { nodes, links, selectedNodeId, setSelectedNode } = useGraphStore()
  const { setSelectedDoc, setCenterTab, centerTab } = useUIStore()
  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId

  useFrameRate()

  // ── Tick: update node mesh positions + edge lines ──────────────────────────
  const handleTick = useCallback((nodes: SimNode3D[], links: SimLink3D[]) => {
    const meshMap = nodeMeshesRef.current
    for (const n of nodes) {
      const mesh = meshMap.get(n.id)
      if (mesh) {
        mesh.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
      }
    }

    // Update edges
    const pos = linePosRef.current
    if (pos) {
      links.forEach((link, i) => {
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

    // Update selection ring to follow selected node
    const selId = selectedNodeIdRef.current
    if (selId && selRingRef.current) {
      const n = nodes.find(x => x.id === selId)
      if (n) selRingRef.current.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
    }
  }, [])

  useGraphSimulation3D({ onTick: handleTick })

  // ── Three.js scene setup ───────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height)
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // CSS2DRenderer — renders HTML labels on top of the WebGL canvas
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
    // Idle auto-rotate: slowly spin the scene until user interacts or selects a node
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.4
    // Stop auto-rotate the moment the user grabs the camera
    const onInteractStart = () => { controls.autoRotate = false }
    controls.addEventListener('start', onInteractStart)
    controlsRef.current = controls

    // ── Nodes ────────────────────────────────────────────────────────────────
    const geo = new THREE.SphereGeometry(NODE_RADIUS, 16, 12)
    nodes.forEach(node => {
      const color = SPEAKER_CONFIG[node.speaker].hex
      const mat = new THREE.MeshBasicMaterial({ color })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.userData.nodeId = node.id
      mesh.userData.docId = node.docId
      scene.add(mesh)
      nodeMeshesRef.current.set(node.id, mesh)

      // Attach HTML label via CSS2DObject
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

    // ── Edges ────────────────────────────────────────────────────────────────
    const posArray = new Float32Array(links.length * 6)
    linePosRef.current = posArray
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3))
    lineGeoRef.current = lineGeo
    const lineMat = new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.5 })
    scene.add(new THREE.LineSegments(lineGeo, lineMat))

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

      // Camera follow: smoothly pan controls orbit-center toward selected node
      const selId = selectedNodeIdRef.current
      if (selId) {
        const mesh = nodeMeshesRef.current.get(selId)
        if (mesh) {
          controls.target.lerp(mesh.position, 0.04)
        }
      }

      controls.update()

      // Rotate selection ring
      if (selRingRef.current?.visible) {
        selRingRef.current.rotation.z += 0.008
      }

      // Drift particles
      if (particlesRef.current?.visible && particlePosRef.current && particleOffsets.current) {
        const t = tickRef.current * 0.01
        const base = selRingRef.current?.position ?? new THREE.Vector3()
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const drift = Math.sin(t + i) * 0.5
          pPos[i * 3 + 0] = base.x + offsets[i * 3 + 0] + drift
          pPos[i * 3 + 1] = base.y + offsets[i * 3 + 1] + drift
          pPos[i * 3 + 2] = base.z + offsets[i * 3 + 2]
        }
        ;(pGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      }

      renderer.render(scene, camera)
      css2dRenderer.render(scene, camera)
    }
    animate()

    return () => {
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

  // ── Selection ring visibility + stop auto-rotate on first selection ───────
  useEffect(() => {
    if (!selRingRef.current || !particlesRef.current) return
    const visible = !!selectedNodeId

    // Stop idle auto-rotate once the user has selected a node
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

        // Update ring color to match speaker
        const node = nodes.find(n => n.id === selectedNodeId)
        if (node) {
          const hex = SPEAKER_CONFIG[node.speaker].hex
          ;(selRingRef.current.material as THREE.LineDashedMaterial).color.setHex(hex)
          ;(particlesRef.current.material as THREE.PointsMaterial).color.setHex(hex)
        }
      }
    }
  }, [selectedNodeId, nodes])

  // ── CSS2DRenderer labels: hide when overlay panel is active ──────────────
  useEffect(() => {
    const css2d = css2dRendererRef.current
    if (!css2d) return
    css2d.domElement.style.display = centerTab === 'graph' ? '' : 'none'
  }, [centerTab])

  // ── Click handling ────────────────────────────────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    if (!renderer || !camera) return

    const rect = renderer.domElement.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1

    const raycaster = raycasterRef.current
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera)

    const meshes = Array.from(nodeMeshesRef.current.values())
    const hits = raycaster.intersectObjects(meshes)
    if (hits.length > 0) {
      const mesh = hits[0].object as THREE.Mesh
      const nodeId: string = mesh.userData.nodeId
      const docId: string = mesh.userData.docId
      setSelectedNode(nodeId)
      setSelectedDoc(docId)
      setCenterTab('document')
    }
  }, [setSelectedNode, setSelectedDoc, setCenterTab])

  return (
    <div
      ref={mountRef}
      style={{ width, height, overflow: 'hidden', cursor: 'grab', position: 'relative' }}
      data-testid="graph-3d"
      onClick={handleClick}
    />
  )
}
