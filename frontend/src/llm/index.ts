import { anthropic } from './providers/anthropic'
import { gemini } from './providers/gemini'
import { openai } from './providers/openai'
import type { LLMProvider, ProviderId } from './types'

export const PROVIDERS: Record<ProviderId, LLMProvider> = { gemini, anthropic, openai }

export function getProvider(id: ProviderId): LLMProvider {
  return PROVIDERS[id] ?? gemini
}

export * from './types'
export { estimateTokens, generateJSON } from './generate'
