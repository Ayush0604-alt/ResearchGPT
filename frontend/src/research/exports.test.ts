import { describe, expect, it } from 'vitest'
import type { LiteratureReview, Paper } from '../services/types'
import {
  citationNumbers,
  linkCitations,
  referenceList,
  reviewMarkdown,
  toBibtex,
  toRis,
} from './exports'

const paper = (id: number, extra: Partial<Paper> = {}): Paper => ({
  id,
  project_id: 1,
  title: `Graph Paper ${id}`,
  authors: JSON.stringify(['Alan Turing', 'Ada Lovelace']),
  abstract: null,
  year: 2023,
  url: `https://example.org/${id}`,
  source: 'openalex',
  status: 'processed',
  has_full_text: true,
  doi: `10.1000/${id}`,
  relevance_score: null,
  relevance_reason: null,
  created_at: '',
  ...extra,
})

const review = {
  introduction: 'Second is cited first [P2], then [P1].',
  body: 'Again [P2] and an unknown [P99].',
  comparison: null,
  discussion: null,
  conclusion: null,
  trends: null,
  gaps: null,
  citation_checks: null,
} as unknown as LiteratureReview

describe('citations', () => {
  const papers = [paper(1), paper(2), paper(3)]
  const numbers = citationNumbers(review, papers)
  const byId = new Map(papers.map((p) => [p.id, p]))

  it('numbers papers by first citation, then the rest', () => {
    expect([...numbers.entries()]).toEqual([
      [2, 1],
      [1, 2],
      [3, 3],
    ])
  })

  it('turns markers into numbered links with the title as tooltip', () => {
    expect(linkCitations('See [P2].', numbers, byId)).toBe(
      'See [[1]](https://example.org/2 "Graph Paper 2").',
    )
    expect(linkCitations('Unknown [P99].', numbers, byId)).toBe('Unknown [P99].')
  })

  it('builds a reference list and a full Markdown export', () => {
    expect(referenceList(numbers, byId).split('\n')[0]).toBe(
      '1. Alan Turing, Ada Lovelace. Graph Paper 2 (2023). https://doi.org/10.1000/2',
    )
    const md = reviewMarkdown(review, papers, 'graphs')
    expect(md).toContain('# Literature review: graphs')
    expect(md).toContain('## References')
    expect(md).not.toContain('[P1]')
  })
})

describe('reference-manager exports', () => {
  it('writes BibTeX with escaped fields and unique keys', () => {
    const bib = toBibtex([paper(1, { title: 'Nets & Graphs: 50% better' }), paper(2)])
    expect(bib).toContain('@article{turing2023nets,')
    expect(bib).toContain('title = {{Nets \\& Graphs: 50\\% better}}')
    expect(bib).toContain('author = {Alan Turing and Ada Lovelace}')
    expect(bib).toContain('doi = {10.1000/1}')
    const keys = [...toBibtex([paper(1), paper(1)]).matchAll(/@article\{([^,]+),/g)].map(
      (m) => m[1],
    )
    expect(new Set(keys).size).toBe(2)
  })

  it('writes RIS records', () => {
    const ris = toRis([paper(1)])
    expect(ris.split('\r\n')).toEqual([
      'TY  - JOUR',
      'TI  - Graph Paper 1',
      'AU  - Alan Turing',
      'AU  - Ada Lovelace',
      'PY  - 2023',
      'DO  - 10.1000/1',
      'UR  - https://example.org/1',
      'ER  - ',
      '',
    ])
  })
})
