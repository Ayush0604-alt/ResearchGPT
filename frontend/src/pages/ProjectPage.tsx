import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  KeyRound,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
  Square,
  Users,
  XCircle,
} from 'lucide-react'
import { BROWSER_PHASES, useResearchRun, type RunState } from '../research/useResearchRun'
import { useFindings, usePapers, useProject, useSummaries } from '../services/queries'
import type { Paper, PaperFindings, PaperSummary, Project } from '../services/types'
import { estimateRun, formatUsd } from '../llm/pricing'
import { MAX_PAPERS } from '../research/useResearchRun'
import { useHasVerifiedKey, useLLMSettings } from '../store/llmSettings'

const SOURCE_LABELS: Record<string, string> = {
  arxiv: 'arXiv',
  semantic_scholar: 'Semantic Scholar',
  openalex: 'OpenAlex',
  europepmc: 'Europe PMC',
  pubmed: 'PubMed',
}

function parseAuthors(raw: string | null): string[] {
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function StatusPill({ status }: { status: Project['status'] }) {
  switch (status) {
    case 'pending':
      return (
        <span className="badge-amber">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Ready to run
        </span>
      )
    case 'collecting':
      return (
        <span className="badge-blue">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" /> Collecting papers
        </span>
      )
    case 'collected':
      return <span className="badge-blue">Papers ready — analysis not finished</span>
    case 'completed':
      return (
        <span className="badge-green">
          <CheckCircle size={11} /> Completed
        </span>
      )
    case 'failed':
      return (
        <span className="badge-red">
          <XCircle size={11} /> Failed
        </span>
      )
  }
}

function ProgressCard({ project, run }: { project: Project; run: RunState }) {
  const models = useLLMSettings()
  let percent: number | null
  let label: string
  if (run.phase === 'planning') {
    percent = null
    label = `Planning search queries with ${models.extractModel}…`
  } else if (run.phase === 'searching') {
    percent = null
    label = 'Searching Semantic Scholar, OpenAlex, arXiv and Europe PMC…'
  } else if (run.phase === 'screening') {
    percent = run.total ? Math.round((100 * run.done) / run.total) : 0
    label = `Checking relevance: ${run.done} of ${run.total} results`
  } else if (run.phase === 'extracting') {
    percent = run.total ? Math.round((100 * run.done) / run.total) : 0
    label =
      `Reading papers with ${models.extractModel}: ${run.done} of ${run.total}` +
      (run.failed ? ` (${run.failed} skipped)` : '')
  } else if (run.phase === 'checking') {
    percent = null
    label = `Checking the review's citations with ${models.extractModel}…`
  } else if (run.phase === 'writing') {
    percent = null
    label = `Writing the review with ${models.synthModel}…`
  } else {
    percent = project.progress
    label = project.current_step || 'Collecting papers…'
  }
  const inBrowser = BROWSER_PHASES.includes(run.phase)

  return (
    <div className="card-p" aria-live="polite">
      <div className="flex items-center justify-between mb-3 gap-4">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {percent !== null && <span className="text-xs text-gray-400">{percent}%</span>}
      </div>
      <div
        className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-1.5 bg-brand-500 rounded-full transition-all duration-700 ${
            percent === null ? 'w-1/3 animate-pulse' : ''
          }`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-gray-400 mt-3">
        {inBrowser
          ? 'Running in this tab with your API key — keep it open. Progress is saved as it goes.'
          : 'Searching and reading open-access papers on the server. You can leave this page.'}
      </p>
    </div>
  )
}

function PaperDetails({
  paper,
  summary,
  findings,
}: {
  paper: Paper
  summary?: PaperSummary
  findings?: PaperFindings
}) {
  const authors = parseAuthors(paper.authors)
  const rows: [string, string | null | undefined][] = [
    ['Why included', paper.relevance_reason],
    ['Summary', summary?.summary],
    ['Method', summary?.methodology],
    ['Models', findings?.model_used],
    ['Data', findings?.dataset_used],
    ['Results', (findings?.raw_json?.metrics as string | undefined) ?? findings?.accuracy],
    ['Limitations', findings?.limitations],
  ]
  return (
    <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100 space-y-2 pt-3">
      {rows.some(([, v]) => v) ? (
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          {rows
            .filter(([, v]) => v && v !== 'Not reported')
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-gray-400">{k}</dt>
                <dd className="text-gray-700">{v}</dd>
              </div>
            ))}
        </dl>
      ) : (
        paper.abstract && <p className="text-sm text-gray-600 leading-relaxed">{paper.abstract}</p>
      )}
      {authors.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Users size={11} />
          {authors.slice(0, 4).join(', ')}
          {authors.length > 4 && ` +${authors.length - 4} more`}
        </div>
      )}
    </div>
  )
}

/** A rough price for one run with the current models, billed to the user's key. */
function RunCost() {
  const { extractModel, synthModel, sendPdfs, prices } = useLLMSettings()
  const { usd, inputTokens, outputTokens } = estimateRun(
    { papers: MAX_PAPERS, extractModel, synthModel, sendPdfs },
    prices,
  )
  const tokens = `about ${Math.round((inputTokens + outputTokens) / 1000)}k tokens`
  return (
    <span
      className="text-xs text-gray-400"
      data-testid="run-cost"
      title={`Estimate for ${MAX_PAPERS} papers, ${tokens}. Set prices in Settings.`}
    >
      {usd === null ? tokens : `≈ ${formatUsd(usd)} per run`}
    </span>
  )
}

export default function ProjectPage() {
  const { id = '' } = useParams()
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const { data: project, isPending: loading } = useProject(id)
  const { data: papers = [] } = usePapers(id)
  const { data: summaries = [] } = useSummaries(id)
  const { data: findings = [] } = useFindings(id)
  const hasKey = useHasVerifiedKey()
  const run = useResearchRun(id)

  if (loading)
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="animate-spin text-brand-500" size={24} />
      </div>
    )
  if (!project) return <div className="text-sm text-gray-500">Project not found.</div>

  const status = project.status
  const collectingOnServer = status === 'collecting'
  const showProgress = run.busy || collectingOnServer
  const summaryBy = new Map(summaries.map((s) => [s.paper_id, s]))
  const findingsBy = new Map(findings.map((f) => [f.paper_id, f]))
  const withText = papers.filter((p) => p.has_full_text).length

  const startRun = () => {
    if (
      (status === 'completed' || status === 'collected') &&
      !confirm('Search for papers again? This replaces the current papers and review.')
    )
      return
    run.start(project)
  }

  const actions = () => {
    if (run.busy) {
      return (
        <button onClick={run.cancel} className="btn-secondary btn-sm">
          <Square size={12} /> {run.analysing ? 'Stop' : 'Stop waiting'}
        </button>
      )
    }
    if (collectingOnServer) return null
    if (!hasKey && status !== 'completed') {
      return (
        <Link to="/settings" className="btn-primary btn-sm">
          <KeyRound size={13} /> Add your API key to run
        </Link>
      )
    }
    return (
      <>
        {status === 'completed' && (
          <>
            <Link to={`/project/${id}/chat`} className="btn-secondary btn-sm">
              <MessageSquare size={13} /> Chat
            </Link>
            <Link to={`/project/${id}/review`} className="btn-secondary btn-sm">
              <BookOpen size={13} /> Review
            </Link>
          </>
        )}
        {status === 'collected' && (
          <button onClick={() => run.resume(project.topic)} className="btn-primary btn-sm">
            <Play size={13} /> Continue analysis
          </button>
        )}
        {hasKey && <RunCost />}
        {hasKey && (
          <button
            onClick={startRun}
            className={
              status === 'pending' || status === 'failed'
                ? 'btn-primary btn-sm'
                : 'btn-secondary btn-sm'
            }
          >
            {status === 'pending' ? (
              <>
                <Play size={13} /> Run analysis
              </>
            ) : (
              <>
                <RotateCcw size={13} /> {status === 'failed' ? 'Try again' : 'Run again'}
              </>
            )}
          </button>
        )}
      </>
    )
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Link
              to="/dashboard"
              aria-label="Back to dashboard"
              className="mt-0.5 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="page-title">{project.title}</h1>
              <p className="page-sub">Topic: {project.topic}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">{actions()}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <StatusPill status={status} />
        {papers.length > 0 && (
          <span className="text-xs text-gray-400">
            {papers.length} papers · {withText} with full text
          </span>
        )}
      </div>

      {showProgress && <ProgressCard project={project} run={run.state} />}

      {status === 'failed' && project.error && !run.busy && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          {project.error}
        </p>
      )}

      {papers.length > 0 && (
        <div>
          <h2 className="section-title">Papers ({papers.length})</h2>
          <div className="card divide-y divide-gray-50 overflow-hidden">
            {papers.map((paper) => {
              const isOpen = expanded[paper.id]
              return (
                <div key={paper.id}>
                  <div className="flex items-start hover:bg-gray-50 transition-colors">
                    <button
                      className="flex-1 min-w-0 flex items-start justify-between pl-5 pr-2 py-3.5 text-left gap-4"
                      onClick={() => setExpanded((e) => ({ ...e, [paper.id]: !e[paper.id] }))}
                      aria-expanded={Boolean(isOpen)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {paper.source && (
                            <span className="badge-gray text-xs">
                              {SOURCE_LABELS[paper.source] || paper.source}
                            </span>
                          )}
                          {paper.year && (
                            <span className="text-xs text-gray-400">{paper.year}</span>
                          )}
                          <span className="text-xs text-gray-400">
                            {paper.has_full_text ? 'Full text' : 'Abstract only'}
                          </span>
                          {paper.relevance_score !== null && (
                            <span
                              className="text-xs text-gray-500"
                              title={paper.relevance_reason ?? undefined}
                            >
                              Relevance {paper.relevance_score}/10
                            </span>
                          )}
                          {summaryBy.has(paper.id) && (
                            <span className="text-xs text-green-700">Analysed</span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">
                          {paper.title}
                        </p>
                      </div>
                      <span className="flex-shrink-0 mt-0.5" aria-hidden>
                        {isOpen ? (
                          <ChevronUp size={15} className="text-gray-400" />
                        ) : (
                          <ChevronDown size={15} className="text-gray-400" />
                        )}
                      </span>
                    </button>
                    {/* A sibling of the toggle, not inside it: links can't nest in buttons. */}
                    {paper.url && (
                      <a
                        href={paper.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open "${paper.title}" in a new tab`}
                        className="p-1 mr-4 mt-3.5 text-gray-400 hover:text-brand-600 transition-colors"
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                  {isOpen && (
                    <PaperDetails
                      paper={paper}
                      summary={summaryBy.get(paper.id)}
                      findings={findingsBy.get(paper.id)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {papers.length === 0 && !showProgress && status !== 'pending' && (
        <div className="card-p text-center py-10">
          <p className="text-sm text-gray-500">No papers found yet.</p>
        </div>
      )}
    </div>
  )
}
