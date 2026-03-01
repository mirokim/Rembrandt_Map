import { useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/chatStore'
import MessageBubble from './MessageBubble'

export default function MessageList() {
  const { messages, isLoading } = useChatStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  return (
    <div
      className="flex-1 overflow-y-auto px-3 py-3"
      data-testid="message-list"
    >
      {messages.length === 0 && !isLoading ? (
        <div
          className="flex items-center justify-center h-full text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          대화를 시작하거나 빠른 질문을 선택하세요
        </div>
      ) : (
        <>
          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Typing indicator */}
          {isLoading && (
            <div
              className="flex gap-1 px-3 py-2 mb-3"
              data-testid="typing-indicator"
            >
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    background: 'var(--color-text-muted)',
                    animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
