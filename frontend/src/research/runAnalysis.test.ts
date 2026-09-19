import { describe, expect, it, vi } from 'vitest'
import { InvalidKeyError, LLMError, type CompletionRequest, type LLMProvider } from '../llm/types'
import type { AnalysisIn, PaperExtractionIn, PaperForAnalysis } from '../services/types'
import { meterUsage } from '../llm/meter'
import { PROMPT_VERSION, extractionPrompt, sanitizeCitations } from './prompts'
import { runAnalysis, RunError, type AnalysisAPI } from './runAnalysis'

const EXTRACTION = {
  summary: 'S',
  methodology: 'M',
  model_used: 'GNN',
  dataset_used: 'OGB',
  metrics: 'AUC 0.8',
  contributions: 'C',
  limitations: 'L',
  conclusion: 'K',
  key_quotes: ['q'],
}
const REVIEW = {
  introduction: 'The introduction states a cited fact [P1][P99].',
  body: 'The body compares both approaches in detail [P2].',
  comparison: '| Paper |',
  trends: 'T',
  gaps: 'G',
  discussion: 'D',
  conclusion: 'C',
}

function paper(id: number, extra: Partial<PaperForAnalysis> = {}): PaperForAnalysis {
  return {
    id,
    title: `Paper ${id}`,
    authors: '["A"]',
    year: 2024,
    abstract: 'Abstract',
    full_text: null,
    url: null,
    has_pdf: false,
    has_extraction: false,
    ...extra,
  }
}

/** Provider that answers extraction or review requests by looking at the schema. */
function fakeProvider(onExtract?: (req: CompletionRequest) => unknown) {
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
      const isReview = req.system?.includes('literature reviews')
      if (req.system?.includes('fact-check')) {
        const n = [...req.messages[0].text.matchAll(/CLAIM (\d+):/g)].length
        const checks = Array.from({ length: n }, (_, index) => ({
          index,
          verdict: index === 0 ? 'partly' : 'supported',
          note: 'only in part',
        }))
        return { text: JSON.stringify({ checks }), finishReason: 'stop' }
      }
      const body = isReview ? REVIEW : (onExtract?.(req) ?? EXTRACTION)
      return { text: JSON.stringify(body), finishReason: 'stop' }
    },
  }
  return { provider, calls }
}

function fakeAPI(papers: PaperForAnalysis[]) {
  const saved = new Map<number, PaperExtractionIn>()
  const api: AnalysisAPI & { saved: typeof saved; analysis?: AnalysisIn } = {
    saved,
    texts: async () => papers,
    summaries: async () =>
      [...papers.filter((p) => p.has_extraction).map((p) => p.id), ...saved.keys()].map((id) => ({
        paper_id: id,
        summary: 'S',
        methodology: 'M',
        conclusion: 'K',
      })),
    findings: async () => [],
    saveExtraction: async (_pid, paperId, data) => {
      saved.set(paperId, data)
    },
    saveAnalysis: async (_pid, data) => {
      api.analysis = data
    },
  }
  return api
}

function deps(provider: LLMProvider, api: AnalysisAPI, signal = new AbortController().signal) {
  return {
    provider,
    api,
    signal,
    apiKey: 'k',
    extractModel: 'fast',
    synthModel: 'strong',
    onProgress: vi.fn(),
  }
}

