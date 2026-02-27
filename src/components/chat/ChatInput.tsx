import { useState, useRef } from 'react'
import { Send, Paperclip, X } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { generateId } from '@/lib/utils'
import type { Attachment } from '@/types'

// ── File → Attachment converter ───────────────────────────────────────────────

async function fileToAttachment(file: File): Promise<Attachment> {
  const id = generateId()
  const isImage = file.type.startsWith('image/')

  return new Promise<Attachment>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`파일 읽기 실패: ${file.name}`))

    if (isImage) {
      // Read as base64 data URL for vision API
      reader.onload = () =>
        resolve({
          id,
          name: file.name,
          type: 'image',
          mimeType: file.type,
          dataUrl: reader.result as string,
          size: file.size,
        })
      reader.readAsDataURL(file)
    } else {
      // Read as raw UTF-8 text for context injection
      reader.onload = () =>
        resolve({
          id,
          name: file.name,
          type: 'text',
          mimeType: file.type || 'text/plain',
          dataUrl: reader.result as string,
          size: file.size,
        })
      reader.readAsText(file, 'utf-8')
    }
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChatInput() {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const { sendMessage, isLoading } = useChatStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !isLoading

  const handleSend = async () => {
    if (!canSend) return
    const currentText = text.trim()
    const currentAttachments = attachments.length > 0 ? attachments : undefined
    setText('')
    setAttachments([])
    await sendMessage(currentText, currentAttachments)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFilesSelected = async (files: FileList) => {
    const newAttachments: Attachment[] = []
    for (const file of Array.from(files)) {
      try {
        const att = await fileToAttachment(file)
        newAttachments.push(att)
      } catch {
        // Silently skip unreadable files
      }
    }
    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments])
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }

  return (
    <div
      className="shrink-0 flex flex-col px-4 py-3 gap-2"
      style={{ borderTop: '1px solid var(--color-border)' }}
      data-testid="chat-input-container"
    >
      {/* Attachment preview chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map(att => (
            <div
              key={att.id}
              className="flex items-center gap-1.5 rounded-lg overflow-hidden text-xs"
              style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                maxWidth: 180,
              }}
            >
              {att.type === 'image' ? (
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="w-8 h-8 object-cover shrink-0"
                />
              ) : (
                <span className="px-1.5 shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                  📄
                </span>
              )}
              <span
                className="truncate py-1"
                style={{ color: 'var(--color-text-secondary)', maxWidth: 100 }}
              >
                {att.name}
              </span>
              <button
                onClick={() => removeAttachment(att.id)}
                className="flex items-center justify-center p-1 mr-0.5 shrink-0 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                style={{ color: 'var(--color-text-muted)' }}
                aria-label={`첨부 파일 제거: ${att.name}`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        {/* Paperclip — file attachment trigger */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          className="shrink-0 p-2 rounded-lg transition-colors disabled:opacity-50"
          style={{
            background: 'var(--color-bg-surface)',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
          }}
          title="파일 첨부 (이미지 PNG/JPG/WebP, 텍스트 .txt/.md)"
          aria-label="파일 첨부"
          data-testid="chat-attach-button"
        >
          <Paperclip size={14} />
        </button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,text/plain,text/markdown,.md"
          className="hidden"
          data-testid="chat-file-input"
          onChange={e => {
            if (e.target.files?.length) {
              handleFilesSelected(e.target.files)
              // Reset input value so the same file can be re-selected
              e.target.value = ''
            }
          }}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="디렉터에게 질문하세요… (Enter 전송 / Shift+Enter 줄바꿈)"
          disabled={isLoading}
          rows={2}
          data-testid="chat-textarea"
          className="flex-1 resize-none rounded-lg px-3 py-2 text-sm"
          style={{
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            outline: 'none',
            lineHeight: 1.5,
          }}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          data-testid="chat-send-button"
          className="shrink-0 p-2 rounded-lg transition-colors"
          style={{
            background: canSend ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
            color: canSend ? '#fff' : 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
