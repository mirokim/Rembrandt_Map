import { useState, useEffect, useMemo } from 'react'
import { X, FileText } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'

/**
 * ImageViewer — 이미지 노드 더블클릭 시 에디터 영역에 표시되는 뷰어.
 * editingDocId = 'img:{normalizedFilename}' 형태일 때 렌더링됨.
 *
 * 이미지는 rembrandt-img:// 커스텀 프로토콜을 통해 디스크에서 직접 로드됨.
 * 메인 프로세스의 protocol.handle 핸들러가 normalizedName → absolutePath 변환을
 * imagePathRegistry + 재귀 검색으로 해결하므로 렌더러 측 복잡도가 없음.
 */
export default function ImageViewer() {
  const { editingDocId, closeEditor, openInEditor } = useUIStore()
  const imagePathRegistry = useVaultStore(s => s.imagePathRegistry)
  const loadedDocuments = useVaultStore(s => s.loadedDocuments)
  const [imgError, setImgError] = useState(false)

  // 'img:my_image.png' → 'my_image.png'
  const normalizedRef = editingDocId?.startsWith('img:') ? editingDocId.slice(4) : null

  // Reset error state when a different image is opened
  useEffect(() => { setImgError(false) }, [normalizedRef])

  // Display name: try to recover original filename with spaces from registry
  const displayName = useMemo(() => {
    if (!normalizedRef) return '이미지'
    const origKey = Object.keys(imagePathRegistry ?? {}).find(
      k => k.toLowerCase().replace(/\s+/g, '_') === normalizedRef
    )
    return origKey ?? normalizedRef
  }, [normalizedRef, imagePathRegistry])

  // Protocol URL — main process resolves normalizedRef → actual file path
  const imageUrl = normalizedRef
    ? `rembrandt-img:///${encodeURIComponent(normalizedRef)}`
    : null

  // 이 이미지를 ![[...]]로 참조하는 문서 목록
  const referencingDocs = useMemo(() => {
    if (!normalizedRef || !loadedDocuments) return []
    return loadedDocuments.filter(d =>
      d.imageRefs?.some(r => r.toLowerCase().replace(/\s+/g, '_') === normalizedRef)
    )
  }, [loadedDocuments, normalizedRef])

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div
        className="shrink-0 flex flex-col px-4 pt-3 pb-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        {/* 파일명 + 닫기 */}
        <div className="flex items-center justify-between pb-3">
          <span
            className="text-xs font-mono truncate"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            🖼️ {displayName}
          </span>
          <button
            onClick={closeEditor}
            className="p-1 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="이미지 뷰어 닫기"
          >
            <X size={14} />
          </button>
        </div>

        {/* 참조 문서 버튼 */}
        {referencingDocs.length > 0 && (
          <div className="flex items-center gap-1.5 pb-2.5 flex-wrap">
            <span
              className="text-[10px] shrink-0"
              style={{ color: 'var(--color-text-muted)' }}
            >
              참조 문서:
            </span>
            {referencingDocs.map(doc => (
              <button
                key={doc.id}
                onClick={() => openInEditor(doc.id)}
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                style={{
                  color: 'var(--color-accent, #60a5fa)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-surface)',
                  cursor: 'pointer',
                  maxWidth: 160,
                }}
                title={doc.filename}
              >
                <FileText size={10} className="shrink-0" />
                <span className="truncate">{doc.filename}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 이미지 영역 */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
        {imageUrl && !imgError ? (
          <img
            src={imageUrl}
            alt={displayName}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 6,
            }}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
            <div>이미지를 불러올 수 없습니다</div>
            <div className="text-xs mt-1 font-mono opacity-60">{displayName}</div>
          </div>
        )}
      </div>
    </div>
  )
}
