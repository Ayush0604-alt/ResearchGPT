import { describe, expect, it } from 'vitest'
import type { CompletionRequest, LLMProvider } from '../llm/types'
import type { Candidate } from '../services/types'
import { RunError } from './runAnalysis'
import {
  planQueries,
  screenCandidates,
  screeningPrompt,
  selectPapers,
  snowballSeeds,
  SCREEN_BATCH,
  type Rating,
} from './screening'

function provider(answer: (req: CompletionRequest) => unknown) {
  const calls: CompletionRequest[] = []
  const p: LLMProvider = {
    id: 'gemini',
    label: 'Fake',
    keyUrl: '',
    apiHost: '',
    listModels: async () => [],
    stream: async function* () {},
    complete: async (req) => {
      calls.push(req)
      return { text: JSON.stringify(answer(req)), finishReason: 'stop' }
    },
  }
  return { p, calls }
}

const deps = (p: LLMProvider) => ({
  provider: p,
  apiKey: 'k',
  model: 'fast',
  signal: new AbortController().signal,
})

const candidate = (id: number): Candidate => ({
  id,
  title: `Paper ${id}`,
  authors: [],
  abstract: 'x'.repeat(2000),
  year: 2024,
  source: 'openalex',
  doi: null,
  has_pdf: true,
})

const rating = (id: number, score: number): Rating => ({ id, score, reason: 'r' })

describe('planQueries', () => {
  it('cleans, de-duplicates and caps the planned queries', async () => {
    const { p } = provider(() => ({
      queries: ['  graph   transformers ', 'Graph Transformers', 'topic', 'a', 'gnn', 'gat', 'x y'],
    }))
    expect(await planQueries('topic', deps(p))).toEqual(['graph transformers', 'gnn', 'gat', 'x y'])
  })
})

describe('screenCandidates', () => {
  it('rates every candidate in batches, clamping scores and filling gaps', async () => {
    const candidates = Array.from({ length: SCREEN_BATCH + 3 }, (_, i) => candidate(i))
    const { p, calls } = provider((req) => {
      const ids = [...req.messages[0].text.matchAll(/<paper id="C(\d+)">/g)].map((m) => +m[1])
      // Skip id 1; give out-of-range scores to test clamping; rate a foreign id.
      return {
        ratings: [
          ...ids
            .filter((id) => id !== 1)
            .map((id) => ({ id, score: id === 0 ? 15 : -2, reason: 'r' })),
          { id: 999, score: 10, reason: 'not in this batch' },
        ],
      }
    })
    const progress: number[] = []

    const ratings = await screenCandidates('t', candidates, deps(p), (done) => progress.push(done))

    expect(calls).toHaveLength(2)
    expect(ratings).toHaveLength(candidates.length)
    expect(ratings[0].score).toBe(10)
    expect(ratings[1]).toEqual({ id: 1, score: 0, reason: 'Not rated' })
    expect(ratings[2].score).toBe(0)
    expect(progress.at(-1)).toBe(candidates.length)
  })

  it('treats paper text as untrusted and trims long abstracts', () => {
    const prompt = screeningPrompt('t', [candidate(7)])
    expect(prompt).toContain('<paper id="C7">')
    expect(prompt.length).toBeLessThan(1700)
  })
})

describe('selectPapers', () => {
  it('keeps relevant papers, best first, up to the limit', () => {
    const chosen = selectPapers([rating(0, 6), rating(1, 9), rating(2, 2), rating(3, 7)], 2)
    expect(chosen.map((r) => r.id)).toEqual([1, 3])
  })

  it('keeps search order for equal scores', () => {
    expect(selectPapers([rating(4, 8), rating(2, 8), rating(9, 8)], 3).map((r) => r.id)).toEqual([
      4, 2, 9,
    ])
  })

  it('falls back to the best few when a narrow topic has fewer than 3 strong matches', () => {
    const chosen = selectPapers([rating(0, 9), rating(1, 4), rating(2, 3), rating(3, 1)], 10)
    expect(chosen.map((r) => r.id)).toEqual([0, 1, 2])
  })

  it('refuses to analyse unrelated papers', () => {
    expect(() => selectPapers([rating(0, 2), rating(1, 0)], 10)).toThrow(RunError)
  })
})

describe('snowballSeeds', () => {
  it('uses up to 3 of the best-rated candidates that have a DOI', () => {
    const cands = [0, 1, 2, 3, 4].map((id) => ({
      ...candidate(id),
      doi: id === 1 ? null : `10.1/${id}`,
    }))
    const ratings = [rating(0, 6), rating(1, 10), rating(2, 9), rating(3, 8), rating(4, 2)]
    expect(snowballSeeds(ratings, cands)).toEqual([2, 3, 0])
  })
})
