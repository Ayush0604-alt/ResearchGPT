import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Download,
  History as History3,
  Loader2,
  Printer,
} from 'lucide-react'
import Markdown from '../components/Markdown'
import Tabs from '../components/Tabs'
import {
  REVIEW_SECTIONS,
  citationNumbers,
  download,
  linkCitations,
  referenceList,
  reviewMarkdown,
  toBibtex,
  toRis,
} from '../research/exports'
import { errorMessage } from '../services/api'
import { usePapers, useProject, useReview, useReviewVersions } from '../services/queries'
import type {
  CitationCheck,
  LiteratureReview,
  Paper,
  ReviewVersion,
  RunMeta,
} from '../services/types'

type Tab = keyof LiteratureReview | 'references' | 'checks' | 'history'

const VERDICT_STYLE: Record<CitationCheck['verdict'], [string, string]> = {
  supported: ['badge-green', 'Supported'],
  partly: ['badge-amber', 'Partly supported'],
  unsupported: ['badge-red', 'Not supported'],
}

function RunInfo({ run }: { run: RunMeta }) {
  const tokens = Object.values(run.usage).reduce(
    (sum, u) => sum + u.input_tokens + u.output_tokens,
    0,
  )
  const models = [...new Set(Object.values(run.models))].join(', ')
  const minutes = Math.max(1, Math.round(run.duration_ms / 60_000))
  return (
    <p className="mt-3 text-xs text-gray-400 print:hidden" data-testid="run-info">
      Made with {models} · {tokens.toLocaleString()} tokens · about {minutes} min · prompt version{' '}
      {run.prompt_version}
    </p>
  )
}

