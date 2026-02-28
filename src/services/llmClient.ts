import type { ChatMessage, SpeakerId, DirectorId, Attachment } from '@/types'
import type { ConversionMeta } from '@/lib/mdConverter'
import { logger } from '@/lib/logger'
import { MODEL_OPTIONS, getProviderForModel } from '@/lib/modelConfig'
import { PERSONA_PROMPTS, buildProjectContext } from '@/lib/personaPrompts'
import { selectMockResponse } from '@/data/mockResponses'
import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import {
  rerankResults,
  frontendKeywordSearch,
  buildDeepGraphContext,
  buildGlobalGraphContext,
  tokenizeQuery,
} from '@/lib/graphRAG'

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

  const apiKey = getApiKey(provider)

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

// ── Graph-Augmented RAG context fetcher ──────────────────────────────────────

/**
 * Fetch relevant document chunks from ChromaDB and enhance with graph context.
 *
 * Pipeline:
 *   1. Fetch top-8 candidates from ChromaDB (over-fetch for reranking headroom)
 *   2. Filter by minimum similarity score (> 0.3)
 *   3. Rerank by keyword overlap + speaker affinity → top 3
 *   4. Expand with graph-connected neighbor sections (wiki-link traversal)
 *   5. Format into compressed, token-efficient context string
 *
 * Failure is always non-fatal — the LLM call continues without RAG context.
 *
 * @param userMessage    The user's query text
 * @param currentSpeaker Optional current persona for speaker affinity boost
 */
/**
 * 전체 탐색 인텐트를 감지하는 패턴.
 * 이 패턴이 매칭되면 허브 노드 기반 전체 그래프 탐색으로 전환.
 */
const GLOBAL_INTENT_RE = /전체|전반적|모든\s*문서|프로젝트\s*전체|전체적인|overview|전체\s*인사이트|전반|총체적|전체\s*피드백|big.?picture/i

export async function fetchRAGContext(
  userMessage: string,
  currentSpeaker?: string
): Promise<string> {
  try {
    // ── 전체 탐색 인텐트: 허브 노드 기반 전체 그래프 탐색 ──────────────────
    // 키워드 검색을 건너뛰고 바로 허브 중심 BFS로 광범위한 컨텍스트 수집
    if (GLOBAL_INTENT_RE.test(userMessage)) {
      return buildGlobalGraphContext(35, 4)
    }

    let candidates: import('@/types').SearchResult[] = []

    if (typeof window !== 'undefined' && window.backendAPI) {
      // ── Primary path: ChromaDB vector search via Python backend ──
      try {
        const response = await window.backendAPI.search(userMessage, 8)
        candidates = response.results ?? []
      } catch {
        // Backend not running — fall through to frontend search
      }
    }

    // 백엔드 결과가 없으면 프론트엔드 검색으로 보완
    // (백엔드 미실행, 미인덱싱, 빈 결과 모두 포함)
    if (candidates.length === 0) {
      candidates = frontendKeywordSearch(userMessage, 8)
    }

    logger.debug(`[RAG] 검색 후보: ${candidates.length}개 (쿼리: "${userMessage.slice(0, 40)}")`)

    // Stage 2: Filter by minimum similarity (완화된 임계값 0.05)
    // 이전 0.15는 너무 엄격하여 제목이 조금만 달라도 누락됨
    const relevant = candidates.filter((r) => r.score > 0.05)

    // Stage 3: Rerank by keyword overlap + speaker affinity → top 5 (시작 노드 확보)
    // candidates가 적어도 buildDeepGraphContext 내부에서 허브 노드로 보완됨
    const reranked = relevant.length > 0
      ? rerankResults(relevant, userMessage, 5, currentSpeaker)
      : []

    // Stage 4: BFS 그래프 탐색 — 연결된 문서들을 최대 3홉까지 수집
    // queryTerms 전달 → 패시지-레벨 검색으로 각 문서의 가장 관련된 섹션 선택
    const ctx = buildDeepGraphContext(reranked, 3, 20, tokenizeQuery(userMessage))
    logger.debug(`[RAG] 컨텍스트 생성 완료: ${ctx.length}자`)
    return ctx
  } catch (err) {
    // RAG failure is non-fatal — continue without context
    logger.error('[RAG] fetchRAGContext 오류:', err)
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
  attachments?: Attachment[],
  overrideRagContext?: string   // 키워드 검색 우회 — 노드 선택 AI 분석 등에 사용
): Promise<void> {
  const { personaModels, projectInfo, directorBios, customPersonas, personaPromptOverrides } = useSettingsStore.getState()

  // Resolve persona — may be a built-in director or a custom persona
  const customPersona = customPersonas.find(p => p.id === persona)
  const modelId = customPersona
    ? customPersona.modelId
    : personaModels[persona as DirectorId]
  const provider = getProviderForModel(modelId)

  if (!provider) {
    // Model not found in catalogue — use mock
    await streamMockResponse(persona, userMessage, onChunk)
    return
  }

  const apiKey = getApiKey(provider)

  if (!apiKey) {
    // No API key configured — use mock
    await streamMockResponse(persona, userMessage, onChunk)
    return
  }

  const model = MODEL_OPTIONS.find((m) => m.id === modelId)!

  // Resolve system prompt: custom persona > built-in override > built-in default
  const basePrompt = customPersona
    ? customPersona.systemPrompt
    : (personaPromptOverrides[persona] ?? PERSONA_PROMPTS[persona as DirectorId] ?? '')

  // Director bio only applies to built-in personas
  const directorBio = customPersona ? undefined : directorBios[persona as DirectorId]
  const projectContext = buildProjectContext(projectInfo, directorBio)

  // ── Graph-Augmented RAG context injection ──────────────────────────────────
  // overrideRagContext가 있으면 키워드 검색 없이 그대로 사용 (노드 직접 선택 분석 등)
  const ragContext = overrideRagContext !== undefined
    ? overrideRagContext
    : await fetchRAGContext(userMessage, persona)
  const systemPrompt = projectContext + basePrompt

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

  // 그래프 컨텍스트를 사용자 메시지 앞에 주입
  // [직접] = 키워드 검색 직접 매칭, [1홉]/[2홉] = WikiLink 연결로 탐색한 문서
  if (ragContext) {
    fullUserMessage = `${ragContext}위 문서들은 볼트의 WikiLink 그래프를 탐색해 수집한 관련 자료입니다.\n답변 시 이 자료들을 참고하여 인사이트와 구체적인 피드백을 제공하세요.\n\n---\n\n${fullUserMessage}`
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
      // Grok does not support vision — notify user if images were attached
      if (imageAttachments.length > 0) {
        onChunk('[Grok은 이미지 분석을 지원하지 않습니다. 텍스트만 처리됩니다.]\n\n')
      }
      await streamCompletion(apiKey, modelId, systemPrompt, allMessages, onChunk)
      break
    }
    default: {
      await streamMockResponse(persona, userMessage, onChunk)
    }
  }
}
