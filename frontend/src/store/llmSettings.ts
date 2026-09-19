import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PROVIDERS } from '../llm'
import type { Price } from '../llm/pricing'
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
  /** Send the paper PDF itself when the provider can read it (tables, figures). */
  sendPdfs: boolean
  /** The user's own prices (USD per million tokens), overriding the defaults. */
  prices: Record<string, Price>
  /** Switch provider. The key belongs to one provider, so it is cleared. */
  setProvider: (provider: ProviderId) => void
  setPrice: (model: string, price: Price | null) => void
  setKey: (apiKey: string) => void
  markVerified: (models: ModelInfo[]) => void
  setModels: (models: { extractModel?: string; synthModel?: string }) => void
  setSendPdfs: (sendPdfs: boolean) => void
  clear: () => void
}

/** Words that mark a model family's fast or strong tier, for keys without the defaults. */
const TIER_HINTS = { fast: /flash|haiku|mini/, strong: /pro|opus|sonnet|^gpt-5$/ }

/** Keep the current choice if the key offers it, else the provider's default for the tier. */
export function pickModel(
  models: ModelInfo[],
  current: string,
  provider: ProviderId,
  tier: 'fast' | 'strong',
): string {
  const ids = models.map((m) => m.id)
  if (ids.includes(current)) return current
  const preferred = PROVIDERS[provider].defaultModels[tier]
  if (ids.includes(preferred)) return preferred
  return ids.find((id) => TIER_HINTS[tier].test(id)) ?? ids[0] ?? current
}

const forProvider = (provider: ProviderId) => ({
  provider,
  apiKey: '',
  verified: false,
  models: [] as ModelInfo[],
  extractModel: PROVIDERS[provider].defaultModels.fast,
  synthModel: PROVIDERS[provider].defaultModels.strong,
})

const initial = {
  ...forProvider('gemini'),
  sendPdfs: true,
  prices: {} as Record<string, Price>,
}

export const useLLMSettings = create<LLMSettingsState>()(
  persist(
    (set) => ({
      ...initial,
      setProvider: (provider) => set((s) => (s.provider === provider ? {} : forProvider(provider))),
      setPrice: (model, price) =>
        set((s) => {
          const prices = { ...s.prices }
          if (price) prices[model] = price
          else delete prices[model]
          return { prices }
        }),
      setKey: (apiKey) => set({ apiKey: apiKey.trim(), verified: false }),
      markVerified: (models) =>
        set((s) => ({
          verified: true,
          models,
          extractModel: pickModel(models, s.extractModel, s.provider, 'fast'),
          synthModel: pickModel(models, s.synthModel, s.provider, 'strong'),
        })),
      setModels: (models) => set(models),
      setSendPdfs: (sendPdfs) => set({ sendPdfs }),
      clear: () => set((s) => forProvider(s.provider)),
    }),
    { name: 'researchgpt-llm' },
  ),
)

/** True when a tested key is available. */
export const useHasVerifiedKey = () => useLLMSettings((s) => s.verified && Boolean(s.apiKey))
