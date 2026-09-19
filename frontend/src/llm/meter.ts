import type { LLMProvider } from './types'

export interface ModelUsage {
  calls: number
  input_tokens: number
  output_tokens: number
}

export interface UsageMeter {
  /** The same provider, counting every completion it makes (retries included). */
  provider: LLMProvider
  /** Tokens so far, per model. */
  usage(): Record<string, ModelUsage>
}

/** Wrap a provider so a run can report what it used, per model. */
export function meterUsage(provider: LLMProvider): UsageMeter {
  const usage: Record<string, ModelUsage> = {}
  return {
    provider: {
      ...provider,
      complete: async (req) => {
        const completion = await provider.complete(req)
        const entry = (usage[req.model] ??= { calls: 0, input_tokens: 0, output_tokens: 0 })
        entry.calls += 1
        entry.input_tokens += completion.usage?.inputTokens ?? 0
        entry.output_tokens += completion.usage?.outputTokens ?? 0
        return completion
      },
    },
    usage: () => structuredClone(usage),
  }
}
