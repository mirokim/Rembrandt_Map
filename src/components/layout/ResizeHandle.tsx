import { useRef, useCallback } from 'react'

interface ResizeHandleProps {
  onResize: (delta: number) => void
}

export default function ResizeHandle({ onResize }: ResizeHandleProps) {
  const isDragging = useRef(false)
  const lastX = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    lastX.current = e.clientX
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (me: MouseEvent) => {
      if (!isDragging.current) return
      const delta = me.clientX - lastX.current
      lastX.current = me.clientX
      onResize(delta)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [onResize])

  return (
    // Wide invisible grab zone — only shows a subtle accent line on hover
    <div
      onMouseDown={handleMouseDown}
      style={{ cursor: 'col-resize', width: 8, flexShrink: 0 }}
      className="h-full group flex items-stretch"
      aria-label="Resize panel"
      role="separator"
    >
      <div
        className="w-px mx-auto opacity-0 group-hover:opacity-60 transition-opacity duration-150"
        style={{ background: 'var(--color-accent)' }}
      />
    </div>
  )
}
