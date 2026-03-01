import { useRef, useState, useEffect, useCallback } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { Palette, Sparkles, X, Loader2 } from 'lucide-react'
import Graph2D from './Graph2D'
import Graph3D from './Graph3D'
import type { NodeColorMode } from '@/types'
import {
  buildDeepGraphContextFromDocId,
  buildGlobalGraphContext,
  getBfsContextDocIds,
  getGlobalContextDocIds,
} from '@/lib/graphRAG'
import { streamMessage } from '@/services/llmClient'

const COLOR_MODES: { mode: NodeColorMode; label: string }[] = [
  { mode: 'document', label: '문서' },
  { mode: 'auto',     label: '자동' },
  { mode: 'speaker',  label: '역할' },
  { mode: 'folder',   label: '폴더' },
  { mode: 'tag',      label: '태그' },
  { mode: 'topic',    label: '주제' },
]

const floatBtnStyle: React.CSSProperties = {
  background: 'var(--color-bg-overlay)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 6,
  padding: '5px 7px',
  cursor: 'pointer',
  lineHeight: 1,
  transition: 'color 0.15s',
}

interface AnalysisState {
  nodeName: string
  content: string
  loading: boolean
  phase?: '탐색 중' | '분석 중'
}

export default function GraphPanel() {
  const { graphMode, nodeColorMode, setNodeColorMode } = useUIStore()
  const { selectedNodeId, setAiHighlightNodes } = useGraphStore()
  const { loadedDocuments } = useVaultStore()
  const { personaModels } = useSettingsStore()
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null)
  const abortRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setSize({ width: e.contentRect.width, height: e.contentRect.height })
      }
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const handleAnalyze = useCallback(async () => {
    // 진행 중인 분석 중단 + 이전 하이라이트 클리어
    abortRef.current?.()
    setAiHighlightNodes([])

    // 노드 선택 O: 해당 노드 중심 BFS / 노드 선택 X: 허브 기반 전체 탐색
    let context: string
    let nodeName: string

    if (selectedNodeId) {
      const doc = loadedDocuments?.find(d => d.id === selectedNodeId)
      nodeName = doc?.filename.replace(/\.md$/i, '') ?? selectedNodeId
      context = buildDeepGraphContextFromDocId(selectedNodeId)
      setAiHighlightNodes(getBfsContextDocIds(selectedNodeId))
    } else {
      nodeName = '전체 프로젝트'
      context = buildGlobalGraphContext(35, 4)
      setAiHighlightNodes(getGlobalContextDocIds(35, 4))
    }

    if (!context) {
      setAiHighlightNodes([])
      setAnalysis({ nodeName, content: '볼트가 로드되었는지 확인하세요. 문서가 없거나 연결이 없습니다.', loading: false })
      return
    }

    // Phase 1: 그래프 탐색 완료 표시 (BFS는 동기 즉시 완료됨)
    setAnalysis({ nodeName, content: '', loading: true, phase: '탐색 중' })

    let aborted = false
    abortRef.current = () => { aborted = true }

    // 짧은 딜레이로 "탐색 중" 상태를 UI에 한 프레임 렌더링
    await new Promise<void>(r => setTimeout(r, 60))
    if (aborted) return

    // Phase 2: LLM 인사이트 생성
    setAnalysis(prev => prev ? { ...prev, phase: '분석 중' } : null)

    // 페르소나에서 기본 디렉터 선택 (첫 번째 설정된 것)
    const persona = (Object.keys(personaModels)[0] ?? 'chief_director') as Parameters<typeof streamMessage>[0]
    const prompt = selectedNodeId
      ? `"${nodeName}" 문서와 WikiLink로 연결된 모든 관련 노드들을 검토하고, 핵심 인사이트와 개선 포인트를 구체적으로 분석해주세요.`
      : `볼트 전체 문서 구조와 연결 관계를 검토하고, 프로젝트 전반의 핵심 인사이트, 공백 영역, 개선 방향을 구체적으로 분석해주세요.`

    try {
      await streamMessage(
        persona,
        prompt,
        [],
        (chunk) => {
          if (aborted) return
          setAnalysis(prev => prev ? { ...prev, content: prev.content + chunk } : null)
        },
        undefined,
        context,
      )
    } catch {
      if (!aborted) {
        setAnalysis(prev => prev ? { ...prev, content: prev.content + '\n\n[오류가 발생했습니다]', loading: false, phase: undefined } : null)
        setAiHighlightNodes([])
        return
      }
    }

    if (!aborted) {
      setAnalysis(prev => prev ? { ...prev, loading: false, phase: undefined } : null)
      setAiHighlightNodes([])
    }
  }, [selectedNodeId, loadedDocuments, personaModels, setAiHighlightNodes])

  const closeAnalysis = useCallback(() => {
    abortRef.current?.()
    setAiHighlightNodes([])
    setAnalysis(null)
  }, [setAiHighlightNodes])

  // 선택 노드가 바뀌면 이전 분석 닫기
  useEffect(() => {
    if (analysis && analysis.nodeName) closeAnalysis()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId])

  const selectedDoc = selectedNodeId
    ? loadedDocuments?.find(d => d.id === selectedNodeId)
    : null
  const selectedName = selectedDoc?.filename.replace(/\.md$/i, '') ?? selectedNodeId

  return (
    <div ref={containerRef} className="relative overflow-hidden h-full" data-testid="graph-panel">
      {size.width > 0 && size.height > 0 && (
        graphMode === '3d' && !isFast
          ? <Graph3D width={size.width} height={size.height} />
          : <Graph2D width={size.width} height={size.height} />
      )}

      {/* Bottom-left buttons */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        {/* Color mode toggle */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowColorPicker(v => !v)}
            style={{
              ...floatBtnStyle,
              color: nodeColorMode !== 'speaker' ? 'var(--color-accent)' : 'var(--color-text-muted)',
            }}
            title={`노드 색상: ${COLOR_MODES.find(m => m.mode === nodeColorMode)?.label}`}
            aria-label="Node color mode"
          >
            <Palette size={12} />
          </button>

          {showColorPicker && (
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 6,
                background: 'var(--color-bg-overlay)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 80,
                zIndex: 50,
              }}
            >
              {COLOR_MODES.map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => { setNodeColorMode(mode); setShowColorPicker(false) }}
                  style={{
                    background: nodeColorMode === mode ? 'var(--color-bg-active)' : 'transparent',
                    color: nodeColorMode === mode ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    border: 'none',
                    borderRadius: 5,
                    padding: '5px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.1s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}별 색상
                </button>
              ))}
            </div>
          )}
        </div>

        {/* AI 분석 버튼 — 항상 표시 (노드 선택 O: 노드 중심 / X: 전체 프로젝트) */}
        <button
          onClick={handleAnalyze}
          disabled={analysis?.loading}
          style={{
            ...floatBtnStyle,
            color: selectedNodeId ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            padding: '5px 10px',
            opacity: analysis?.loading ? 0.6 : 1,
          }}
          title={selectedNodeId
            ? `"${selectedName}" 노드와 연결된 문서를 AI로 분석`
            : '전체 프로젝트 문서를 AI로 분석 (허브 노드 기반)'
          }
        >
          {analysis?.loading
            ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
            : <Sparkles size={11} />
          }
          {selectedNodeId ? 'AI 분석' : 'AI 전체 분석'}
        </button>
      </div>

      {/* AI 분석 결과 패널 */}
      {analysis && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 320,
            maxHeight: 'calc(100% - 24px)',
            background: 'var(--color-bg-overlay)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 40,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          {/* 패널 헤더 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            flexShrink: 0,
          }}>
            <Sparkles size={12} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {analysis.nodeName}
            </span>
            {analysis.loading && (
              <span style={{ fontSize: 10, color: analysis.phase === '탐색 중' ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
                {analysis.phase ?? '분석 중'}…
              </span>
            )}
            <button
              onClick={closeAnalysis}
              style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 2, display: 'flex', borderRadius: 3, transition: 'color 0.1s' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
            >
              <X size={13} />
            </button>
          </div>

          {/* 분석 내용 */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: 1.7,
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {analysis.content || (analysis.loading ? '' : '분석 내용 없음')}
            {analysis.loading && !analysis.content && (
              <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                노드 연결을 탐색 중입니다…
              </span>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
