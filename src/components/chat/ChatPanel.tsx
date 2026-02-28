import { useState } from 'react'
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
            <QuickQuestions />
          </div>

          <ChatInput debateMode={debateMode} onToggleDebate={() => setDebateMode(v => !v)} />
        </>
      )}
    </div>
  )
}
