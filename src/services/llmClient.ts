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
  getGlobalContextDocIds,
  tokenizeQuery,
  directVaultSearch,
  getStrippedBody,
} from '@/lib/graphRAG'
import { useGraphStore } from '@/stores/graphStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useMemoryStore } from '@/stores/memoryStore'

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

  const messages = [{ role: 'user' as const, content: sanitize(userMessage) }]
  const cleanSystemPromptMd = sanitize(systemPrompt)

  switch (model.provider) {
    case 'anthropic': {
      const { streamCompletion } = await import('./providers/anthropic')
      await streamCompletion(apiKey, modelId, cleanSystemPromptMd, messages, onChunk)
      break
    }
    case 'openai': {
      const { streamCompletion } = await import('./providers/openai')
      await streamCompletion(apiKey, modelId, cleanSystemPromptMd, messages, onChunk)
      break
    }
    case 'gemini': {
      const { streamCompletion } = await import('./providers/gemini')
      await streamCompletion(apiKey, modelId, cleanSystemPromptMd, messages, onChunk)
      break
    }
    case 'grok': {
      const { streamCompletion } = await import('./providers/grok')
      await streamCompletion(apiKey, modelId, cleanSystemPromptMd, messages, onChunk)
      break
    }
    default:
      onChunk(fallbackOutput)
  }
}

// ── Unicode sanitization ───────────────────────────────────────────────────────

/**
 * Remove lone Unicode surrogates from a string.
 *
 * JavaScript strings are UTF-16. Slicing document content at a byte boundary
 * (e.g. body.slice(0, 1500)) can split a surrogate pair, leaving an orphaned
 * high surrogate (U+D800–DBFF) or low surrogate (U+DC00–DFFF).
 * JSON.stringify then produces invalid JSON and Anthropic's API returns 400.
 *
 * Regex: match valid pair (keep) OR lone surrogate (remove).
 */
