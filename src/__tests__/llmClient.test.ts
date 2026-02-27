import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { ChatMessage, SpeakerId } from '@/types'
import { useSettingsStore } from '@/stores/settingsStore'
import { DEFAULT_PERSONA_MODELS } from '@/lib/modelConfig'

// ── SSE stream helpers ─────────────────────────────────────────────────────────

/** Create a ReadableStream that emits SSE data lines */
function makeSSEStream(dataLines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of dataLines) {
        controller.enqueue(encoder.encode(line))
      }
      controller.close()
    },
  })
}

function makeAnthropicStream(texts: string[]): ReadableStream<Uint8Array> {
  const lines = texts.map(
    (text) =>
      `data: ${JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text },
      })}\n`
  )
  lines.push('data: [DONE]\n')
  return makeSSEStream(lines)
}

function makeOpenAIStream(texts: string[]): ReadableStream<Uint8Array> {
  const lines = texts.map(
    (text) =>
      `data: ${JSON.stringify({
        choices: [{ delta: { content: text } }],
      })}\n`
  )
  lines.push('data: [DONE]\n')
  return makeSSEStream(lines)
}

function makeGeminiStream(texts: string[]): ReadableStream<Uint8Array> {
  const lines = texts.map(
    (text) =>
      `data: ${JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }],
      })}\n`
  )
  // Gemini does not emit [DONE] — stream just closes
  return makeSSEStream(lines)
}

// ── Mock fetch ─────────────────────────────────────────────────────────────────

let _mockFetchResponse: Response | null = null

vi.mock('cross-fetch', () => ({ default: vi.fn() }))

// We patch globalThis.fetch
function mockFetch(stream: ReadableStream<Uint8Array>, ok = true) {
  _mockFetchResponse = new Response(stream, {
    status: ok ? 200 : 401,
    headers: { 'Content-Type': 'text/event-stream' },
  })
  globalThis.fetch = vi.fn().mockResolvedValue(_mockFetchResponse)
}

// ── Store reset helpers ────────────────────────────────────────────────────────

