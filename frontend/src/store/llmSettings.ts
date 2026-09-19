import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModelInfo, ProviderId } from '../llm/types'

// The user's own LLM key. Stored ONLY in this browser (localStorage, under its
// own name so logging out doesn't erase it) and sent only to the provider.
// Never send it to the ResearchGPT API, log it, or put it in an error message.

interface LLMSettingsState {
  provider: ProviderId
  apiKey: string
  /** True once the current key passed a test call. */
  verified: boolean
  models: ModelInfo[]
  /** Fast model for per-paper extraction. */
  extractModel: string
  /** Stronger model for the review synthesis and chat. */
  synthModel: string
  setKey: (apiKey: string) => void
  markVerified: (models: ModelInfo[]) => void
  setModels: (models: { extractModel?: string; synthModel?: string }) => void
  clear: () => void
}

const DEFAULT_MODEL = 'gemini-2.5-flash'

/** Prefer the default model when the key offers it, else the first "flash" model. */
function pickDefault(models: ModelInfo[], current: string): string {
  const ids = models.map((m) => m.id)
  if (ids.includes(current)) return current
  if (ids.includes(DEFAULT_MODEL)) return DEFAULT_MODEL
  return ids.find((id) => id.includes('flash')) ?? ids[0] ?? current
}

const initial = {
  provider: 'gemini' as ProviderId,
  apiKey: '',
  verified: false,
  models: [] as ModelInfo[],
  extractModel: DEFAULT_MODEL,
  synthModel: DEFAULT_MODEL,
}

export const useLLMSettings = create<LLMSettingsState>()(
  persist(
    (set) => ({
      ...initial,
      setKey: (apiKey) => set({ apiKey: apiKey.trim(), verified: false }),
      markVerified: (models) =>
        set((s) => ({
          verified: true,
          models,
          extractModel: pickDefault(models, s.extractModel),
          synthModel: pickDefault(models, s.synthModel),
        })),
      setModels: (models) => set(models),
      clear: () => set(initial),
    }),
    { name: 'researchgpt-llm' },
  ),
)

/** True when a tested key is available. */
export const useHasVerifiedKey = () => useLLMSettings((s) => s.verified && Boolean(s.apiKey))
