/**
 * tagService.ts
 *
 * AI 태그 제안: 문서 파일명 + 내용(첫 300자)을 설정된 모델로 분석하여
 * 사용자가 정의한 tagPresets 목록 내에서 적합한 태그를 JSON 배열로 반환한다.
 * 확신이 없으면 빈 배열([])을 반환 → 사이드바에서 "미분류"로 표시됨.
 */

import { useSettingsStore, getApiKey } from '@/stores/settingsStore'
import { getProviderForModel } from '@/lib/modelConfig'
import { streamCompletion } from './providers/anthropic'

const SYSTEM_PROMPT = `당신은 문서 분류 전문가입니다.
주어진 문서에 대해 제공된 태그 목록 중 적합한 것만 골라 JSON 배열로만 응답하세요.
응답은 반드시 유효한 JSON 배열 형태여야 합니다. 예: ["전투", "스킬"]
확신이 없으면 빈 배열 []을 반환하세요.
설명이나 다른 텍스트는 절대 포함하지 마세요.`

/**
 * 주어진 문서에 적합한 태그를 AI로 제안한다.
 * tagPresets가 비어있거나 API 키가 없으면 즉시 [] 반환.
 */
export async function suggestTagsForDoc(
  docFilename: string,
  docContent: string
): Promise<string[]> {
  const state = useSettingsStore.getState()
  const { tagPresets, personaModels } = state

  if (tagPresets.length === 0) return []

  const modelId = personaModels['chief_director']
  if (!modelId) return []

  const provider = getProviderForModel(modelId)
  if (provider !== 'anthropic') return [] // 현재는 Anthropic만 지원

  const apiKey = getApiKey('anthropic')
  if (!apiKey) return []

  const contentPreview = docContent.replace(/^---[\s\S]*?---\n*/m, '').slice(0, 300)
  const userMessage = `파일명: ${docFilename}
내용 (앞부분):
${contentPreview}

허용 태그 목록: ${tagPresets.join(', ')}

이 문서에 적합한 태그를 위 목록에서만 골라 JSON 배열로 반환하세요.`

  let result = ''
  try {
    await streamCompletion(apiKey, modelId, SYSTEM_PROMPT, [
      { role: 'user', content: userMessage },
    ], (chunk) => { result += chunk })
  } catch {
    return []
  }

  // JSON 배열 파싱 + tagPresets에 있는 태그만 필터
  try {
    const match = result.match(/\[[\s\S]*\]/)
    if (!match) return []
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is string =>
      typeof t === 'string' && tagPresets.includes(t)
    )
  } catch {
    return []
  }
}
