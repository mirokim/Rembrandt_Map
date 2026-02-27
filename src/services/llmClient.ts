import type { ChatMessage, SpeakerId, DirectorId, Attachment } from '@/types'
import type { ConversionMeta } from '@/lib/mdConverter'
import { MODEL_OPTIONS, getProviderForModel, envKeyForProvider } from '@/lib/modelConfig'
import { PERSONA_PROMPTS } from '@/lib/personaPrompts'
import { selectMockResponse } from '@/data/mockResponses'
import { useSettingsStore } from '@/stores/settingsStore'

// ── Obsidian MD conversion (MD 변환 에디터 파이프라인) ─────────────────────────

/**
 * Convert raw text to an Obsidian-compatible Markdown document using Claude.
 *
 * Output format:
 *   KEYWORDS: kw1, kw2, ...
 *   (blank line)
 *   ---
 *   (frontmatter + body)
 *
 * Falls back to a simple template if no API key is configured.
 *
 * @param rawContent  The raw text to convert
 * @param meta        Document metadata (title, speaker, date, type)
 * @param onChunk     Called with each streamed token
 */
export async function convertToObsidianMD(
  rawContent: string,
  meta: ConversionMeta,
  onChunk: (chunk: string) => void
): Promise<void> {
  const { personaModels } = useSettingsStore.getState()
  const modelId = personaModels['chief_director']
  const provider = getProviderForModel(modelId)

  const fallbackOutput = [
    `KEYWORDS: ${meta.title}, ${meta.type}`,
    '',
    '---',
    `---`,
    `speaker: ${meta.speaker}`,
    `date: ${meta.date}`,
    `tags: [${meta.type}]`,
    `type: ${meta.type}`,
    `---`,
    '',
    `## ${meta.title}`,
    '',
    rawContent,
  ].join('\n')

  if (!provider) {
    onChunk(fallbackOutput)
    return
  }

  const envKey = envKeyForProvider(provider)
  const apiKey = (import.meta.env as Record<string, string>)[envKey]

  if (!apiKey) {
    onChunk(fallbackOutput)
    return
  }

  const model = MODEL_OPTIONS.find((m) => m.id === modelId)!

  const systemPrompt =
    '당신은 게임 개발 스튜디오의 지식 관리 전문가입니다. ' +
    '원문 텍스트를 분석하고 Obsidian 마크다운 형식으로 구조화합니다.'

  const userMessage =
    `다음 텍스트를 Obsidian 마크다운으로 변환해주세요.\n\n` +
    `반드시 아래 형식을 정확히 따르세요:\n` +
    `1. 첫 줄: KEYWORDS: 키워드1, 키워드2, 키워드3 (핵심 키워드 5~10개, 쉼표 구분)\n` +
    `2. 빈 줄\n` +
    `3. 구분선: ---\n` +
    `4. Obsidian frontmatter:\n` +
    `---\n` +
    `speaker: ${meta.speaker}\n` +
    `date: ${meta.date}\n` +
    `tags: [${meta.type}, 키워드1, 키워드2]\n` +
    `type: ${meta.type}\n` +
    `---\n` +
    `5. ## ${meta.title}\n` +
    `6. 각 핵심 키워드를 ## 소제목으로 사용하여 관련 내용 정리\n\n` +
    `제목: ${meta.title}\n유형: ${meta.type}\n\n원문:\n${rawContent}`

  const messages = [{ role: 'user' as const, content: userMessage }]

  switch (model.provider) {
    case 'anthropic': {
      const { streamCompletion } = await import('./providers/anthropic')
      await streamCompletion(apiKey, modelId, systemPrompt, messages, onChunk)
      break
    }
    case 'openai': {
      const { streamCompletion } = await import('./providers/openai')
      await streamCompletion(apiKey, modelId, systemPrompt, messages, onChunk)
      break
    }
    case 'gemini': {
      const { streamCompletion } = await import('./providers/gemini')
      await streamCompletion(apiKey, modelId, systemPrompt, messages, onChunk)
      break
    }
    case 'grok': {
      const { streamCompletion } = await import('./providers/grok')
      await streamCompletion(apiKey, modelId, systemPrompt, messages, onChunk)
      break
    }
    default:
      onChunk(fallbackOutput)
  }
}

// ── Message history conversion ─────────────────────────────────────────────────

function toHistoryMessages(
  history: ChatMessage[]
): { role: 'user' | 'assistant'; content: string }[] {
  return history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
}

// ── Fallback mock stream ───────────────────────────────────────────────────────

/** Emit the mock response character-by-character with a small delay to simulate streaming */
async function streamMockResponse(
  persona: SpeakerId,
  userMessage: string,
  onChunk: (chunk: string) => void
): Promise<void> {
  const mock = selectMockResponse(persona as DirectorId, userMessage)
  const prefix = '[Mock] '
  const fullText = prefix + mock

  // Emit in small word-sized chunks to feel like streaming
  const words = fullText.split(' ')
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? '' : ' ') + words[i]
    onChunk(chunk)
    await new Promise<void>((r) => setTimeout(r, 30 + Math.random() * 20))
  }
}

