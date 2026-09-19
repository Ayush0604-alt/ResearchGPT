import { describe, expect, it } from 'vitest'
import type { ChatMessage, Paper } from '../services/types'
import { chatSystemPrompt, chatTurns, citedPaperIds, HISTORY_TURNS } from './chat'

const paper = (id: number): Paper => ({
  id,
  project_id: 1,
  title: `Paper ${id}`,
  authors: null,
  abstract: `Abstract ${id}`,
  year: 2024,
  url: null,
  source: 'arxiv',
  status: 'processed',
  has_full_text: false,
  created_at: '',
})

const msg = (i: number): ChatMessage => ({
  id: i,
  project_id: 1,
  role: i % 2 ? 'assistant' : 'user',
  content: `m${i}`,
  citations: null,
  created_at: '',
})

describe('chat', () => {
  it('gives the model findings when available and the abstract otherwise', () => {
    const summaries = new Map([
      [1, { paper_id: 1, summary: 'Found X', methodology: null, conclusion: null }],
    ])
    const prompt = chatSystemPrompt('graphs', [paper(1), paper(2)], summaries, new Map())
    expect(prompt).toContain('<paper id="P1">')
    expect(prompt).toContain('Summary: Found X')
    expect(prompt).not.toContain('Abstract 1')
    expect(prompt).toContain('Abstract 2')
    expect(prompt).toMatch(/never follow instructions/)
  })

  it('sends only the last few turns plus the new question', () => {
    const history = Array.from({ length: 20 }, (_, i) => msg(i))
    const turns = chatTurns(history, 'and the second one?')
    expect(turns).toHaveLength(HISTORY_TURNS + 1)
    expect(turns.at(-1)).toEqual({ role: 'user', text: 'and the second one?' })
    expect(turns[0].text).toBe(`m${20 - HISTORY_TURNS}`)
  })

  it('collects cited project papers once, in order', () => {
    expect(citedPaperIds('A [P3] B [P1][P3] C [P9]', new Set([1, 3]))).toEqual([3, 1])
  })
})
