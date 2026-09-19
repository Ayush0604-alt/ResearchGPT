import { gemini } from './providers/gemini'
import type { LLMProvider, ProviderId } from './types'

export const PROVIDERS: Record<ProviderId, LLMProvider> = { gemini }

export function getProvider(id: ProviderId): LLMProvider {
  return PROVIDERS[id]
}

export * from './types'
