import type { LiteratureReview, Paper } from '../services/types'

// Citation numbering, reference lists and exports (Markdown, BibTeX, RIS).

export const REVIEW_SECTIONS: [keyof LiteratureReview, string][] = [
  ['introduction', 'Introduction'],
  ['body', 'Survey'],
  ['comparison', 'Comparison'],
  ['discussion', 'Discussion'],
  ['trends', 'Trends'],
  ['gaps', 'Research gaps'],
  ['conclusion', 'Conclusion'],
]

const CITE = /\[P(\d+)\]/g

export function parseAuthors(raw: string | null): string[] {
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}

/** Number papers [1], [2]… in order of first citation in the review; uncited papers follow. */
export function citationNumbers(review: LiteratureReview, papers: Paper[]): Map<number, number> {
  const known = new Set(papers.map((p) => p.id))
  const numbers = new Map<number, number>()
  const cite = (id: number) => {
    if (known.has(id) && !numbers.has(id)) numbers.set(id, numbers.size + 1)
  }
  for (const [key] of REVIEW_SECTIONS) {
    for (const m of String(review[key] ?? '').matchAll(CITE)) cite(Number(m[1]))
  }
  papers.forEach((p) => cite(p.id))
  return numbers
}

/** Replace [P12] with a numbered Markdown link to the paper: [[3]](url "Title"). */
export function linkCitations(
  text: string,
  numbers: Map<number, number>,
  papers: Map<number, Paper>,
): string {
  return text.replace(CITE, (match, id: string) => {
    const n = numbers.get(Number(id))
    const paper = papers.get(Number(id))
    if (!n || !paper) return match
    const title = paper.title.replace(/"/g, "'")
    return paper.url ? `[[${n}]](${paper.url} "${title}")` : `[${n}]`
  })
}

export function referenceList(numbers: Map<number, number>, papers: Map<number, Paper>): string {
  return [...numbers.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id, n]) => {
      const p = papers.get(id)!
      const authors = parseAuthors(p.authors)
      const who =
        authors.length > 3 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', ')
      const where = p.doi ? `https://doi.org/${p.doi}` : (p.url ?? '')
      return `${n}. ${who ? `${who}. ` : ''}${p.title}${p.year ? ` (${p.year})` : ''}. ${where}`.trim()
    })
    .join('\n')
}

export function reviewMarkdown(review: LiteratureReview, papers: Paper[], topic: string): string {
  const byId = new Map(papers.map((p) => [p.id, p]))
  const numbers = citationNumbers(review, papers)
  const sections = REVIEW_SECTIONS.filter(([key]) => review[key]).map(
    ([key, title]) => `## ${title}\n\n${linkCitations(String(review[key]), numbers, byId)}`,
  )
  return [
    `# Literature review: ${topic}`,
    '',
    ...sections.flatMap((s) => [s, '']),
    '## References',
    '',
    referenceList(numbers, byId),
    '',
  ].join('\n')
}

// ── Reference-manager formats ────────────────────────────────────────────────

function bibEscape(value: string): string {
  return value.replace(/\\/g, '\\textbackslash{}').replace(/([{}&%$#_])/g, '\\$1')
}

function citeKey(p: Paper, used: Set<string>): string {
  // "Surname, First" -> Surname; "First Surname" -> Surname
  const first = parseAuthors(p.authors)[0] ?? 'paper'
  const surname = first.includes(',')
    ? first.split(',')[0]
    : (first.trim().split(/\s+/).pop() ?? '')
  const word = p.title.toLowerCase().match(/[a-z]{4,}/)?.[0] ?? 'paper'
  const base = `${surname}${p.year ?? ''}${word}`.toLowerCase().replace(/[^a-z0-9]/g, '')
  let key = base
  for (let i = 2; used.has(key); i++) key = `${base}${i}`
  used.add(key)
  return key
}

export function toBibtex(papers: Paper[]): string {
  const used = new Set<string>()
  return papers
    .map((p) => {
      const fields = [
        ['title', `{${bibEscape(p.title)}}`],
        ['author', parseAuthors(p.authors).map(bibEscape).join(' and ')],
        ['year', p.year ? String(p.year) : ''],
        ['doi', p.doi ?? ''],
        ['url', p.url ?? ''],
      ].filter(([, v]) => v)
      const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n')
      return `@article{${citeKey(p, used)},\n${body}\n}`
    })
    .join('\n\n')
    .concat('\n')
}

export function toRis(papers: Paper[]): string {
  return papers
    .map((p) =>
      [
        'TY  - JOUR',
        `TI  - ${p.title}`,
        ...parseAuthors(p.authors).map((a) => `AU  - ${a}`),
        p.year ? `PY  - ${p.year}` : null,
        p.doi ? `DO  - ${p.doi}` : null,
        p.url ? `UR  - ${p.url}` : null,
        'ER  - ',
      ]
        .filter(Boolean)
        .join('\r\n'),
    )
    .join('\r\n')
    .concat('\r\n')
}

/** Offer text as a file download. */
export function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