// ── RAG context fetcher (Phase 1-3) ───────────────────────────────────────────

/**
 * Fetch relevant document chunks from the ChromaDB backend.
 * Returns a formatted context string to prepend to the system prompt,
 * or an empty string if the backend is unavailable or returns no results.
 *
 * Failure is always non-fatal — the LLM call continues without RAG context.
 */
export async function fetchRAGContext(userMessage: string): Promise<string> {
  if (typeof window === 'undefined' || !window.backendAPI) return ''
  try {
    const response = await window.backendAPI.search(userMessage, 3)
    if (!response.results || response.results.length === 0) return ''

    const relevant = response.results.filter((r) => r.score > 0.3)
    if (relevant.length === 0) return ''

    const chunks = relevant
      .map((r) => {
        const parts: string[] = []
        if (r.heading) parts.push(`### ${r.heading}`)
        parts.push(r.content)
        parts.push(
          `*출처: ${r.filename}${r.speaker ? ` (${r.speaker})` : ''}*`
        )
        return parts.join('\n')
      })
      .join('\n\n---\n\n')

    return `## 관련 문서\n\n${chunks}\n\n`
  } catch {
    // RAG failure is non-fatal — continue without context
    return ''
  }
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Route a user message to the appropriate LLM provider and stream the response.
 *
 * If no API key is configured for the selected model's provider, falls back to
 * the mock response system (with a "[Mock]" prefix so the user knows).
 *
 * If a ChromaDB backend is available, relevant document chunks are prepended
 * to the system prompt as RAG context.
 *
 * Image attachments are sent to vision-capable providers (Anthropic, OpenAI, Gemini).
 * Text file attachments are appended to the user message as quoted context.
 *
 * @param persona      The director persona responding
 * @param userMessage  The raw user message text
 * @param history      Full conversation history (for context)
 * @param onChunk      Called with each streamed text delta
 * @param attachments  Optional files attached to the current message
 */
export async function streamMessage(
  persona: SpeakerId,
  userMessage: string,
  history: ChatMessage[],
  onChunk: (chunk: string) => void,
  attachments?: Attachment[]
): Promise<void> {
  const { personaModels } = useSettingsStore.getState()
  const modelId = personaModels[persona as DirectorId]
  const provider = getProviderForModel(modelId)

  if (!provider) {
    // Model not found in catalogue — use mock
    await streamMockResponse(persona, userMessage, onChunk)
    return
  }

  const envKey = envKeyForProvider(provider)
  const apiKey = (import.meta.env as Record<string, string>)[envKey]

  if (!apiKey) {
    // No API key configured — use mock
    await streamMockResponse(persona, userMessage, onChunk)
    return
  }

  const model = MODEL_OPTIONS.find((m) => m.id === modelId)!
  const basePrompt = PERSONA_PROMPTS[persona as DirectorId]

  // ── RAG context injection (Phase 1-3) ──────────────────────────────────────
  const ragContext = await fetchRAGContext(userMessage)
  const systemPrompt = ragContext
    ? `${ragContext}## 지시사항\n\n${basePrompt}`
    : basePrompt

  // ── Attachment processing ───────────────────────────────────────────────────
  // Separate image attachments (→ vision API) from text attachments (→ message injection)
  const imageAttachments = attachments?.filter(a => a.type === 'image') ?? []
  const textAttachments  = attachments?.filter(a => a.type === 'text')  ?? []

  // Append text file content to user message
  let fullUserMessage = userMessage
  if (textAttachments.length > 0) {
    const textContext = textAttachments
      .map(a => `\n\n[첨부 파일: ${a.name}]\n${a.dataUrl}`)
      .join('')
    fullUserMessage = userMessage + textContext
  }

  // Build message history, excluding the current user message
  const historyMessages = toHistoryMessages(
    history.filter((m) => m.content !== userMessage || m.role !== 'user')
  )
  const allMessages = [
    ...historyMessages,
    { role: 'user' as const, content: fullUserMessage },
  ]

  // Dynamically import the provider module to keep bundle splitting clean
  switch (model.provider) {
    case 'anthropic': {
      const { streamCompletion } = await import('./providers/anthropic')
      await streamCompletion(apiKey, modelId, systemPrompt, allMessages, onChunk, imageAttachments)
      break
    }
    case 'openai': {
      const { streamCompletion } = await import('./providers/openai')
      await streamCompletion(apiKey, modelId, systemPrompt, allMessages, onChunk, imageAttachments)
      break
    }
    case 'gemini': {
      const { streamCompletion } = await import('./providers/gemini')
      await streamCompletion(apiKey, modelId, systemPrompt, allMessages, onChunk, imageAttachments)
      break
    }
    case 'grok': {
      const { streamCompletion } = await import('./providers/grok')
      // Grok uses OpenAI-compatible format; pass no image attachments
      await streamCompletion(apiKey, modelId, systemPrompt, allMessages, onChunk)
      break
    }
    default: {
      await streamMockResponse(persona, userMessage, onChunk)
    }
  }
}
