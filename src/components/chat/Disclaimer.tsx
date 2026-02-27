export default function Disclaimer() {
  return (
    <div
      className="shrink-0 px-4 py-2 text-center"
      style={{
        fontSize: 10,
        color: 'var(--color-text-muted)',
        borderTop: '1px solid var(--color-border)',
        opacity: 0.7,
      }}
      data-testid="chat-disclaimer"
    >
      AI 응답은 시뮬레이션입니다. 실제 AI 연동은 Phase 5에서 제공됩니다.
    </div>
  )
}