function CitationChecks({
  checks,
  numbers,
}: {
  checks: CitationCheck[]
  numbers: Map<number, number>
}) {
  if (checks.length === 0) {
    return <p className="text-sm text-gray-400">The citations in this review weren't checked.</p>
  }
  const order: CitationCheck['verdict'][] = ['unsupported', 'partly', 'supported']
  const sorted = [...checks].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict))
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Each cited claim was checked against what was extracted from the papers it cites. Treat
        flagged claims with care; check them against the paper before relying on them.
      </p>
      <ul className="divide-y divide-gray-100">
        {sorted.map((c, i) => {
          const [cls, label] = VERDICT_STYLE[c.verdict]
          const refs = c.paper_ids.map((id) => numbers.get(id)).filter(Boolean)
          return (
            <li key={i} className="py-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className={cls}>{label}</span>
                {refs.length > 0 && (
                  <span className="text-xs text-gray-400">cites [{refs.join('], [')}]</span>
                )}
              </div>
              <p className="text-sm text-gray-800">{c.claim.replace(/\s*\[P\d+\]/g, '')}</p>
              {c.note && <p className="text-xs text-gray-500">{c.note}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Earlier runs side by side: what changed, and whether it got better. */
function History({
  projectId,
  viewing,
  onView,
}: {
  projectId: string
  viewing: number | null
  onView: (version: ReviewVersion | null) => void
}) {
  const { data: versions = [], isPending } = useReviewVersions(projectId)
  if (isPending) return <p className="text-sm text-gray-500">Loading earlier runs…</p>
  if (versions.length <= 1) {
    return (
      <p className="text-sm text-gray-500">
        Only one run so far. Run the analysis again and the earlier review is kept here for
        comparison.
      </p>
    )
  }
  const columns: [string, string, (v: ReviewVersion) => string][] = [
    ['papers', 'Papers', (v) => String(v.papers.length)],
    ['words', 'Words', (v) => fmt(v.metrics.words)],
    ['cited', 'Cited', (v) => percent(v.metrics.citation_density)],
    ['supported', 'Supported', (v) => percent(v.metrics.supported_rate)],
    ['tokens', 'Tokens', (v) => fmt(v.metrics.tokens)],
  ]
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        The last {versions.length} runs. "Cited" is the share of sentences citing a paper;
        "Supported" the share of checked claims the cited papers support.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3 font-semibold">Run</th>
              {columns.map(([key, label]) => (
                <th key={key} className="py-2 pr-3 font-semibold text-right">
                  {label}
                </th>
              ))}
              <th className="py-2 font-semibold">
                <span className="sr-only">View</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {versions.map((version) => (
              <tr key={version.id} className={viewing === version.id ? 'bg-brand-50' : undefined}>
                <td className="py-2 pr-3">
                  {new Date(version.created_at).toLocaleString()}
                  {version.current && <span className="badge-green ml-2">Current</span>}
                  {version.run_meta && (
                    <span className="block text-xs text-gray-500">
                      {[...new Set(Object.values(version.run_meta.models))].join(', ')} · prompt{' '}
                      {version.run_meta.prompt_version}
                    </span>
                  )}
                </td>
                {columns.map(([key, , value]) => (
                  <td key={key} className="py-2 pr-3 text-right tabular-nums">
                    {value(version)}
                  </td>
                ))}
                <td className="py-2 text-right">
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => onView(version.current ? null : version)}
                  >
                    {version.current ? 'Current' : viewing === version.id ? 'Viewing' : 'View'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const fmt = (value: number | null | undefined) =>
  value === null || value === undefined ? '–' : Math.round(value).toLocaleString()
const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`

export default function ReviewPage() {
  const { id = '' } = useParams()
  const [activeTab, setActiveTab] = useState<Tab>('introduction')
  // null = the current review; otherwise an earlier run being read.
  const [version, setVersion] = useState<ReviewVersion | null>(null)
  const { data: review, isPending: loading, isError, error, refetch } = useReview(id)
  const { data: papers = [] } = usePapers(id)
  const { data: project } = useProject(id)

  if (loading)
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="animate-spin text-brand-500" size={22} />
      </div>
    )

  if (isError)
    return (
      <div className="card-p text-center py-12">
        <p className="text-sm text-gray-600 mb-3">
          {errorMessage(error, 'Failed to load the review')}
        </p>
        <button onClick={() => refetch()} className="btn-secondary btn-sm">
          Try again
        </button>
      </div>
    )

  if (!review)
    return (
      <div className="text-center py-16">
        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-3">
          <BookOpen size={18} className="text-brand-500" />
        </div>
        <h3 className="text-sm font-medium text-gray-900 mb-1">No literature review yet</h3>
        <p className="text-xs text-gray-500 mb-4">Run the pipeline first to generate a review.</p>
        <Link to={`/project/${id}`} className="btn-secondary btn-sm">
          <ArrowLeft size={13} /> Back to project
        </Link>
      </div>
    )

  // An older run is read from its stored sections; everything else works the same.
  const shown: LiteratureReview = version
    ? { ...review, ...version.sections, citation_checks: version.citation_checks }
    : review
  const byId = new Map<number, Paper>(papers.map((p) => [p.id, p]))
  const numbers = citationNumbers(shown, papers)
  const render = (text: string | null) => linkCitations(text ?? '', numbers, byId)
  const checks = shown.citation_checks ?? []
  const flagged = checks.filter((c) => c.verdict !== 'supported').length
  const topic = project?.topic ?? 'research topic'
  const slug =
    topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40) || `project-${id}`

  const tabs: [Tab, string][] = [
    ...REVIEW_SECTIONS.filter(([key]) => shown[key]),
    ['references', 'References'],
    ['checks', flagged ? `Citation check (${flagged})` : 'Citation check'],
    ['history', 'History'],
  ]

  const content =
    activeTab === 'history' ? (
      <History
        projectId={id}
        viewing={version?.id ?? null}
        onView={(chosen) => {
          setVersion(chosen)
          setActiveTab('introduction')
        }}
      />
    ) : activeTab === 'references' ? (
      <Markdown>{referenceList(numbers, byId)}</Markdown>
    ) : activeTab === 'checks' ? (
      <CitationChecks checks={checks} numbers={numbers} />
    ) : shown[activeTab] ? (
      <Markdown>{render(String(shown[activeTab]))}</Markdown>
    ) : (
      <p className="text-sm text-gray-400 text-center py-12">No content for this section.</p>
    )

  return (
    <div>
      <div className="page-header flex items-center justify-between gap-4 flex-wrap print:hidden">
        <div className="flex items-center gap-3">
          <Link
            to={`/project/${id}`}
            aria-label="Back to project"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h1 className="page-title">Literature review</h1>
            <p className="page-sub">{topic}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="btn-secondary btn-sm"
            onClick={() =>
              download(`${slug}.md`, reviewMarkdown(shown, papers, topic), 'text/markdown')
            }
          >
            <Download size={13} /> Markdown
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => download(`${slug}.bib`, toBibtex(papers), 'application/x-bibtex')}
          >
            <Download size={13} /> BibTeX
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() =>
              download(`${slug}.ris`, toRis(papers), 'application/x-research-info-systems')
            }
          >
            <Download size={13} /> RIS
          </button>
          <button className="btn-secondary btn-sm" onClick={() => window.print()}>
            <Printer size={13} /> Print / PDF
          </button>
        </div>
      </div>

      {version && (
        <div className="mb-4 flex items-center gap-3 flex-wrap text-sm text-brand-800 bg-brand-50 border border-brand-100 rounded-lg px-4 py-2.5 print:hidden">
          <History3 size={15} />
          Reading the run from {new Date(version.created_at).toLocaleString()}, not the current
          review.
          <button className="btn-secondary btn-sm ml-auto" onClick={() => setVersion(null)}>
            Back to current
          </button>
        </div>
      )}

      {flagged > 0 && (
        <button
          onClick={() => setActiveTab('checks')}
          className="w-full mb-4 flex items-center gap-2 text-left text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-4 py-2.5 print:hidden"
        >
          <AlertTriangle size={15} />
          {flagged} of {checks.length} checked claims aren't fully supported by the papers they
          cite. See Citation check.
        </button>
      )}

      <div className="print:hidden">
        <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} label="Review sections">
          {content}
        </Tabs>
        {shown.run_meta && <RunInfo run={shown.run_meta} />}
      </div>

      {/* Print / Save as PDF: every section in order, then the references. */}
      <article className="hidden print:block space-y-6">
        <h1 className="text-2xl font-semibold">Literature review: {topic}</h1>
        {REVIEW_SECTIONS.filter(([key]) => shown[key]).map(([key, title]) => (
          <section key={key}>
            <h2 className="text-lg font-semibold mb-2">{title}</h2>
            <Markdown>{render(String(shown[key]))}</Markdown>
          </section>
        ))}
        <section>
          <h2 className="text-lg font-semibold mb-2">References</h2>
          <Markdown>{referenceList(numbers, byId)}</Markdown>
        </section>
      </article>
    </div>
  )
}