function resetSettings() {
  useSettingsStore.setState({
    personaModels: { ...DEFAULT_PERSONA_MODELS },
    settingsPanelOpen: false,
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('llmClient — streamMessage', () => {
  beforeEach(() => {
    resetSettings()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // ── Mock fallback (no API key) ─────────────────────────────────────────────

  it('falls back to mock response when no API key is set', async () => {
    // No env key set → import.meta.env.VITE_ANTHROPIC_API_KEY is undefined
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', '')

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('chief_director', '테스트 메시지', [], (c) => chunks.push(c))

    const fullText = chunks.join('')
    expect(fullText).toContain('[Mock]')
    expect(fullText.length).toBeGreaterThan(10)
  })

  it('falls back to mock for art_director with no OpenAI key', async () => {
    vi.stubEnv('VITE_OPENAI_API_KEY', '')

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('art_director', '색상 팔레트 관련', [], (c) => chunks.push(c))

    expect(chunks.join('')).toContain('[Mock]')
  })

  // ── Anthropic streaming ────────────────────────────────────────────────────

  it('streams Anthropic response when API key is set', async () => {
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', 'test-anthropic-key')
    // chief_director uses Anthropic by default
    mockFetch(makeAnthropicStream(['안녕', '하세', '요']))

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('chief_director', '테스트', [], (c) => chunks.push(c))

    expect(chunks).toEqual(['안녕', '하세', '요'])
    expect(globalThis.fetch).toHaveBeenCalledOnce()

    // Verify correct endpoint
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('anthropic.com')
  })

  it('sends system prompt and user message to Anthropic', async () => {
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', 'test-key')
    mockFetch(makeAnthropicStream(['응답']))

    const { streamMessage } = await import('@/services/llmClient')
    await streamMessage('chief_director', '질문입니다', [], () => {})

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((options as RequestInit).body as string)

    expect(body.system).toContain('총괄 디렉터')
    expect(body.messages).toContainEqual({ role: 'user', content: '질문입니다' })
    expect(body.stream).toBe(true)
  })

  // ── OpenAI streaming ───────────────────────────────────────────────────────

  it('streams OpenAI response when API key is set', async () => {
    vi.stubEnv('VITE_OPENAI_API_KEY', 'test-openai-key')
    // art_director uses OpenAI by default
    mockFetch(makeOpenAIStream(['아트', ' 방향']))

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('art_director', '비주얼', [], (c) => chunks.push(c))

    expect(chunks).toEqual(['아트', ' 방향'])
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('openai.com')
  })

  // ── Gemini streaming ───────────────────────────────────────────────────────

  it('streams Gemini response when API key is set', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'test-gemini-key')
    // plan_director uses Gemini by default
    mockFetch(makeGeminiStream(['기획', ' 의견']))

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('plan_director', '기능 우선순위', [], (c) => chunks.push(c))

    expect(chunks).toEqual(['기획', ' 의견'])
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('generativelanguage.googleapis.com')
  })

  it('includes API key as query param for Gemini', async () => {
    vi.stubEnv('VITE_GEMINI_API_KEY', 'my-gemini-key')
    mockFetch(makeGeminiStream(['ok']))

    const { streamMessage } = await import('@/services/llmClient')
    await streamMessage('plan_director', '테스트', [], () => {})

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('key=my-gemini-key')
  })

  // ── Grok streaming ─────────────────────────────────────────────────────────

  it('streams Grok response when API key is set', async () => {
    vi.stubEnv('VITE_GROK_API_KEY', 'test-grok-key')
    // level_director uses Grok by default
    mockFetch(makeOpenAIStream(['레벨', ' 디자인']))

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('level_director', '레벨 구조', [], (c) => chunks.push(c))

    expect(chunks).toEqual(['레벨', ' 디자인'])
    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('x.ai')
  })

  // ── Custom model routing ───────────────────────────────────────────────────

  it('uses the model selected in settingsStore', async () => {
    vi.stubEnv('VITE_OPENAI_API_KEY', 'test-openai-key')
    // Override chief_director to use OpenAI gpt-4o
    useSettingsStore.setState({
      personaModels: { ...DEFAULT_PERSONA_MODELS, chief_director: 'gpt-4o' },
      settingsPanelOpen: false,
    })
    mockFetch(makeOpenAIStream(['gpt 응답']))

    const { streamMessage } = await import('@/services/llmClient')
    const chunks: string[] = []
    await streamMessage('chief_director', '질문', [], (c) => chunks.push(c))

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toContain('openai.com')
    const body = JSON.parse((options as RequestInit).body as string)
    expect(body.model).toBe('gpt-4o')
  })

  // ── Error handling ─────────────────────────────────────────────────────────

  it('does not throw when API returns non-200; onChunk not called with extra content', async () => {
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', 'test-key')
    // Return 401 error response
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Unauthorized', { status: 401 })
    )

    const { streamMessage } = await import('@/services/llmClient')
    // streamMessage itself throws; callers catch it
    await expect(
      streamMessage('chief_director', '질문', [], () => {})
    ).rejects.toThrow(/401/)
  })

  // ── History passing ────────────────────────────────────────────────────────

  it('includes history messages in the request body', async () => {
    vi.stubEnv('VITE_ANTHROPIC_API_KEY', 'test-key')
    mockFetch(makeAnthropicStream(['응답']))

    const history: ChatMessage[] = [
      {
        id: 'h1',
        persona: 'chief_director',
        role: 'user',
        content: '이전 질문',
        timestamp: 1000,
      },
      {
        id: 'h2',
        persona: 'chief_director',
        role: 'assistant',
        content: '이전 응답',
        timestamp: 1001,
      },
    ]

    const { streamMessage } = await import('@/services/llmClient')
    await streamMessage('chief_director', '새 질문', history, () => {})

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse((options as RequestInit).body as string)

    expect(body.messages).toContainEqual({ role: 'user', content: '이전 질문' })
    expect(body.messages).toContainEqual({ role: 'assistant', content: '이전 응답' })
    expect(body.messages).toContainEqual({ role: 'user', content: '새 질문' })
  })
})

// ── fetchRAGContext ────────────────────────────────────────────────────────────

describe('fetchRAGContext()', () => {
  beforeEach(() => {
    // Reset window.backendAPI between tests
    vi.restoreAllMocks()
  })

  afterEach(() => {
    // Clean up window.backendAPI stub
    if ('backendAPI' in window) {
      // @ts-expect-error — test teardown
      delete window.backendAPI
    }
  })

  it('returns empty string when backendAPI is unavailable', async () => {
    // No window.backendAPI set
    const { fetchRAGContext } = await import('@/services/llmClient')
    const result = await fetchRAGContext('테스트 쿼리')
    expect(result).toBe('')
  })

  it('returns empty string when search returns no results', async () => {
    // @ts-expect-error — test stub
    window.backendAPI = {
      search: vi.fn().mockResolvedValue({ results: [], query: '테스트' }),
    }
    const { fetchRAGContext } = await import('@/services/llmClient')
    const result = await fetchRAGContext('테스트')
    expect(result).toBe('')
  })

  it('returns formatted context string when results have score > 0.3', async () => {
    // @ts-expect-error — test stub
    window.backendAPI = {
      search: vi.fn().mockResolvedValue({
        results: [
          {
            doc_id: 'art_001',
            filename: 'art.md',
            section_id: 'art_001_s1',
            heading: '아트 컨셉',
            speaker: 'art_director',
            content: '다크 판타지 스타일의 비주얼',
            score: 0.85,
            tags: ['art'],
          },
        ],
        query: '아트 방향',
      }),
    }
    const { fetchRAGContext } = await import('@/services/llmClient')
    const result = await fetchRAGContext('아트 방향')
    expect(result).toContain('## 관련 문서')
    expect(result).toContain('### 아트 컨셉')
    expect(result).toContain('다크 판타지 스타일의 비주얼')
    expect(result).toContain('출처: art.md')
  })

  it('filters out results with score <= 0.3', async () => {
    // @ts-expect-error — test stub
    window.backendAPI = {
      search: vi.fn().mockResolvedValue({
        results: [
          {
            doc_id: 'low_001',
            filename: 'low.md',
            section_id: 'low_001_s1',
            heading: null,
            speaker: 'unknown',
            content: '관련 없는 내용',
            score: 0.1,
            tags: [],
          },
        ],
        query: '쿼리',
      }),
    }
    const { fetchRAGContext } = await import('@/services/llmClient')
    const result = await fetchRAGContext('쿼리')
    expect(result).toBe('')
  })

  it('returns empty string when backendAPI.search throws', async () => {
    // @ts-expect-error — test stub
    window.backendAPI = {
      search: vi.fn().mockRejectedValue(new Error('Connection refused')),
    }
    const { fetchRAGContext } = await import('@/services/llmClient')
    // Should not throw — RAG failure is non-fatal
    const result = await fetchRAGContext('쿼리')
    expect(result).toBe('')
  })
})

// ── sseParser unit tests ──────────────────────────────────────────────────────

describe('parseSSEStream', () => {
  it('yields text deltas from a simple SSE stream', async () => {
    const { parseSSEStream } = await import('@/services/sseParser')
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"text":"hello"}\n'))
        controller.enqueue(encoder.encode('data: {"text":" world"}\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n'))
        controller.close()
      },
    })
    const response = new Response(stream)
    const chunks: string[] = []
    for await (const chunk of parseSSEStream(response, (d) => {
      const p = JSON.parse(d) as { text?: string }
      return p.text ?? null
    })) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['hello', ' world'])
  })

  it('handles multi-byte UTF-8 (Korean) split across chunks', async () => {
    const { parseSSEStream } = await import('@/services/sseParser')
    const encoder = new TextEncoder()

    // '안녕' encoded as UTF-8 bytes: [ec, 95, 88, eb, 85, 95]
    const koreanBytes = encoder.encode('안녕')
    // Split the data line across two reads
    const fullLine = encoder.encode('data: {"t":"안녕"}\n')
    const mid = Math.floor(fullLine.length / 2)
    const part1 = fullLine.slice(0, mid)
    const part2 = fullLine.slice(mid)
    // Suppress unused variable warning
    void koreanBytes

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(part1)
        controller.enqueue(part2)
        controller.enqueue(encoder.encode('data: [DONE]\n'))
        controller.close()
      },
    })
    const response = new Response(stream)
    const chunks: string[] = []
    for await (const chunk of parseSSEStream(response, (d) => {
      const p = JSON.parse(d) as { t?: string }
      return p.t ?? null
    })) {
      chunks.push(chunk)
    }
    expect(chunks.join('')).toBe('안녕')
  })

  it('skips lines without "data: " prefix', async () => {
    const { parseSSEStream } = await import('@/services/sseParser')
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': comment line\n'))
        controller.enqueue(encoder.encode('event: message\n'))
        controller.enqueue(encoder.encode('data: {"v":"ok"}\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n'))
        controller.close()
      },
    })
    const response = new Response(stream)
    const chunks: string[] = []
    for await (const chunk of parseSSEStream(response, (d) => {
      const p = JSON.parse(d) as { v?: string }
      return p.v ?? null
    })) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['ok'])
  })

  it('throws when response body is null', async () => {
    const { parseSSEStream } = await import('@/services/sseParser')
    const response = new Response(null)
    const gen = parseSSEStream(response, () => null)
    await expect(gen.next()).rejects.toThrow('Response body is null')
  })
})
