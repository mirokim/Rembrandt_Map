import { useState, useRef } from 'react'
import { FileText, Pin, BookMarked } from 'lucide-react'
import PersonaChips from './PersonaChips'
import MessageList from './MessageList'
import QuickQuestions from './QuickQuestions'
import ChatInput from './ChatInput'
import { useDebateStore } from '@/stores/debateStore'
import { DebateSetup } from './debate/DebateSetup'
import { DebateControlBar } from './debate/DebateControlBar'
import { DebateThread } from './debate/DebateThread'
import { DebateUserInput } from './debate/DebateUserInput'
import { useSettingsStore } from '@/stores/settingsStore'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { useMemoryStore } from '@/stores/memoryStore'
import { summarizeConversation } from '@/services/llmClient'

export default function ChatPanel() {
  const [debateMode, setDebateMode] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const debateStatus = useDebateStore((s) => s.status)
  const { setSettingsPanelOpen } = useSettingsStore()
  const messages = useChatStore((s) => s.messages)
  const { openInEditor } = useUIStore()
  const { memoryText, setMemoryText, clearMemory, appendToMemory } = useMemoryStore()

  const openDebateSettings = () => {
    setSettingsPanelOpen(true)
  }

  const handleSummarizeToMemory = async () => {
    if (summarizing || messages.length === 0) return
    setSummarizing(true)
    let summary = ''
    try {
      await summarizeConversation(messages, (chunk) => { summary += chunk })
      if (summary.trim()) {
        const timestamp = new Date().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        appendToMemory(`[${timestamp} 대화 요약]\n${summary.trim()}`)
        setMemoryOpen(true)
      }
    } finally {
      setSummarizing(false)
    }
  }

  return (
    <div className="flex flex-col h-full" data-testid="chat-panel">
      {/* Header: persona selector or debate mode label */}
      <div
        className="shrink-0 px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            {debateMode && (
              <div
                className="text-xs mb-2"
                style={{ color: 'var(--color-text-muted)', fontFamily: 'monospace' }}
              >
                ⚔️ AI 토론
              </div>
            )}
            {!debateMode && <PersonaChips />}
          </div>

          {/* 기억 / 요약 / 보고서 버튼 */}
          {!debateMode && (
            <div className="shrink-0 flex items-center gap-1 ml-2">
              <button
                onClick={() => setMemoryOpen(v => !v)}
                className="p-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                style={{ color: memoryText.trim() ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
                title="AI 기억 메모"
                aria-label="AI 기억 메모"
              >
                <Pin size={13} />
              </button>
              {messages.length > 0 && (
                <button
                  onClick={handleSummarizeToMemory}
                  disabled={summarizing}
                  className="p-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                  style={{ color: summarizing ? 'var(--color-accent)' : 'var(--color-text-secondary)', opacity: summarizing ? 0.7 : 1 }}
                  title={summarizing ? '요약 중...' : '대화 요약 → 기억에 저장'}
                  aria-label="대화 요약 저장"
                >
                  <BookMarked size={13} />
                </button>
              )}
              {messages.length > 0 && (
                <button
                  onClick={() => openInEditor('report:latest')}
                  className="p-1.5 rounded transition-colors hover:bg-[var(--color-bg-hover)]"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title="대화 보고서 보기"
                  aria-label="대화 보고서 보기"
                >
                  <FileText size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main content area */}
      {debateMode ? (
        <>
          {debateStatus === 'idle' ? (
            <DebateSetup
              onBack={() => setDebateMode(false)}
              onOpenSettings={openDebateSettings}
            />
          ) : (
            <>
              <DebateControlBar />
              <DebateThread />
              <DebateUserInput />
            </>
          )}
        </>
      ) : (
        <>
          {/* AI 기억 패널 */}
          {memoryOpen && (
            <div
              className="shrink-0 px-4 py-3 flex flex-col gap-2"
              style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  📌 AI 기억 메모 — 앱을 닫아도 유지됩니다
                </span>
                {memoryText.trim() && (
                  <button
                    onClick={clearMemory}
                    className="text-xs px-2 py-0.5 rounded hover:bg-[var(--color-bg-hover)]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    초기화
                  </button>
                )}
              </div>
              <textarea
                value={memoryText}
                onChange={e => setMemoryText(e.target.value)}
                placeholder="기억할 내용을 자유롭게 입력하세요. 모든 AI 대화에 자동으로 포함됩니다."
                rows={5}
                className="w-full resize-none rounded p-2 text-xs outline-none"
                style={{
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  fontFamily: 'monospace',
                }}
              />
            </div>
          )}

          {/* Normal chat */}
          <MessageList />

          <div
            className="shrink-0 px-4 py-2"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <QuickQuestions />
          </div>

          <ChatInput debateMode={debateMode} onToggleDebate={() => setDebateMode(v => !v)} />
        </>
      )}
    </div>
  )
}
