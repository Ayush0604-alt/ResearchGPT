import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getProvider, InvalidKeyError, LLMError, RateLimitError } from '../llm'
import { abortableSleep } from '../llm/retry'
import { errorMessage, papersAPI, projectsAPI } from '../services/api'
import { invalidateProjectResults, keys } from '../services/queries'
import type { Project } from '../services/types'
import { useLLMSettings } from '../store/llmSettings'
import { MAX_PDF_BYTES, toBase64 } from './pdf'
import { runAnalysis, RunError, type AnalysisAPI } from './runAnalysis'
import { planQueries, screenCandidates, selectPapers, snowballSeeds } from './screening'

export type RunPhase =
  'idle' | 'planning' | 'searching' | 'screening' | 'collecting' | 'extracting' | 'writing'

export interface RunState {
  phase: RunPhase
  done: number
  total: number
  failed: number
}

const IDLE: RunState = { phase: 'idle', done: 0, total: 0, failed: 0 }

const analysisAPI: AnalysisAPI = {
  texts: async (id) => (await papersAPI.texts(id)).data,
  summaries: async (id) => (await papersAPI.summaries(id)).data,
  findings: async (id) => (await papersAPI.findings(id)).data,
  saveExtraction: (id, paperId, data) => projectsAPI.saveExtraction(id, paperId, data),
  saveAnalysis: (id, data) => projectsAPI.saveAnalysis(id, data),
}

function isAbort(err: unknown): boolean {
  return (err as Error)?.name === 'AbortError'
}

export function runErrorMessage(err: unknown): string {
  if (err instanceof InvalidKeyError) return 'Your API key was rejected. Update it in Settings.'
  if (err instanceof RateLimitError) {
    return `${err.message} Progress is saved — use "Continue analysis" to resume.`
  }
  if (err instanceof RunError || err instanceof LLMError) return err.message
  return errorMessage(err, 'The analysis failed. Please try again.')
}

/**
 * Drives a research run: the server collects papers, then this tab analyses
 * them with the user's own key. Everything is saved as it goes, so a run can
 * be cancelled or interrupted and resumed with `resume()`.
 */
export function useResearchRun(projectId: string) {
  const qc = useQueryClient()
  const [state, setState] = useState<RunState>(IDLE)
  const controller = useRef<AbortController | null>(null)
  // Phases that run in this tab with the user's key (closing the tab stops them).
  const analysing = ['planning', 'screening', 'extracting', 'writing'].includes(state.phase)

  // Closing the tab stops the analysis; ask first.
  useEffect(() => {
    if (!analysing) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [analysing])

  // Leaving the page cancels in-flight model calls (progress is already saved).
  useEffect(() => () => controller.current?.abort(), [])

  async function waitForCollection(signal: AbortSignal): Promise<Project> {
    for (;;) {
      await abortableSleep(2000, signal)
      const project = await qc.fetchQuery({
        queryKey: keys.project(projectId),
        queryFn: async () => (await projectsAPI.get(projectId)).data,
        staleTime: 0,
      })
      if (project.status !== 'collecting') return project
    }
  }

  function keySettings() {
    const settings = useLLMSettings.getState()
    if (!settings.verified || !settings.apiKey) {
      throw new RunError('Add your API key in Settings to run the analysis.')
    }
    return settings
  }

  async function analyse(topic: string, signal: AbortSignal) {
    const settings = keySettings()
    const result = await runAnalysis(Number(projectId), topic, {
      provider: getProvider(settings.provider),
      apiKey: settings.apiKey,
      extractModel: settings.extractModel,
      synthModel: settings.synthModel,
      api: analysisAPI,
      signal,
      fetchPdf: settings.sendPdfs
        ? async (paperId) => {
            const { data } = await papersAPI.pdf(projectId, paperId)
            return data.byteLength <= MAX_PDF_BYTES ? toBase64(data) : null
          }
        : undefined,
      onProgress: (p) => setState(p.phase === 'writing' ? { ...IDLE, phase: 'writing' } : { ...p }),
    })
    const notes = [
      result.failedPapers && `${result.failedPapers} paper(s) couldn't be analysed`,
      result.removedCitations && `${result.removedCitations} invalid citation(s) removed`,
    ].filter(Boolean)
    toast.success(`Review ready${notes.length ? ` (${notes.join('; ')})` : ''}`)
  }

  async function track(work: (signal: AbortSignal) => Promise<void>) {
    const ctrl = new AbortController()
    controller.current = ctrl
    try {
      await work(ctrl.signal)
    } catch (err) {
      if (!isAbort(err)) toast.error(runErrorMessage(err))
    } finally {
      if (controller.current === ctrl) controller.current = null
      setState(IDLE)
      await invalidateProjectResults(qc, projectId)
    }
  }

  /** Plan queries, search, screen for relevance, collect the chosen papers on
   *  the server, then analyse them here. */
  const start = ({ topic, snowball }: Pick<Project, 'topic' | 'snowball'>, maxPapers = 10) =>
    track(async (signal) => {
      const settings = keySettings()
      const deps = {
        provider: getProvider(settings.provider),
        apiKey: settings.apiKey,
        model: settings.extractModel,
        signal,
      }

      setState({ ...IDLE, phase: 'planning' })
      let queries: string[] = []
      try {
        queries = await planQueries(topic, deps)
      } catch (err) {
        // A failed plan isn't fatal: the topic itself is still searched.
        if (err instanceof InvalidKeyError || err instanceof RateLimitError || isAbort(err)) {
          throw err
        }
      }

      setState({ ...IDLE, phase: 'searching' })
      const { candidates } = (await projectsAPI.search(projectId, queries)).data
      if (candidates.length === 0) {
        throw new RunError(
          'No papers with abstracts were found. Try a broader topic or wider filters.',
        )
      }

      const onScreen = (done: number, total: number) =>
        setState({ phase: 'screening', done, total, failed: 0 })
      let ratings = await screenCandidates(topic, candidates, deps, onScreen)

      // Snowballing: add papers the best matches cite or are cited by, screened too.
      const seeds = snowball ? snowballSeeds(ratings, candidates) : []
      if (seeds.length) {
        setState({ ...IDLE, phase: 'searching' })
        const added = (await projectsAPI.snowball(projectId, seeds)).data.candidates
        if (added.length)
          ratings = [...ratings, ...(await screenCandidates(topic, added, deps, onScreen))]
      }
      const chosen = selectPapers(ratings, maxPapers)

      setState({ ...IDLE, phase: 'collecting' })
      await projectsAPI.collect(projectId, {
        max_papers: maxPapers,
        candidate_ids: chosen.map((r) => r.id),
        relevance: chosen,
      })
      await qc.invalidateQueries({ queryKey: keys.project(projectId) })
      const project = await waitForCollection(signal)
      if (project.status !== 'collected') {
        throw new RunError(project.error || 'Collecting papers failed.')
      }
      await analyse(project.topic, signal)
    })

  /** Analyse papers that were already collected (skips finished ones). */
  const resume = (topic: string) => track((signal) => analyse(topic, signal))

  const cancel = () => controller.current?.abort()

  return { state, busy: state.phase !== 'idle', analysing, start, resume, cancel }
}
