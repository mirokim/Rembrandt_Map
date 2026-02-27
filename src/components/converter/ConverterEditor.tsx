/**
 * ConverterEditor — MD 변환 에디터 (중앙 패널 'editor' 탭)
 *
 * 3단계 파이프라인:
 *   Stage 1 — 입력: 텍스트 붙여넣기 또는 파일 업로드 + 메타데이터
 *   Stage 2 — AI 처리: Claude가 키워드 추출 + Obsidian 구조 생성 (스트리밍)
 *   Stage 3 — 검토·승인: 편집 가능 textarea + 키워드 칩 + 저장/다운로드
 */

import { useState, useRef } from 'react'
import { ChevronLeft, ArrowRight, Check, Download, Save, RotateCcw, Upload } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'
import { convertToObsidianMD } from '@/services/llmClient'
import { readFileAsText, type ConversionMeta, type ConversionType } from '@/lib/mdConverter'
import { cn } from '@/lib/utils'

// ── Constants ──────────────────────────────────────────────────────────────────

const SPEAKERS = [
  { id: 'chief_director', label: 'Chief' },
  { id: 'art_director',   label: 'Art' },
  { id: 'plan_director',  label: 'Plan' },
  { id: 'level_director', label: 'Level' },
  { id: 'prog_director',  label: 'Prog' },
] as const

const DOC_TYPES: ConversionType[] = ['회의록', '보고서', '기획서', '기타']

type Stage = 'input' | 'processing' | 'review'

type Step2State = 'pending' | 'running' | 'done'

interface Step2Status {
  analyze: Step2State   // 문서 분석
  keywords: Step2State  // 키워드 추출
  structure: Step2State // MD 구조 생성
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function safeName(title: string): string {
  return (title.trim() || '변환_문서')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 60)
}

