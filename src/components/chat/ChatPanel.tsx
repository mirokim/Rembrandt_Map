import { useState } from 'react'
import { Swords } from 'lucide-react'
import PersonaChips from './PersonaChips'
import MessageList from './MessageList'
import QuickQuestions from './QuickQuestions'
import ChatInput from './ChatInput'
import Disclaimer from './Disclaimer'
import { useDebateStore } from '@/stores/debateStore'
import { DebateSetup } from './debate/DebateSetup'
import { DebateControlBar } from './debate/DebateControlBar'
import { DebateThread } from './debate/DebateThread'
import { DebateUserInput } from './debate/DebateUserInput'
import { useSettingsStore } from '@/stores/settingsStore'

export default function ChatPanel() {
  const [debateMode, setDebateMode] = useState(false)
  const debateStatus = useDebateStore((s) => s.status)
  const { setSettingsPanelOpen } = useSettingsStore()

  const openDebateSettings = () => {
    setSettingsPanelOpen(true)
  }

  return (
    <div className="flex flex-col h-full" data-testid="chat-panel">
      {/* Header: persona selector or debate mode label */}
      <div
        className="shrink-0 px-4 py-3"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <div
            className="text-xs"
            style={{ color: 'var(--color-text-muted)', fontFamily: 'monospace' }}
          >
            {debateMode ? '⚔️ AI 토론' : '페르소나 선택'}
          </div>

          {/* Debate mode toggle */}
          <button
            onClick={() => setDebateMode((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-all"
            style={
              debateMode
                ? { background: 'rgba(82,156,202,0.15)', color: 'var(--color-accent)', border: '1px solid rgba(82,156,202,0.3)' }
                : { background: 'var(--color-bg-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }
            }
            title={debateMode ? '채팅 모드로 전환' : 'AI 토론 모드로 전환'}
            data-testid="debate-mode-toggle"
          >
            <Swords className="w-3 h-3" />
            {debateMode ? '채팅' : '토론'}
          </button>
        </div>

        {!debateMode && <PersonaChips />}
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
          {/* Normal chat */}
          <MessageList />

          <div
            className="shrink-0 px-4 py-2"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <div
              className="text-xs mb-1.5"
              style={{ color: 'var(--color-text-muted)' }}
            >
              빠른 질문
            </div>
            <QuickQuestions />
          </div>

          <ChatInput />
          <Disclaimer />
        </>
      )}
    </div>
  )
}