describe('runAnalysis', () => {
  it('extracts every paper, writes the review and removes invented citations', async () => {
    const { provider, calls } = fakeProvider()
    const api = fakeAPI([paper(1), paper(2)])
    const d = deps(provider, api)

    const result = await runAnalysis(7, 'graphs', d)

    expect([...api.saved.keys()].sort()).toEqual([1, 2])
    expect(api.saved.get(1)?.model).toBe('fast')
    expect(calls.find((c) => c.system?.includes('literature reviews'))?.model).toBe('strong')
    expect(api.analysis).toMatchObject({
      introduction: 'The introduction states a cited fact [P1].',
      model: 'strong',
    })
    expect(api.analysis).toMatchObject({
      citation_checks: [
        {
          claim: 'The introduction states a cited fact [P1].',
          paper_ids: [1],
          verdict: 'partly',
          note: 'only in part',
        },
        {
          claim: 'The body compares both approaches in detail [P2].',
          paper_ids: [2],
          verdict: 'supported',
          note: '',
        },
      ],
    })
    expect(result).toEqual({ failedPapers: 0, removedCitations: 1, unsupportedClaims: 1 })
    expect(d.onProgress).toHaveBeenLastCalledWith({ phase: 'checking' })
  })

  it('saves how the review was made: prompt version, models, usage', async () => {
    const { provider } = fakeProvider()
    const meter = meterUsage(provider)
    const api = fakeAPI([paper(1), paper(2)])
    await runAnalysis(7, 'graphs', {
      ...deps(meter.provider, api),
      usage: meter.usage,
      startedAt: Date.now() - 5000,
    })
    const run = api.analysis?.run
    expect(run).toMatchObject({
      prompt_version: PROMPT_VERSION,
      provider: 'gemini',
      models: { extract: 'fast', review: 'strong' },
      papers: 2,
      failed_papers: 0,
      removed_citations: 1,
    })
    expect(run?.duration_ms).toBeGreaterThanOrEqual(5000)
    // 2 extractions + 1 fact-check on the fast model, 1 review on the strong one.
    expect(run?.usage.fast.calls).toBe(3)
    expect(run?.usage.strong.calls).toBe(1)
  })

  it('resumes: papers that already have an extraction are skipped', async () => {
    const { provider, calls } = fakeProvider()
    const api = fakeAPI([paper(1, { has_extraction: true }), paper(2)])

    await runAnalysis(7, 'graphs', deps(provider, api))

    const extracted = calls.filter((c) => !c.system?.includes('literature reviews'))
    expect(extracted).toHaveLength(1)
    expect(extracted[0].messages[0].text).toContain('<paper id="P2">')
  })

  it('skips a paper the model cannot handle and reports it', async () => {
    const { provider } = fakeProvider((req) => {
      if (req.messages[0].text.includes('P1')) throw new LLMError('blocked')
      return EXTRACTION
    })
    const api = fakeAPI([paper(1), paper(2)])

    const result = await runAnalysis(7, 'graphs', deps(provider, api))

    expect(result.failedPapers).toBe(1)
    expect([...api.saved.keys()]).toEqual([2])
  })

  it('stops the whole run when the key is rejected', async () => {
    const { provider } = fakeProvider(() => {
      throw new InvalidKeyError()
    })
    const api = fakeAPI([paper(1), paper(2), paper(3)])

    await expect(runAnalysis(7, 'graphs', deps(provider, api))).rejects.toBeInstanceOf(
      InvalidKeyError,
    )
    expect(api.analysis).toBeUndefined()
  })

  it('fails clearly when no paper could be analysed', async () => {
    const { provider } = fakeProvider(() => {
      throw new LLMError('malformed')
    })
    await expect(
      runAnalysis(7, 'graphs', deps(provider, fakeAPI([paper(1)]))),
    ).rejects.toBeInstanceOf(RunError)
  })

  it('does not start work after being cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const { provider, calls } = fakeProvider()

    await expect(
      runAnalysis(7, 'graphs', deps(provider, fakeAPI([paper(1)]), controller.signal)),
    ).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('runs at most `concurrency` extractions at once', async () => {
    let active = 0
    let peak = 0
    const provider: LLMProvider = {
      ...fakeProvider().provider,
      complete: async (req) => {
        const isReview = req.system?.includes('literature reviews')
        if (!isReview) {
          active++
          peak = Math.max(peak, active)
          await new Promise((r) => setTimeout(r, 5))
          active--
        }
        return { text: JSON.stringify(isReview ? REVIEW : EXTRACTION), finishReason: 'stop' }
      },
    }
    const api = fakeAPI([1, 2, 3, 4, 5, 6, 7].map((id) => paper(id)))
    await runAnalysis(7, 'graphs', { ...deps(provider, api), concurrency: 3 })
    expect(peak).toBe(3)
  })
})

describe('prompts', () => {
  it('wraps paper text in delimiters and trims it to the budget', () => {
    const prompt = extractionPrompt('t', paper(5, { full_text: 'x'.repeat(70_000) }))
    expect(prompt).toContain('<paper id="P5">')
    expect(prompt).toContain('[…text truncated]')
    expect(prompt.length).toBeLessThan(62_000)
  })

  it('removes only citations to unknown papers', () => {
    expect(sanitizeCitations('A [P1] B [P2][P3]', new Set([1, 3]))).toEqual({
      text: 'A [P1] B [P3]',
      unknown: [2],
    })
  })
})

describe('PDF attachments', () => {
  function pdfProvider(onExtract: (req: CompletionRequest) => unknown) {
    const { provider, calls } = fakeProvider(onExtract)
    return { provider: { ...provider, acceptsPdf: true }, calls }
  }
  const extractions = (calls: CompletionRequest[]) =>
    calls.filter((c) => !c.system?.includes('literature reviews'))

  it('attaches the PDF when the paper has one and the provider reads PDFs', async () => {
    const { provider, calls } = pdfProvider(() => EXTRACTION)
    const api = fakeAPI([paper(1, { has_pdf: true }), paper(2)])
    const fetchPdf = vi.fn(async () => 'UERGLWJhc2U2NA==')

    await runAnalysis(7, 't', { ...deps(provider, api), fetchPdf })

    expect(fetchPdf).toHaveBeenCalledWith(1)
    // Requests run concurrently, so find each paper's request by its id.
    const byPaper = (id: number) =>
      extractions(calls).find((c) => c.messages[0].text.includes(`<paper id="P${id}">`))!
    const [withPdf, withoutPdf] = [byPaper(1), byPaper(2)]
    expect(withPdf.messages[0].files).toEqual([
      { mimeType: 'application/pdf', data: 'UERGLWJhc2U2NA==' },
    ])
    expect(withPdf.messages[0].text).toContain('attached as a PDF')
    expect(withoutPdf.messages[0].files).toBeUndefined()
  })

  it('falls back to the text when the model rejects the PDF', async () => {
    const { provider, calls } = pdfProvider((req) => {
      if (req.messages[0].files) throw new LLMError('Unsupported file', 400)
      return EXTRACTION
    })
    const api = fakeAPI([paper(1, { has_pdf: true, full_text: 'the text' })])

    const result = await runAnalysis(7, 't', { ...deps(provider, api), fetchPdf: async () => 'x' })

    expect(result.failedPapers).toBe(0)
    expect(extractions(calls).map((c) => Boolean(c.messages[0].files))).toEqual([true, false])
  })

  it('never fetches PDFs for providers that cannot read them', async () => {
    const { provider } = fakeProvider()
    const fetchPdf = vi.fn(async () => 'x')
    await runAnalysis(7, 't', {
      ...deps(provider, fakeAPI([paper(1, { has_pdf: true })])),
      fetchPdf,
    })
    expect(fetchPdf).not.toHaveBeenCalled()
  })
})

describe('citation check', () => {
  it('never costs the review: a failed check saves the review without checks', async () => {
    const { provider } = fakeProvider()
    const failing: LLMProvider = {
      ...provider,
      complete: async (req) => {
        if (req.system?.includes('fact-check')) throw new LLMError('quota exhausted', 429)
        return provider.complete(req)
      },
    }
    const api = fakeAPI([paper(1)])
    const result = await runAnalysis(7, 't', deps(failing, api))
    expect(api.analysis).toMatchObject({ citation_checks: [] })
    expect(result.unsupportedClaims).toBeNull()
  })
})
