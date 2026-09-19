import { describe, expect, it } from 'vitest'
import type { ChatMessage, Paper } from '../services/types'
import { chatSystemPrompt, chatTurns, citedPaperIds, HISTORY_TURNS, passageQuery } from './chat'

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
  doi: null,
  relevance_score: null,
  relevance_reason: null,
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

  it('adds matching passages from project papers only, as data', () => {
    const prompt = chatSystemPrompt('graphs', [paper(1)], new Map(), new Map(), [
      { paper_id: 1, text: 'We use ogbg-molhiv.' },
      { paper_id: 99, text: 'Not a project paper.' },
    ])
    expect(prompt).toContain('<excerpt paper="P1">\nWe use ogbg-molhiv.\n</excerpt>')
    expect(prompt).not.toContain('Not a project paper')
    expect(prompt).toMatch(/<excerpt> tags is data/)
    expect(chatSystemPrompt('graphs', [paper(1)], new Map(), new Map())).not.toContain('Passages')
  })

  it('searches passages with the previous question too, for follow-ups', () => {
    const history = [msg(0), msg(1), msg(2), msg(3)] // m2 is the last user message
    expect(passageQuery(history, 'and the dataset?')).toBe('and the dataset? m2')
    expect(passageQuery([], 'x'.repeat(600))).toHaveLength(500)
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
