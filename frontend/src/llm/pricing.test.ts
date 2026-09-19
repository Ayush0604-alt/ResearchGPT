import { describe, expect, it } from 'vitest'
import { estimateRun, formatUsd, priceFor } from './pricing'

describe('priceFor', () => {
  it('uses overrides, then the longest known prefix', () => {
    expect(priceFor('gemini-2.5-flash')).toEqual({ input: 0.3, output: 2.5 })
    expect(priceFor('gemini-2.5-flash-lite')).toEqual({ input: 0.1, output: 0.4 })
    expect(priceFor('gemini-2.5-flash-preview-09-2025')).toEqual({ input: 0.3, output: 2.5 })
    expect(priceFor('gpt-5-mini-2025-08-07')).toEqual({ input: 0.25, output: 2 })
    expect(priceFor('some-new-model')).toBeNull()
    expect(priceFor('some-new-model', { 'some-new-model': { input: 1, output: 2 } })).toEqual({
      input: 1,
      output: 2,
    })
  })
})

describe('estimateRun', () => {
  const run = { papers: 10, extractModel: 'gemini-2.5-flash', synthModel: 'gemini-2.5-pro' }

  it('prices a run by tier', () => {
    const text = estimateRun({ ...run, sendPdfs: false })
    const pdf = estimateRun({ ...run, sendPdfs: true })
    expect(text.usd).toBeGreaterThan(0.01)
    expect(text.usd).toBeLessThan(1)
    expect(pdf.usd!).toBeGreaterThan(text.usd!) // PDFs cost more tokens
    expect(pdf.inputTokens).toBeGreaterThan(text.inputTokens)
  })

  it('has no price when a model is unknown, but still counts tokens', () => {
    const est = estimateRun({ ...run, synthModel: 'mystery', sendPdfs: false })
    expect(est.usd).toBeNull()
    expect(est.inputTokens).toBeGreaterThan(0)
  })

  it('formats small amounts', () => {
    expect(formatUsd(0.004)).toBe('< $0.01')
    expect(formatUsd(0.123)).toBe('$0.12')
    expect(formatUsd(2.46)).toBe('$2.5')
  })
})
