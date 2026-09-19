import { describe, expect, it } from 'vitest'
import type { CompletionRequest, LLMProvider } from '../llm/types'
import type { Review } from './prompts'
import { extractClaims, verifyClaims } from './verify'

const review = (body: string): Review => ({
  introduction: '## Scope\n\nGraphs matter a great deal [P1]. This sentence has no citation.',
  body,
  comparison: '| Paper | Result |\n|---|---|\n| [P1] | 0.8 |',
  trends: '',
  gaps: '',
  discussion: '- Transformers beat message passing on molecules [P1][P2].',
  conclusion: '',
})

describe('extractClaims', () => {
  it('keeps cited sentences only, strips list markers, skips the comparison table', () => {
    const claims = extractClaims(review('Attention scales poorly with graph size [P2]. Ok.'))
    expect(claims).toEqual([
      { claim: 'Graphs matter a great deal [P1].', paper_ids: [1] },
      { claim: 'Attention scales poorly with graph size [P2].', paper_ids: [2] },
      { claim: 'Transformers beat message passing on molecules [P1][P2].', paper_ids: [1, 2] },
    ])
  })

  it('caps the number of claims', () => {
    const body = Array.from({ length: 60 }, (_, i) => `Claim number ${i} is cited here [P1].`).join(
      ' ',
    )
    expect(extractClaims(review(body), 40)).toHaveLength(40)
  })
})

describe('verifyClaims', () => {
  it('maps verdicts back to claims, in batches, with evidence from the cited papers', async () => {
    const calls: CompletionRequest[] = []
    const provider: LLMProvider = {
      id: 'gemini',
      label: 'Fake',
      keyUrl: '',
      apiHost: '',
      acceptsPdf: false,
      listModels: async () => [],
      stream: async function* () {},
      complete: async (req) => {
        calls.push(req)
        const n = [...req.messages[0].text.matchAll(/CLAIM (\d+):/g)].length
        const checks = Array.from({ length: n }, (_, i) => ({
          index: i,
          verdict: i === 0 ? 'unsupported' : 'supported',
          note: 'Not in the evidence',
        }))
        return { text: JSON.stringify({ checks }), finishReason: 'stop' }
      },
    }
    const claims = Array.from({ length: 12 }, (_, i) => ({ claim: `C${i} [P1]`, paper_ids: [1] }))
    const summaries = new Map([
      [1, { paper_id: 1, summary: 'Found X', methodology: null, conclusion: null }],
    ])

    const checks = await verifyClaims(claims, summaries, new Map(), {
      provider,
      apiKey: 'k',
      model: 'fast',
      signal: new AbortController().signal,
    })

    expect(calls).toHaveLength(2) // 10 + 2
    expect(calls[0].messages[0].text).toContain('Summary: Found X')
    expect(checks).toHaveLength(12)
    expect(checks[0]).toMatchObject({ claim: 'C0 [P1]', verdict: 'unsupported' })
    expect(checks[1].note).toBe('') // notes only for flagged claims
    expect(checks[10].verdict).toBe('unsupported') // first of the second batch
  })
})
