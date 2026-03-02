import { useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useTrashStore } from '@/stores/trashStore'
import { useVaultStore } from '@/stores/vaultStore'

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return '방금 전'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
  return `${Math.floor(diff / 86_400_000)}일 전`
}

export default function TrashTab() {
  const { items, remove, clear } = useTrashStore()
  const vaultPath = useVaultStore(s => s.vaultPath)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleRestore = async (id: string) => {
    const item = useTrashStore.getState().items.find(i => i.id === id)
    if (!item || !window.vaultAPI) return
    setRestoring(id)
    setError(null)
    try {
      await window.vaultAPI.saveFile(item.absolutePath, item.content)
      remove(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '복원 실패')
    } finally {
      setRestoring(null)
    }
  }

  const handlePermanentDelete = (id: string) => {
    remove(id)
  }

  if (!vaultPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
        <span style={{ fontSize: 28, opacity: 0.2 }}>🗑️</span>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>볼트를 먼저 로드하세요</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
        <span style={{ fontSize: 28, opacity: 0.2 }}>🗑️</span>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>휴지통이 비어 있습니다</p>
        <p className="text-[10px]" style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}>
          세션 내 삭제된 파일이 여기에 보관됩니다
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">

      {/* 헤더 액션 */}
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {items.length}개 파일 · 세션 종료 시 자동 소멸
        </p>
        <button
          onClick={() => {
            if (window.confirm(`휴지통을 비우시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) clear()
          }}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
        >
          <Trash2 size={10} />
          전체 비우기
        </button>
      </div>

      {error && (
        <div className="text-[10px] px-3 py-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
          {error}
        </div>
      )}

      {/* 항목 목록 */}
      <div className="flex flex-col gap-2">
        {items.map(item => (
          <div
            key={item.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded"
            style={{
              background: 'var(--color-bg-active)',
              border: '1px solid var(--color-border)',
            }}
          >
            {/* 파일 정보 */}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                {item.filename}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                {item.folderPath && (
                  <span className="text-[10px] truncate" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
                    {item.folderPath}
                  </span>
                )}
                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}>
                  {relativeTime(item.deletedAt)}
                </span>
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)', opacity: 0.45 }}>
                {item.content.length.toLocaleString()} 자
              </div>
            </div>

            {/* 복원 */}
            <button
              onClick={() => handleRestore(item.id)}
              disabled={restoring === item.id}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors hover:bg-[var(--color-bg-hover)] shrink-0"
              style={{
                color: 'var(--color-accent, #60a5fa)',
                border: '1px solid var(--color-border)',
                opacity: restoring === item.id ? 0.5 : 1,
                cursor: restoring === item.id ? 'wait' : 'pointer',
              }}
              title="원래 위치로 복원"
            >
              <RotateCcw size={10} />
              복원
            </button>

            {/* 영구 삭제 */}
            <button
              onClick={() => handlePermanentDelete(item.id)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors hover:bg-[var(--color-bg-hover)] shrink-0"
              style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
              title="휴지통에서 제거"
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}
      </div>

    </div>
  )
}
