import { useChatStore } from '@/stores/chatStore'

const QUICK_QUESTIONS = [
  '현재 가장 큰 기술적 병목은 무엇인가요?',
  '아트 방향성에 대한 최신 피드백은?',
  '레벨 디자인에서 개선이 필요한 부분은?',
  '이번 마일스톤의 우선순위를 정리해주세요.',
  '팀 간 정렬이 안 된 이슈가 있나요?',
  '성능 최적화 현황을 요약해주세요.',
]

export default function QuickQuestions() {
  const { sendMessage } = useChatStore()

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="quick-questions">
      {QUICK_QUESTIONS.map((q, i) => (
        <button
          key={i}
          onClick={() => sendMessage(q)}
          data-testid={`quick-q-${i}`}
          className="text-xs px-2.5 py-1 rounded-full transition-colors hover:opacity-80"
          style={{
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          {q}
        </button>
      ))}
    </div>
  )
}
