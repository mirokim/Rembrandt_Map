import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useVaultStore } from '@/stores/vaultStore'

/**
 * ImageViewer — 이미지 노드 더블클릭 시 에디터 영역에 표시되는 뷰어.
 * editingDocId = 'img:{normalizedFilename}' 형태일 때 렌더링됨.
 */
export default function ImageViewer() {
  const { editingDocId, closeEditor } = useUIStore()
  const imageDataCache = useVaultStore(s => s.imageDataCache)
  const imagePathRegistry = useVaultStore(s => s.imagePathRegistry)
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // 'img:my_image.png' → 'my_image.png'
  const normalizedRef = editingDocId?.startsWith('img:') ? editingDocId.slice(4) : null

  // 캐시/레지스트리에서 원본 파일명 복원 (소문자+공백→_ 역변환)
  const originalRef = normalizedRef
    ? (Object.keys(imageDataCache).find(k => k.toLowerCase().replace(/\s+/g, '_') === normalizedRef)
      ?? Object.keys(imagePathRegistry ?? {}).find(k => k.toLowerCase().replace(/\s+/g, '_') === normalizedRef))
    : null

  const displayName = originalRef ?? normalizedRef ?? '이미지'

  useEffect(() => {
    if (!normalizedRef) return

    // 1. 사전 인덱싱 캐시에서 즉시 조회
    const cached = originalRef ? imageDataCache[originalRef] : null
    if (cached) {
      setDataUrl(cached)
      return
    }

    // 2. 캐시 미스 → IPC on-demand 로드
    if (!window.vaultAPI || !imagePathRegistry) return
    const entry = originalRef ? imagePathRegistry[originalRef] : null
    if (!entry) return

    setIsLoading(true)
    setDataUrl(null)
    window.vaultAPI.readImage(entry.absolutePath)
      .then(url => { if (url) setDataUrl(url) })
      .finally(() => setIsLoading(false))
  // originalRef를 deps에 포함하면 imageDataCache 갱신 시 자동 재실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingDocId, originalRef])

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div
        className="shrink-0 flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
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

      {/* 이미지 영역 */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
        {isLoading && (
          <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            로딩 중...
          </div>
        )}
        {!isLoading && dataUrl && (
          <img
            src={dataUrl}
            alt={displayName}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 6,
            }}
          />
        )}
        {!isLoading && !dataUrl && (
          <div className="text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
            <div>이미지를 불러올 수 없습니다</div>
            <div className="text-xs mt-1 font-mono opacity-60">{displayName}</div>
          </div>
        )}
      </div>
    </div>
  )
}
