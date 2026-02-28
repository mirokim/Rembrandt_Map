/**
 * MarkdownEditor — 볼트 파일 편집기
 *
 * vault:save-file IPC를 통해 자동 저장 (1초 디바운스).
 * 변경 사항 저장 후 vaultStore를 즉시 업데이트하여 DocViewer와 동기화.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, Save, CheckCircle, AlertCircle, X, Lock, Unlock } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'
import { MOCK_DOCUMENTS } from '@/data/mockDocuments'
import type { LoadedDocument, MockDocument } from '@/types'

const AUTOSAVE_DELAY = 1200 // ms

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export default function MarkdownEditor() {
  const { editingDocId, closeEditor } = useUIStore()
  const { loadedDocuments, setLoadedDocuments, vaultPath } = useVaultStore()

  // Search vault docs first, then fall back to mock documents
  const doc = (
    loadedDocuments?.find(d => d.id === editingDocId) ??
    MOCK_DOCUMENTS.find(d => d.id === editingDocId)
  ) as (LoadedDocument | MockDocument) | undefined

  const absolutePath = (doc as LoadedDocument)?.absolutePath ?? ''
  const canSave = Boolean(absolutePath && window.vaultAPI)

  const [isLocked, setIsLocked] = useState(true)
  const [content, setContent] = useState(doc?.rawContent ?? '')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDirty = useRef(false)

  // Reset when doc changes
  useEffect(() => {
    if (doc) setContent(doc.rawContent)
    isDirty.current = false
    setSaveStatus('idle')
    setIsLocked(true)
  }, [doc?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const doSave = useCallback(async (text: string) => {
    if (!canSave) return
    setSaveStatus('saving')
    try {
      await window.vaultAPI!.saveFile(absolutePath, text)
      // Update in-memory store so DocViewer sees the change
      if (loadedDocuments && doc) {
        const updated = loadedDocuments.map(d =>
          d.id === doc.id ? { ...d, rawContent: text } : d
        ) as LoadedDocument[]
        setLoadedDocuments(updated)
      }
      setSaveStatus('saved')
      isDirty.current = false
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (e) {
      console.error('[MarkdownEditor] save failed:', e)
      setSaveStatus('error')
    }
  }, [canSave, absolutePath, doc, loadedDocuments, setLoadedDocuments])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    setContent(text)
    isDirty.current = true
    setSaveStatus('idle')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(text), AUTOSAVE_DELAY)
  }

  const handleManualSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    doSave(content)
  }

  // Save before unmount if dirty
  useEffect(() => {
    return () => {
      if (isDirty.current && saveTimer.current) {
        clearTimeout(saveTimer.current)
        // Fire and forget — can't await in cleanup
        doSave(content)
      }
    }
  }, [content, doSave])

  if (!doc) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          height: '100%',
          color: 'var(--color-text-muted)',
          fontSize: 13,
        }}
      >
        <span>열린 파일이 없습니다</span>
        <button
          onClick={closeEditor}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--color-bg-overlay)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            padding: '6px 14px',
            fontSize: 12,
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--color-text-primary)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--color-text-secondary)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
          }}
        >
          <ArrowLeft size={13} />
          그래프로 돌아가기
        </button>
      </div>
    )
  }

  const displayName = doc.filename.replace(/\.md$/i, '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        {/* Back button */}
        <button
          onClick={closeEditor}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            padding: '3px 6px',
            borderRadius: 4,
            fontSize: 11,
            transition: 'color 0.1s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
          title="에디터 닫기"
        >
          <ArrowLeft size={13} />
        </button>

        {/* Filename */}
        <span
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={doc.filename}
        >
          {displayName}
        </span>

        {/* Lock / Unlock toggle */}
        <button
          onClick={() => setIsLocked(v => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 4,
            color: isLocked ? 'var(--color-text-muted)' : 'var(--color-accent)',
            cursor: 'pointer',
            padding: '3px 7px',
            fontSize: 11,
            transition: 'color 0.15s, border-color 0.15s',
          }}
          title={isLocked ? '잠금 해제 (편집 허용)' : '잠금 (읽기 전용)'}
        >
          {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
        </button>

        {/* Save status / read-only notice */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            color:
              !canSave ? 'var(--color-text-muted)'
              : saveStatus === 'saved' ? '#34d399'
              : saveStatus === 'error' ? '#f87171'
              : 'var(--color-text-muted)',
            transition: 'color 0.2s',
          }}
        >
          {!canSave && '읽기 전용'}
          {canSave && saveStatus === 'saved' && <><CheckCircle size={11} />저장됨</>}
          {canSave && saveStatus === 'saving' && '저장 중…'}
          {canSave && saveStatus === 'error' && <><AlertCircle size={11} />저장 실패</>}
        </div>

        {/* Manual save — hidden when read-only */}
        <button
          onClick={handleManualSave}
          disabled={!canSave}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 4,
            color: 'var(--color-text-muted)',
            cursor: canSave ? 'pointer' : 'not-allowed',
            opacity: canSave ? 1 : 0.3,
            padding: '3px 7px',
            fontSize: 11,
            transition: 'color 0.1s, border-color 0.1s',
          }}
          onMouseEnter={e => {
            if (canSave) {
              e.currentTarget.style.color = 'var(--color-text-primary)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--color-text-muted)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
          }}
          title={canSave ? '저장 (Ctrl+S)' : '볼트 파일이 아니면 저장할 수 없습니다'}
        >
          <Save size={11} />
        </button>

        {/* Close X */}
        <button
          onClick={closeEditor}
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            padding: '3px',
            borderRadius: 4,
            transition: 'color 0.1s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
          title="닫기"
        >
          <X size={13} />
        </button>
      </div>

      {/* Metadata bar */}
      {((doc as LoadedDocument).folderPath || doc.tags?.length > 0) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          {(doc as LoadedDocument).folderPath && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              📁 {(doc as LoadedDocument).folderPath}
            </span>
          )}
          {doc.tags?.map(tag => (
            <span
              key={tag}
              style={{
                fontSize: 10,
                color: 'var(--color-accent)',
                background: 'var(--color-bg-active)',
                borderRadius: 3,
                padding: '1px 5px',
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Editor */}
      <textarea
        value={content}
        readOnly={isLocked}
        onChange={handleChange}
        onKeyDown={e => {
          if (isLocked) return
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            handleManualSave()
          }
        }}
        style={{
          flex: 1,
          width: '100%',
          padding: '16px 20px',
          background: isLocked ? 'rgba(0,0,0,0.1)' : 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          color: isLocked ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
          fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
          fontSize: 13,
          lineHeight: 1.7,
          overflowY: 'auto',
          cursor: isLocked ? 'default' : 'text',
          transition: 'background 0.2s, color 0.2s',
        }}
        spellCheck={false}
        placeholder="마크다운을 입력하세요..."
      />
    </div>
  )
}
