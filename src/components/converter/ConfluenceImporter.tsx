/**
 * ConfluenceImporter — Confluence HTML export batch converter
 *
 * Rendered inside ConverterEditor's "Confluence" tab.
 * Self-contained flow: folder pick → page list → convert → download.
 * Does NOT use the LLM pipeline — direct structural conversion.
 */

import { useState, useRef, useEffect } from 'react'
import { Folder, Download, RotateCcw } from 'lucide-react'
import {
  parseConfluenceFolder,
  convertConfluencePage,
  type ConfluencePage,
} from '@/lib/confluenceConverter'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PageItem {
  page: ConfluencePage
  status: 'pending' | 'running' | 'done' | 'error'
  markdown?: string
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadMd(text: string, title: string) {
  const safe = (title.trim() || '변환문서').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe}.md`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ConfluenceImporter() {
  const [pages, setPages] = useState<PageItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const folderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  // ── Folder selection ──────────────────────────────────────────────────────

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const detected = parseConfluenceFolder(Array.from(files))
    setPages(detected.map(page => ({ page, status: 'pending' })))
    setSelectedIds(new Set(detected.map(p => p.id)))
    setDone(false)
  }

  // ── Selection helpers ─────────────────────────────────────────────────────

  const toggle = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleAll = () =>
    setSelectedIds(
      selectedIds.size === pages.length
        ? new Set()
        : new Set(pages.map(p => p.page.id))
    )

  // ── Conversion ────────────────────────────────────────────────────────────

  const handleConvert = async () => {
    if (selectedIds.size === 0) return
    setRunning(true)
    setDone(false)

    const updated = [...pages]

    for (let i = 0; i < updated.length; i++) {
      if (!selectedIds.has(updated[i].page.id)) continue

      updated[i] = { ...updated[i], status: 'running' }
      setPages([...updated])

      try {
        const markdown = await convertConfluencePage(updated[i].page)
        updated[i] = { ...updated[i], status: 'done', markdown }
      } catch (err) {
        updated[i] = {
          ...updated[i],
          status: 'error',
          error: err instanceof Error ? err.message : '변환 실패',
        }
      }

      setPages([...updated])
    }

    setRunning(false)
    setDone(true)
  }

  // ── Download ──────────────────────────────────────────────────────────────

  const handleDownloadOne = (item: PageItem) => {
    if (item.markdown) downloadMd(item.markdown, item.page.title)
  }

  const handleDownloadAll = () =>
    pages.filter(p => p.status === 'done' && p.markdown).forEach(handleDownloadOne)

  // ── Reset ─────────────────────────────────────────────────────────────────

  const handleReset = () => {
    setPages([])
    setSelectedIds(new Set())
    setRunning(false)
    setDone(false)
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const selectedCount = selectedIds.size
  const doneCount = pages.filter(p => p.status === 'done').length
  const selectedPages = pages.filter(p => selectedIds.has(p.page.id))
  const totalDocs = selectedPages.reduce(
    (sum, p) =>
      sum + p.page.attachments.filter(a => ['pdf', 'docx', 'pptx', 'xlsx'].includes(a.type)).length,
    0
  )
  const currentRunning = pages.find(p => p.status === 'running')

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">

      {/* Info banner */}
      <div
        className="text-xs px-3 py-2 rounded"
        style={{
          background: 'var(--color-bg-secondary)',
          color: 'var(--color-text-muted)',
          border: '1px solid var(--color-border)',
        }}
      >
        📌 Confluence HTML 내보내기 폴더를 선택하세요.{' '}
        <code style={{ color: 'var(--color-accent)' }}>{'ID_제목.html'}</code>
        {' '}+{' '}
        <code style={{ color: 'var(--color-accent)' }}>{'ID_files/'}</code>
        {' '}구조를 자동으로 인식합니다. AI 없이 직접 변환합니다.
      </div>

      {/* Folder picker */}
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-lg p-6 cursor-pointer transition-colors hover:bg-[var(--color-bg-hover)]"
        style={{ border: '1.5px dashed var(--color-border)' }}
        onClick={() => !running && folderInputRef.current?.click()}
      >
        <Folder size={24} style={{ color: 'var(--color-text-muted)' }} />
        <div className="text-center">
          <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            downloaded_pages 폴더 선택
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            HTML + 첨부파일 (PDF, DOCX, PPTX, XLSX) 자동 변환
          </div>
        </div>
        {pages.length > 0 && (
          <div className="text-xs font-medium" style={{ color: 'var(--color-accent)' }}>
            ✓ {pages.length}개 페이지 감지됨
          </div>
        )}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFolderSelect}
        />
      </div>

      {/* Page list */}
      {pages.length > 0 && (
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {/* List header */}
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{
              background: 'var(--color-bg-secondary)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            {done ? (
              <span className="text-xs" style={{ color: 'var(--color-accent)' }}>
                ✓ {doneCount} / {selectedPages.length}개 변환 완료
              </span>
            ) : (
              <label
                className="flex items-center gap-2 cursor-pointer text-xs"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.size === pages.length && pages.length > 0}
                  onChange={toggleAll}
                  disabled={running}
                  className="cursor-pointer"
                />
                전체 선택 ({selectedCount}/{pages.length}개)
              </label>
            )}
            {totalDocs > 0 && !done && (
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                문서 첨부 {totalDocs}개 포함
              </span>
            )}
            {running && currentRunning && (
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                ⟳ {currentRunning.page.title.slice(0, 24)}…
              </span>
            )}
          </div>

          {/* Progress bar (shown during conversion) */}
          {running && (
            <div
              className="h-1"
              style={{ background: 'var(--color-bg-hover)' }}
            >
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${(doneCount / selectedCount) * 100}%`,
                  background: 'var(--color-accent)',
                }}
              />
            </div>
          )}

          {/* Page rows */}
          <div className="max-h-72 overflow-y-auto">
            {pages.map((item, idx) => {
              const isSelected = selectedIds.has(item.page.id)
              const docCount = item.page.attachments.filter(a =>
                ['pdf', 'docx', 'pptx', 'xlsx'].includes(a.type)
              ).length
              const imgCount = item.page.attachments.filter(a => a.type === 'image').length

              return (
                <div
                  key={item.page.id}
                  className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--color-bg-hover)]"
                  style={{
                    borderBottom:
                      idx < pages.length - 1
                        ? '1px solid var(--color-border)'
                        : undefined,
                    background:
                      item.status === 'running'
                        ? 'var(--color-bg-hover)'
                        : undefined,
                  }}
                >
                  {/* Checkbox — hidden after done */}
                  {!done && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(item.page.id)}
                      disabled={running}
                      className="cursor-pointer shrink-0"
                    />
                  )}

                  {/* Status icon */}
                  <span
                    className="text-xs w-3 text-center shrink-0"
                    style={{
                      color:
                        item.status === 'done'
                          ? 'var(--color-accent)'
                          : item.status === 'error'
                          ? '#e74c3c'
                          : item.status === 'running'
                          ? 'var(--color-text-primary)'
                          : 'transparent',
                    }}
                  >
                    {item.status === 'done'
                      ? '✓'
                      : item.status === 'error'
                      ? '✗'
                      : item.status === 'running'
                      ? '⟳'
                      : '·'}
                  </span>

                  {/* Page title */}
                  <span
                    className="text-xs flex-1 truncate"
                    title={item.page.title}
                    style={{
                      color:
                        item.status === 'done'
                          ? 'var(--color-accent)'
                          : item.status === 'error'
                          ? '#e74c3c'
                          : item.status === 'running'
                          ? 'var(--color-text-primary)'
                          : isSelected
                          ? 'var(--color-text-secondary)'
                          : 'var(--color-text-muted)',
                    }}
                  >
                    {item.page.title}
                  </span>

                  {/* Attachment badges */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {docCount > 0 && (
                      <span
                        className="text-[10px]"
                        style={{ color: 'var(--color-text-muted)' }}
                        title={`문서 첨부 ${docCount}개`}
                      >
                        📄{docCount}
                      </span>
                    )}
                    {imgCount > 0 && (
                      <span
                        className="text-[10px]"
                        style={{ color: 'var(--color-text-muted)' }}
                        title={`이미지 ${imgCount}개`}
                      >
                        🖼{imgCount}
                      </span>
                    )}
                  </div>

                  {/* Per-file download button */}
                  {item.status === 'done' && item.markdown && (
                    <button
                      onClick={() => handleDownloadOne(item)}
                      className="shrink-0 p-1 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                      style={{ color: 'var(--color-accent)' }}
                      title="MD 다운로드"
                    >
                      <Download size={11} />
                    </button>
                  )}

                  {/* Error message */}
                  {item.status === 'error' && item.error && (
                    <span
                      className="text-[10px] shrink-0 max-w-[120px] truncate"
                      style={{ color: '#e74c3c' }}
                      title={item.error}
                    >
                      {item.error}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {pages.length > 0 && (
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded transition-colors hover:bg-[var(--color-bg-hover)]"
            style={{
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
            }}
          >
            <RotateCcw size={11} />
            초기화
          </button>

          {done ? (
            <button
              onClick={handleDownloadAll}
              disabled={doneCount === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded font-medium transition-colors disabled:opacity-40"
              style={{
                background: 'var(--color-accent)',
                color: 'white',
              }}
            >
              <Download size={11} />
              전체 다운로드 ({doneCount}개)
            </button>
          ) : (
            <button
              onClick={handleConvert}
              disabled={running || selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded font-medium transition-colors disabled:opacity-40"
              style={{
                background:
                  selectedCount > 0 && !running
                    ? 'var(--color-accent)'
                    : 'var(--color-bg-hover)',
                color:
                  selectedCount > 0 && !running
                    ? 'white'
                    : 'var(--color-text-muted)',
              }}
            >
              {running
                ? `⟳ 변환 중... (${doneCount}/${selectedCount})`
                : `▶ ${selectedCount}개 페이지 변환`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