// Parse KEYWORDS line from Claude output
function parseKeywords(text: string): string[] {
  const firstLine = text.split('\n')[0] ?? ''
  if (!firstLine.startsWith('KEYWORDS:')) return []
  return firstLine
    .replace('KEYWORDS:', '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
}

// Strip KEYWORDS header line + separator to get the MD body
function extractMdBody(text: string): string {
  // Remove leading "KEYWORDS: ..." line and optional blank line + "---" separator
  const withoutKeywords = text.replace(/^KEYWORDS:.*\n?/, '')
  const withoutSep = withoutKeywords.replace(/^\n?---\n/, '')
  return withoutSep.trim()
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepIndicator({
  stage,
  step2Status,
}: {
  stage: Stage
  step2Status: Step2Status
}) {
  const steps: { key: Stage | 'processing'; label: string }[] = [
    { key: 'input',      label: '1. 입력' },
    { key: 'processing', label: '2. AI 처리' },
    { key: 'review',     label: '3. 검토·승인' },
  ]

  return (
    <div
      className="flex items-center gap-0 px-4 py-2 shrink-0"
      style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
    >
      {steps.map((step, i) => {
        const isActive = stage === step.key || (stage === 'processing' && step.key === 'processing')
        const isDone =
          (step.key === 'input' && (stage === 'processing' || stage === 'review')) ||
          (step.key === 'processing' && stage === 'review')
        return (
          <div key={step.key} className="flex items-center">
            {i > 0 && (
              <ArrowRight size={12} style={{ color: 'var(--color-text-muted)', margin: '0 6px' }} />
            )}
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{
                color: isDone
                  ? 'var(--color-accent)'
                  : isActive
                  ? 'var(--color-text-primary)'
                  : 'var(--color-text-muted)',
                fontWeight: isActive ? 600 : 400,
                background: isActive ? 'var(--color-bg-hover)' : 'transparent',
              }}
            >
              {isDone ? '✓ ' : ''}{step.label}
            </span>
          </div>
        )
      })}

      {/* Sub-steps for stage 2 */}
      {stage === 'processing' && (
        <div className="flex items-center gap-3 ml-6">
          {([
            { key: 'analyze',  label: '문서 분석' },
            { key: 'keywords', label: '키워드 추출' },
            { key: 'structure',label: 'MD 생성' },
          ] as const).map(s => (
            <span
              key={s.key}
              className="text-xs flex items-center gap-1"
              style={{ color: step2Status[s.key] === 'done' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
            >
              {step2Status[s.key] === 'done' ? '✓' : step2Status[s.key] === 'running' ? '⟳' : '○'}
              {' '}{s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ConverterEditor() {
  const { setCenterTab } = useUIStore()
  const { vaultPath } = useVaultStore()

  // Stage
  const [stage, setStage] = useState<Stage>('input')
  const [inputTab, setInputTab] = useState<'paste' | 'upload'>('paste')

  // Stage 1 state
  const [content, setContent] = useState('')
  const [meta, setMeta] = useState<ConversionMeta>({
    title: '',
    speaker: 'chief_director',
    date: today(),
    type: '회의록',
  })
  const [uploadFileName, setUploadFileName] = useState('')
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Stage 2 state
  const [streamedText, setStreamedText] = useState('')
  const [step2Status, setStep2Status] = useState<Step2Status>({
    analyze: 'pending', keywords: 'pending', structure: 'pending',
  })
  const [processError, setProcessError] = useState('')

  // Stage 3 state
  const [keywords, setKeywords] = useState<string[]>([])
  const [finalMd, setFinalMd] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleFileSelect = async (file: File) => {
    setUploadError('')
    setUploadFileName(file.name)
    try {
      const text = await readFileAsText(file)
      setContent(text)
      if (!meta.title) {
        setMeta(m => ({ ...m, title: file.name.replace(/\.[^.]+$/, '') }))
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '파일 읽기 실패')
    }
  }

  const handleStartConversion = async () => {
    if (!content.trim()) return
    setStage('processing')
    setStreamedText('')
    setProcessError('')
    setStep2Status({ analyze: 'running', keywords: 'pending', structure: 'pending' })

    let buffer = ''
    let keywordsParsed = false

    // Mark analyze as done after first token arrives
    let firstChunk = true

    try {
      await convertToObsidianMD(content, meta, (chunk: string) => {
        buffer += chunk
        setStreamedText(buffer)

        if (firstChunk) {
          firstChunk = false
          setStep2Status(s => ({ ...s, analyze: 'done', keywords: 'running' }))
        }

        // Parse keywords once the first line is complete
        if (!keywordsParsed && buffer.includes('\n')) {
          const kws = parseKeywords(buffer)
          if (kws.length > 0) {
            setKeywords(kws)
            keywordsParsed = true
            setStep2Status(s => ({ ...s, keywords: 'done', structure: 'running' }))
          }
        }
      })

      // Conversion complete
      setStep2Status({ analyze: 'done', keywords: 'done', structure: 'done' })
      setFinalMd(extractMdBody(buffer))
      setTimeout(() => setStage('review'), 400)
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : '변환 중 오류 발생')
      setStep2Status(s => ({ ...s, structure: 'pending' }))
    }
  }

  const handleSaveToVault = async () => {
    if (!vaultPath) {
      setSaveStatus('error')
      return
    }
    setSaveStatus('saving')
    const filename = `${safeName(meta.title)}.md`
    const fullPath = `${vaultPath}/${filename}`
    try {
      await window.vaultAPI?.saveFile(fullPath, finalMd)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch {
      setSaveStatus('error')
    }
  }

  const handleDownload = () => {
    const filename = `${safeName(meta.title)}.md`
    const blob = new Blob([finalMd], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setStage('input')
    setStreamedText('')
    setKeywords([])
    setFinalMd('')
    setSaveStatus('idle')
    setStep2Status({ analyze: 'pending', keywords: 'pending', structure: 'pending' })
    setProcessError('')
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const canStart = content.trim().length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div
        className="flex items-center shrink-0 gap-1 px-2"
        style={{ height: 34, borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
      >
        <button
          onClick={() => setCenterTab('graph')}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{ color: 'var(--color-text-muted)' }}
          title="그래프로 돌아가기"
        >
          <ChevronLeft size={12} />
          Graph
        </button>
        <span
          className="text-xs font-medium px-2"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          ✏️ MD 변환 에디터
        </span>
      </div>

      {/* Step indicator */}
      <StepIndicator stage={stage} step2Status={step2Status} />

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">

        {/* ── STAGE 1: 입력 ─────────────────────────────────────────────── */}
        {stage === 'input' && (
          <div className="flex flex-col gap-4 max-w-2xl mx-auto">

            {/* Input tabs */}
            <div className="flex gap-1">
              {(['paste', 'upload'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setInputTab(t)}
                  className={cn('px-3 py-1.5 text-xs rounded transition-colors', inputTab === t && 'font-medium')}
                  style={{
                    background: inputTab === t ? 'var(--color-bg-hover)' : 'transparent',
                    color: inputTab === t ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {t === 'paste' ? '붙여넣기' : '파일 업로드'}
                </button>
              ))}
            </div>

            {/* Text input */}
            {inputTab === 'paste' && (
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="원문 텍스트를 여기에 붙여넣기하세요..."
                rows={10}
                className="w-full resize-none rounded-lg px-3 py-2 text-sm"
                style={{
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                  outline: 'none',
                  lineHeight: 1.6,
                }}
              />
            )}

            {/* File upload */}
            {inputTab === 'upload' && (
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-lg p-8 cursor-pointer transition-colors hover:bg-[var(--color-bg-hover)]"
                style={{ border: '1.5px dashed var(--color-border)' }}
                onClick={() => fileInputRef.current?.click()}
                onDrop={e => {
                  e.preventDefault()
                  const f = e.dataTransfer.files[0]
                  if (f) handleFileSelect(f)
                }}
                onDragOver={e => e.preventDefault()}
              >
                <Upload size={24} style={{ color: 'var(--color-text-muted)' }} />
                <div className="text-center">
                  <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    파일을 드래그하거나 클릭하여 업로드
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    .txt .md .docx .pdf
                  </div>
                </div>
                {uploadFileName && (
                  <div className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
                    ✓ {uploadFileName}
                  </div>
                )}
                {uploadError && (
                  <div className="text-xs" style={{ color: '#e74c3c' }}>{uploadError}</div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.docx,.pdf"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f) }}
                />
              </div>
            )}

            {/* Metadata form */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}>제목</label>
                <input
                  value={meta.title}
                  onChange={e => setMeta(m => ({ ...m, title: e.target.value }))}
                  placeholder="문서 제목 (Obsidian 파일명)"
                  className="w-full px-3 py-1.5 text-sm rounded"
                  style={{
                    background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    outline: 'none',
                  }}
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}>스피커</label>
                <select
                  value={meta.speaker}
                  onChange={e => setMeta(m => ({ ...m, speaker: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm rounded"
                  style={{
                    background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    outline: 'none',
                  }}
                >
                  {SPEAKERS.map(s => (
                    <option key={s.id} value={s.id}>{s.label} ({s.id})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}>날짜</label>
                <input
                  type="date"
                  value={meta.date}
                  onChange={e => setMeta(m => ({ ...m, date: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm rounded"
                  style={{
                    background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    outline: 'none',
                    colorScheme: 'dark',
                  }}
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}>유형</label>
                <select
                  value={meta.type}
                  onChange={e => setMeta(m => ({ ...m, type: e.target.value as ConversionType }))}
                  className="w-full px-3 py-1.5 text-sm rounded"
                  style={{
                    background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                    outline: 'none',
                  }}
                >
                  {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* Start button */}
            <div className="flex justify-end">
              <button
                onClick={handleStartConversion}
                disabled={!canStart}
                className="flex items-center gap-2 px-5 py-2 rounded text-sm font-medium transition-colors disabled:opacity-40"
                style={{
                  background: canStart ? 'var(--color-accent)' : 'var(--color-bg-surface)',
                  color: canStart ? '#fff' : 'var(--color-text-muted)',
                }}
              >
                AI 변환 시작
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* ── STAGE 2: AI 처리 ──────────────────────────────────────────── */}
        {stage === 'processing' && (
          <div className="flex flex-col gap-4 max-w-2xl mx-auto">
            <div className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Claude가 문서를 분석하고 있습니다...
            </div>

            {/* Streaming output */}
            <div
              className="rounded-lg px-3 py-3 text-xs font-mono overflow-y-auto"
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-secondary)',
                minHeight: 240,
                maxHeight: 480,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {streamedText || (
                <span style={{ color: 'var(--color-text-muted)' }}>대기 중...</span>
              )}
              {/* Blinking cursor */}
              <span
                style={{
                  display: 'inline-block',
                  width: '0.5em',
                  height: '1em',
                  background: 'var(--color-accent)',
                  marginLeft: 2,
                  verticalAlign: 'middle',
                  animation: 'blink 1s step-end infinite',
                  opacity: 0.8,
                }}
                aria-hidden="true"
              />
            </div>

            {processError && (
              <div
                className="text-xs px-3 py-2 rounded"
                style={{ background: '#3d1a1a', color: '#e74c3c', border: '1px solid #5a2020' }}
              >
                오류: {processError}
                <button
                  onClick={handleReset}
                  className="ml-3 underline"
                  style={{ color: 'var(--color-accent)' }}
                >
                  처음부터 다시
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── STAGE 3: 검토·승인 ────────────────────────────────────────── */}
        {stage === 'review' && (
          <div className="flex flex-col gap-4 max-w-2xl mx-auto">

            {/* Keyword chips */}
            {keywords.length > 0 && (
              <div>
                <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
                  추출된 키워드
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {keywords.map(kw => (
                    <span
                      key={kw}
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: 'var(--color-bg-hover)',
                        color: 'var(--color-accent)',
                        border: '1px solid var(--color-accent)',
                      }}
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Editable MD textarea */}
            <div>
              <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
                생성된 마크다운 (편집 가능)
              </div>
              <textarea
                value={finalMd}
                onChange={e => setFinalMd(e.target.value)}
                rows={20}
                className="w-full resize-none rounded-lg px-3 py-3 text-xs font-mono"
                style={{
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                  outline: 'none',
                  lineHeight: 1.7,
                }}
                spellCheck={false}
              />
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
              >
                <RotateCcw size={12} />
                다시 편집
              </button>

              <div className="flex-1" />

              {/* Save to vault */}
              <button
                onClick={handleSaveToVault}
                disabled={!vaultPath || saveStatus === 'saving'}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded font-medium transition-colors disabled:opacity-40"
                style={{
                  background: saveStatus === 'saved' ? '#2ecc71' : 'var(--color-accent)',
                  color: '#fff',
                }}
                title={!vaultPath ? '볼트를 먼저 선택하세요 (⚙️ Settings)' : undefined}
              >
                {saveStatus === 'saving' ? (
                  '저장 중...'
                ) : saveStatus === 'saved' ? (
                  <><Check size={12} /> 저장됨</>
                ) : saveStatus === 'error' ? (
                  '저장 실패'
                ) : (
                  <><Save size={12} /> 승인 &amp; 저장</>
                )}
              </button>

              {/* Download */}
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded font-medium transition-colors hover:bg-[var(--color-bg-hover)]"
                style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
              >
                <Download size={12} />
                다운로드 .md
              </button>
            </div>

            {saveStatus === 'error' && (
              <div className="text-xs" style={{ color: '#e74c3c' }}>
                저장 실패 — 볼트를 먼저 선택하세요 (⚙️ Settings → 볼트 선택)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
