import { describe, expect, it } from 'vitest'
import { meterUsage } from './meter'
import type { LLMProvider } from './types'

const provider: LLMProvider = {
  id: 'gemini',
  label: 'Fake',
  keyUrl: '',
  apiHost: '',
  acceptsPdf: false,
  listModels: async () => [],
  stream: async function* () {},
  complete: async (req) => ({
    text: '{}',
    finishReason: 'stop',
    usage: req.model === 'big' ? { inputTokens: 100, outputTokens: 20 } : undefined,
  }),
}

describe('meterUsage', () => {
  it('counts calls and tokens per model', async () => {
    const meter = meterUsage(provider)
    const req = { apiKey: 'k', messages: [] }
    await meter.provider.complete({ ...req, model: 'big' })
    await meter.provider.complete({ ...req, model: 'big' })
    await meter.provider.complete({ ...req, model: 'small' })
    expect(meter.usage()).toEqual({
      big: { calls: 2, input_tokens: 200, output_tokens: 40 },
      small: { calls: 1, input_tokens: 0, output_tokens: 0 },
    })
    // A snapshot, not a live view.
    meter.usage().big.calls = 99
    expect(meter.usage().big.calls).toBe(2)
  })
})