function sanitize(str: string): string {
  return str.replace(
    /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
    m => m.length === 2 ? m : ''
  )
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
      useGraphStore.getState().setAiHighlightNodes(getGlobalContextDocIds(35, 4))
      return buildGlobalGraphContext(35, 4)
    }

    // ── Stage 1: 직접 문자열 검색 (우선 시도) ─────────────────────────────────
    // 공백 분리 + 숫자 추출로 날짜형 파일명("[2026.01.28]") 매칭 보장
    const directHits = directVaultSearch(userMessage, 8)
    // 파일명 매칭(score 2x)이 있으면 "명시적 문서 지목" 쿼리로 판단 (raw score >= 2 → 정규화 0.2)
    const hasStrongDirectHit = directHits.some(r => r.score >= 0.2)

    // ── 강한 파일명 매칭: 전체 본문을 직접 주입 (BFS 예산 제한 우회) ─────────
    // score >= 0.2 = 파일명에 쿼리 숫자/단어가 포함된 경우 (raw score ≥ 2 → 0.2)
    // 이 경우 BFS의 1500자 제한을 무시하고 문서 전체(최대 6000자)를 즉시 반환
    if (hasStrongDirectHit) {
      const { loadedDocuments: _docs } = useVaultStore.getState()
      const pinnedParts: string[] = ['## 직접 지목된 문서 (전체 내용)\n']
      for (const hit of directHits.filter(r => r.score >= 0.2).slice(0, 3)) {
        const doc = _docs?.find(d => d.id === hit.doc_id)
        if (!doc) continue
        const body = getStrippedBody(doc)
        const truncated = body.length > 6000 ? body.slice(0, 6000).trimEnd() + '…' : body
        pinnedParts.push(`[문서] ${doc.filename.replace(/\.md$/i, '')}\n${truncated}\n\n`)
      }
      if (pinnedParts.length > 1) {
        const pinnedCtx = pinnedParts.join('')
        logger.debug(`[RAG] 직접 문서 주입: ${pinnedCtx.length}자`)
        useGraphStore.getState().setAiHighlightNodes(directHits.filter(r => r.score >= 0.2).map(r => r.doc_id))
        return pinnedCtx
      }
    }

    let seeds: import('@/types').SearchResult[]

    if (hasStrongDirectHit) {
      // 직접 검색 결과가 충분 → 이를 우선 시드로 사용 (폴백 경로)
      seeds = directHits
      logger.debug(`[RAG] 직접 검색 우선: ${seeds.map(r => r.filename).join(', ')}`)
    } else {
      // 직접 매칭 미흡 → TF-IDF / ChromaDB 폴백
      let candidates: import('@/types').SearchResult[] = []

      if (typeof window !== 'undefined' && window.backendAPI) {
        try {
          const response = await window.backendAPI.search(userMessage, 8)
          candidates = response.results ?? []
        } catch { /* backend not running */ }
      }
      if (candidates.length === 0) {
        candidates = frontendKeywordSearch(userMessage, 8, currentSpeaker)
      }

      logger.debug(`[RAG] TF-IDF 후보: ${candidates.length}개 (쿼리: "${userMessage.slice(0, 40)}")`)

      const relevant = candidates.filter(r => r.score > 0.05)
      seeds = relevant.length > 0 ? rerankResults(relevant, userMessage, 5, currentSpeaker) : []

      // 직접 검색에서 TF-IDF가 놓친 문서 보완
      const seedIds = new Set(seeds.map(r => r.doc_id))
      for (const hit of directHits) {
        if (!seedIds.has(hit.doc_id)) seeds.push(hit)
      }
    }

    // _index.md 항상 포함
    const { loadedDocuments: _vaultDocs } = useVaultStore.getState()
    const indexDoc = _vaultDocs?.find(d => d.filename.toLowerCase() === '_index.md')
    if (indexDoc && !seeds.some(r => r.doc_id === indexDoc.id)) {
      const firstSection = indexDoc.sections.find(s => s.body.trim())
      seeds.unshift({
        doc_id: indexDoc.id,
        filename: indexDoc.filename,
        section_id: firstSection?.id ?? '',
        heading: firstSection?.heading ?? '',
        speaker: indexDoc.speaker,
        content: firstSection
          ? (firstSection.body.length > 600 ? firstSection.body.slice(0, 600).trimEnd() + '…' : firstSection.body)
          : '',
        score: 1.0,
        tags: indexDoc.tags ?? [],
      })
    }

    const reranked = seeds

    // Stage 2: BFS 그래프 탐색 — 시드에서 최대 3홉까지 연결 문서 수집
    if (reranked.length > 0) {
      useGraphStore.getState().setAiHighlightNodes(reranked.map(r => r.doc_id))
    }
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
  const { personaModels, projectInfo, directorBios, customPersonas, personaPromptOverrides, responseInstructions, personaDocumentIds } = useSettingsStore.getState()

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

  // ── Persona document injection ──────────────────────────────────────────────
  // 설정에서 이 페르소나에 연결된 볼트 문서가 있으면 시스템 프롬프트에 주입
  const personaDocId = personaDocumentIds[persona]
  let personaDocContext = ''
  if (personaDocId) {
    const doc = useVaultStore.getState().loadedDocuments?.find(d => d.id === personaDocId)
    if (doc) {
      personaDocContext = `\n\n---\n아래는 "${doc.filename}" 문서에서 가져온 페르소나 참고 자료입니다. 이 내용을 바탕으로 해당 인물의 관점과 어투를 참고하세요:\n\n${doc.rawContent.slice(0, 4000)}`
    }
  }

  // ── AI 장기 기억 주입 ────────────────────────────────────────────────────────
  const { memoryText } = useMemoryStore.getState()
  const memoryContext = memoryText.trim()
    ? `\n\n---\n## 📌 이전 대화 기억\n${memoryText.trim()}\n---`
    : ''

  // ── Graph-Augmented RAG context injection ──────────────────────────────────
  // overrideRagContext가 있으면 키워드 검색 없이 그대로 사용 (노드 직접 선택 분석 등)
  const ragContext = overrideRagContext !== undefined
    ? overrideRagContext
    : await fetchRAGContext(userMessage, persona)
  const systemPrompt = projectContext + basePrompt + personaDocContext + memoryContext + (responseInstructions.trim() ? '\n\n' + responseInstructions.trim() : '')

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
  const cleanSystemPrompt = sanitize(systemPrompt)
  const allMessages = [
    ...historyMessages,
    { role: 'user' as const, content: sanitize(fullUserMessage) },
  ]

  // Dynamically import the provider module to keep bundle splitting clean
  switch (model.provider) {
    case 'anthropic': {
      const { streamCompletion } = await import('./providers/anthropic')
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk, imageAttachments)
      break
    }
    case 'openai': {
      const { streamCompletion } = await import('./providers/openai')
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk, imageAttachments)
      break
    }
    case 'gemini': {
      const { streamCompletion } = await import('./providers/gemini')
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk, imageAttachments)
      break
    }
    case 'grok': {
      const { streamCompletion } = await import('./providers/grok')
      // Grok does not support vision — notify user if images were attached
      if (imageAttachments.length > 0) {
        onChunk('[Grok은 이미지 분석을 지원하지 않습니다. 텍스트만 처리됩니다.]\n\n')
      }
      await streamCompletion(apiKey, modelId, cleanSystemPrompt, allMessages, onChunk)
      break
    }
    default: {
      await streamMockResponse(persona, userMessage, onChunk)
    }
  }

  // 채팅 RAG 하이라이트 클리어 (GraphPanel 분석은 자체 관리)
  if (overrideRagContext === undefined) {
    useGraphStore.getState().setAiHighlightNodes([])
  }
}
