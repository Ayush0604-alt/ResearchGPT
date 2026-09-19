import { generateJSON } from '../llm/generate'
import { InvalidKeyError, LLMError, RateLimitError, type LLMProvider } from '../llm/types'
import type {
  AnalysisIn,
  PaperExtractionIn,
  PaperFindings,
  PaperForAnalysis,
  PaperSummary,
} from '../services/types'
import {
  EXTRACTION_SYSTEM,
  ExtractionSchema,
  REVIEW_SYSTEM,
  ReviewSchema,
  extractionPrompt,
  reviewPrompt,
  sanitizeReview,
} from './prompts'

// Map-reduce analysis that runs in the browser with the user's own key:
//   map:    one extraction per paper (3 at a time), saved as each finishes
//   reduce: one review over all extractions
// Only papers without a saved extraction are processed, so a run that was
// interrupted (tab closed, rate limit) picks up where it stopped.

export interface AnalysisAPI {
  texts(projectId: number): Promise<PaperForAnalysis[]>
  summaries(projectId: number): Promise<PaperSummary[]>
  findings(projectId: number): Promise<PaperFindings[]>
  saveExtraction(projectId: number, paperId: number, data: PaperExtractionIn): Promise<unknown>
  saveAnalysis(projectId: number, data: AnalysisIn): Promise<unknown>
}

export type AnalysisProgress =
  { phase: 'extracting'; done: number; total: number; failed: number } | { phase: 'writing' }

export interface AnalysisDeps {
  provider: LLMProvider
  apiKey: string
  extractModel: string
  synthModel: string
  api: AnalysisAPI
  signal: AbortSignal
  onProgress: (progress: AnalysisProgress) => void
  concurrency?: number
}

export interface AnalysisResult {
  failedPapers: number
  removedCitations: number
}

/** A run failure with a message meant for the user. */
export class RunError extends Error {
  name = 'RunError'
}

function isFatal(err: unknown): boolean {
  return (
    err instanceof InvalidKeyError ||
    err instanceof RateLimitError ||
    (err as Error)?.name === 'AbortError' ||
    !(err instanceof LLMError) // e.g. our own API failing
  )
}

/** Run `worker` over `items` with limited concurrency; stop at the first thrown error. */
async function pool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let next = 0
  let fatal: unknown = null
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length && fatal === null && !signal.aborted) {
      const item = items[next++]
      try {
        await worker(item)
      } catch (err) {
        fatal ??= err
      }
    }
  })
  await Promise.all(runners)
  if (fatal !== null) throw fatal
  signal.throwIfAborted()
}

export async function runAnalysis(
  projectId: number,
  topic: string,
  deps: AnalysisDeps,
): Promise<AnalysisResult> {
  const { provider, apiKey, api, signal, onProgress } = deps
  const papers = await api.texts(projectId)
  if (papers.length === 0) throw new RunError('This project has no papers to analyse yet.')

  // ── Map: extract each paper that isn't done yet ────────────────────────────
  const todo = papers.filter((p) => !p.has_extraction)
  let done = papers.length - todo.length
  let failed = 0
  onProgress({ phase: 'extracting', done, total: papers.length, failed })

  await pool(
    todo,
    deps.concurrency ?? 3,
    async (paper) => {
      try {
        const { data } = await generateJSON(provider, {
          apiKey,
          model: deps.extractModel,
          system: EXTRACTION_SYSTEM,
          messages: [{ role: 'user', text: extractionPrompt(topic, paper) }],
          schema: ExtractionSchema,
          maxOutputTokens: 4096,
          temperature: 0.2,
          signal,
        })
        await api.saveExtraction(projectId, paper.id, { ...data, model: deps.extractModel })
      } catch (err) {
        if (isFatal(err)) throw err
        failed += 1 // one unreadable paper shouldn't sink the run
      } finally {
        done += 1
        onProgress({ phase: 'extracting', done, total: papers.length, failed })
      }
    },
    signal,
  )

  // ── Reduce: one review over everything that was extracted ─────────────────
  const [summaries, findings] = await Promise.all([
    api.summaries(projectId),
    api.findings(projectId),
  ])
  if (summaries.length === 0) {
    throw new RunError(
      "Couldn't analyse any of the papers. Try again, or choose a different model in Settings.",
    )
  }
  const summaryBy = new Map(summaries.map((s) => [s.paper_id, s]))
  const findingsBy = new Map(findings.map((f) => [f.paper_id, f]))
  const items = papers.map((paper) => ({
    paper,
    summary: summaryBy.get(paper.id),
    findings: findingsBy.get(paper.id),
  }))

  onProgress({ phase: 'writing' })
  const { data } = await generateJSON(provider, {
    apiKey,
    model: deps.synthModel,
    system: REVIEW_SYSTEM,
    messages: [{ role: 'user', text: reviewPrompt(topic, items) }],
    schema: ReviewSchema,
    maxOutputTokens: 16_384,
    temperature: 0.4,
    signal,
  })
  const { review, unknown } = sanitizeReview(data, new Set(papers.map((p) => p.id)))
  await api.saveAnalysis(projectId, { ...review, model: deps.synthModel })

  return { failedPapers: failed, removedCitations: unknown.length }
}
