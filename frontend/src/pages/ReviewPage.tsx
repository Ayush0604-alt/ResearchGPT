import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, BookOpen, Download, Loader2, Printer } from 'lucide-react'
import Markdown from '../components/Markdown'
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
import { usePapers, useProject, useReview } from '../services/queries'
import type { CitationCheck, LiteratureReview, Paper, RunMeta } from '../services/types'

type Tab = keyof LiteratureReview | 'references' | 'checks'

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

export default function ReviewPage() {
  const { id = '' } = useParams()
  const [activeTab, setActiveTab] = useState<Tab>('introduction')
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

  const byId = new Map<number, Paper>(papers.map((p) => [p.id, p]))
  const numbers = citationNumbers(review, papers)
  const render = (text: string | null) => linkCitations(text ?? '', numbers, byId)
  const checks = review.citation_checks ?? []
  const flagged = checks.filter((c) => c.verdict !== 'supported').length
  const topic = project?.topic ?? 'research topic'
  const slug =
    topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40) || `project-${id}`

  const tabs: [Tab, string][] = [
    ...REVIEW_SECTIONS.filter(([key]) => review[key]),
    ['references', 'References'],
    ['checks', flagged ? `Citation check (${flagged})` : 'Citation check'],
  ]

  const content =
    activeTab === 'references' ? (
      <Markdown>{referenceList(numbers, byId)}</Markdown>
    ) : activeTab === 'checks' ? (
      <CitationChecks checks={checks} numbers={numbers} />
    ) : review[activeTab] ? (
      <Markdown>{render(String(review[activeTab]))}</Markdown>
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
              download(`${slug}.md`, reviewMarkdown(review, papers, topic), 'text/markdown')
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
        <div className="flex gap-0.5 mb-5 border-b border-gray-200 overflow-x-auto" role="tablist">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px ${
                activeTab === key
                  ? 'border-brand-600 text-brand-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="card-p min-h-64" role="tabpanel">
          {content}
        </div>
        {review.run_meta && <RunInfo run={review.run_meta} />}
      </div>

      {/* Print / Save as PDF: every section in order, then the references. */}
      <article className="hidden print:block space-y-6">
        <h1 className="text-2xl font-semibold">Literature review: {topic}</h1>
        {REVIEW_SECTIONS.filter(([key]) => review[key]).map(([key, title]) => (
          <section key={key}>
            <h2 className="text-lg font-semibold mb-2">{title}</h2>
            <Markdown>{render(String(review[key]))}</Markdown>
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
