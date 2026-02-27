import type { DirectorId } from '@/types'

// ── Provider identity ─────────────────────────────────────────────────────────

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'grok'

// ── Model catalogue ───────────────────────────────────────────────────────────

export interface ModelOption {
  id: string
  label: string
  provider: ProviderId
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'claude-opus-4-5',              label: 'Claude Opus 4.5',      provider: 'anthropic' },
  { id: 'claude-sonnet-4-5',            label: 'Claude Sonnet 4.5',    provider: 'anthropic' },
  { id: 'claude-3-5-sonnet-20241022',   label: 'Claude 3.5 Sonnet',    provider: 'anthropic' },
  { id: 'claude-3-5-haiku-20241022',    label: 'Claude 3.5 Haiku',     provider: 'anthropic' },
  { id: 'gpt-4o',                       label: 'GPT-4o',               provider: 'openai'    },
  { id: 'gpt-4o-mini',                  label: 'GPT-4o Mini',          provider: 'openai'    },
  { id: 'gemini-2.0-flash',             label: 'Gemini 2.0 Flash',     provider: 'gemini'    },
  { id: 'gemini-1.5-pro',               label: 'Gemini 1.5 Pro',       provider: 'gemini'    },
  { id: 'grok-3',                       label: 'Grok-3',               provider: 'grok'      },
  { id: 'grok-3-mini',                  label: 'Grok-3 Mini',          provider: 'grok'      },
]

// ── Default persona → model mapping ──────────────────────────────────────────

export const DEFAULT_PERSONA_MODELS: Record<DirectorId, string> = {
  chief_director: 'claude-3-5-sonnet-20241022',
  art_director:   'gpt-4o',
  plan_director:  'gemini-2.0-flash',
  level_director: 'grok-3',
  prog_director:  'claude-3-5-haiku-20241022',
}

// ── Helper ────────────────────────────────────────────────────────────────────

/** Get provider for a given model ID. Returns undefined if model not found. */
export function getProviderForModel(modelId: string): ProviderId | undefined {
  return MODEL_OPTIONS.find((m) => m.id === modelId)?.provider
}

/** Get VITE env var name for a given provider */
export function envKeyForProvider(provider: ProviderId): string {
  return `VITE_${provider.toUpperCase()}_API_KEY`
}
