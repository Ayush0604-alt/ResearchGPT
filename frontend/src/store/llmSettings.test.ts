import { beforeEach, describe, expect, it } from 'vitest'
import { pickModel, useLLMSettings } from './llmSettings'

const models = (...ids: string[]) => ids.map((id) => ({ id, label: id }))

describe('pickModel', () => {
  it('keeps the current choice, else the provider default for the tier, else a tier hint', () => {
    const offered = models('claude-haiku-4-5', 'claude-opus-5', 'claude-sonnet-5')
    expect(pickModel(offered, 'claude-sonnet-5', 'anthropic', 'strong')).toBe('claude-sonnet-5')
    expect(pickModel(offered, 'gone', 'anthropic', 'fast')).toBe('claude-haiku-4-5')
    expect(pickModel(offered, 'gone', 'anthropic', 'strong')).toBe('claude-opus-5')
    expect(pickModel(models('gemini-3-flash', 'gemini-3-pro'), 'x', 'gemini', 'fast')).toBe(
      'gemini-3-flash',
    )
  })
})

describe('switching provider', () => {
  beforeEach(() => {
    useLLMSettings.getState().setProvider('gemini')
  })

  it('clears the key and sets the new default models, keeping custom prices', () => {
    const s = useLLMSettings.getState()
    s.setKey('AIza-something')
    s.setPrice('claude-opus-5', { input: 1, output: 2 })
    s.setProvider('anthropic')

    const after = useLLMSettings.getState()
    expect(after.apiKey).toBe('')
    expect(after.verified).toBe(false)
    expect(after.extractModel).toBe('claude-haiku-4-5')
    expect(after.synthModel).toBe('claude-opus-5')
    expect(after.prices['claude-opus-5']).toEqual({ input: 1, output: 2 })

    after.clear()
    expect(useLLMSettings.getState().provider).toBe('anthropic') // clearing keeps the provider
  })
})
