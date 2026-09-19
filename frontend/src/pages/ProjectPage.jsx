import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import {
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  MessageSquare,
  BookOpen,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Users,
  ArrowLeft,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { errorMessage, httpStatus } from '../services/api'
import {
  invalidateProjectResults,
  usePapers,
  useProject,
  useRunPipeline,
  useTaskStatus,
} from '../services/queries'

// Must match the current_agent names reported by backend/app/agents/workflow.py
const STEPS = ['Paper Search', 'Paper Collection', 'Comprehensive Analysis']

const SOURCE_LABELS = {
  arxiv: 'arXiv',
  semantic_scholar: 'Semantic Scholar',
  pubmed: 'PubMed',
}

function parseAuthors(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export default function ProjectPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState({})
  const { data: project, isPending: loading } = useProject(id)
  const { data: papers = [] } = usePapers(id)
  const runPipeline = useRunPipeline(id)
  const starting = runPipeline.isPending

  // Poll the task only while the project says a run is in progress.
  const taskId = project?.status === 'running' ? project.task_id : null
  const { data: taskStatus, error: taskError } = useTaskStatus(taskId)
  // 404 means the task is gone (e.g. the server restarted mid-run).
  const taskState = httpStatus(taskError) === 404 ? 'gone' : taskStatus?.status

  // When a run ends, tell the user once and refresh everything it changed.
  const announced = useRef(null)
  useEffect(() => {
    if (!taskId || !['completed', 'failed', 'gone'].includes(taskState)) return
    const key = `${taskId}:${taskState}`
    if (announced.current === key) return
    announced.current = key
    if (taskState === 'completed') toast.success('Pipeline completed!')
    else if (taskState === 'failed') toast.error('Pipeline failed')
    else toast.error('This run was interrupted. Please run the pipeline again.')
    invalidateProjectResults(qc, id)
  }, [taskId, taskState, qc, id])

  const startPipeline = () => {
    if (
      project.status === 'completed' &&
      !confirm('Run the pipeline again? This replaces the current papers and review.')
    )
      return
    runPipeline.mutate(undefined, {
      onSuccess: () => toast.success('Pipeline started!'),
      onError: (err) => toast.error(errorMessage(err, 'Failed to start pipeline')),
    })
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="animate-spin text-brand-500" size={24} />
      </div>
    )

  if (!project) return <div className="text-sm text-gray-500">Project not found.</div>

  const isRunning = project.status === 'running'
  const isCompleted = project.status === 'completed'
  const isFailed = project.status === 'failed'
  const isPending = project.status === 'pending'

  const stepIdx = taskStatus
    ? STEPS.findIndex((s) => s === taskStatus.current_agent)
    : isCompleted
      ? STEPS.length
      : -1

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="page-header">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <Link
              to="/dashboard"
              className="mt-0.5 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft size={15} />
            </Link>
            <div>
              <h1 className="page-title">{project.title}</h1>
              <p className="page-sub">Topic: {project.topic}</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {isCompleted && (
              <>
                <Link to={`/project/${id}/chat`} className="btn-secondary btn-sm">
                  <MessageSquare size={13} /> Chat
                </Link>
                <Link to={`/project/${id}/review`} className="btn-secondary btn-sm">
                  <BookOpen size={13} /> Review
                </Link>
              </>
            )}
            {(isPending || isFailed || isCompleted) && (
              <button
                onClick={startPipeline}
                disabled={starting}
                className={isCompleted ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}
              >
                {starting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Starting…
                  </>
                ) : (
                  <>
                    <Play size={13} /> {isCompleted ? 'Run again' : 'Run pipeline'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Status pill */}
      <div className="flex items-center gap-2">
        {isPending && (
          <span className="badge-amber">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Ready to run
          </span>
        )}
        {isRunning && (
          <span className="badge-blue">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" /> Running
          </span>
        )}
        {isCompleted && (
          <span className="badge-green">
            <CheckCircle size={11} /> Completed · {papers.length} papers
          </span>
        )}
        {isFailed && (
          <span className="badge-red">
            <XCircle size={11} /> Failed
          </span>
        )}
      </div>

      {isFailed && project.error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          {project.error}
        </p>
      )}

      {/* Pipeline progress */}
      {(isRunning || (taskStatus && isCompleted)) && (
        <div className="card-p">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">Pipeline progress</span>
            <span className="text-xs text-gray-400">
              {taskStatus?.progress ?? 0}% — {taskStatus?.current_agent || '…'}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1.5 bg-gray-100 rounded-full mb-5 overflow-hidden">
            <div
              className="h-1.5 bg-brand-500 rounded-full transition-all duration-700"
              style={{ width: `${taskStatus?.progress ?? 0}%` }}
            />
          </div>

          {/* Step dots */}
          <div className="flex items-start justify-between gap-1">
            {STEPS.map((step, i) => {
              const done = isCompleted || stepIdx > i
              const active = stepIdx === i && isRunning
              return (
                <div key={step} className="flex flex-col items-center gap-1.5 flex-1">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs
                    transition-all duration-300
                    ${
                      done
                        ? 'bg-green-500 text-white'
                        : active
                          ? 'bg-brand-500 text-white ring-2 ring-brand-200'
                          : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {done ? <CheckCircle size={12} /> : i + 1}
                  </div>
                  <span className="text-center text-xs text-gray-400 leading-tight hidden sm:block">
                    {step}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Papers */}
      {papers.length > 0 && (
        <div>
          <h2 className="section-title">Papers analyzed ({papers.length})</h2>
          <div className="card divide-y divide-gray-50 overflow-hidden">
            {papers.map((paper) => {
              const authors = parseAuthors(paper.authors)
              const isOpen = expanded[paper.id]
              return (
                <div key={paper.id}>
                  <button
                    className="w-full flex items-start justify-between px-5 py-3.5
                               hover:bg-gray-50 transition-colors text-left gap-4"
                    onClick={() => setExpanded((e) => ({ ...e, [paper.id]: !e[paper.id] }))}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {paper.source && (
                          <span className="badge-gray text-xs">
                            {SOURCE_LABELS[paper.source] || paper.source}
                          </span>
                        )}
                        {paper.year && <span className="text-xs text-gray-400">{paper.year}</span>}
                      </div>
                      <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">
                        {paper.title}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                      {paper.url && (
                        <a
                          href={paper.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1 text-gray-400 hover:text-brand-500 transition-colors"
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                      {isOpen ? (
                        <ChevronUp size={15} className="text-gray-400" />
                      ) : (
                        <ChevronDown size={15} className="text-gray-400" />
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100">
                      {paper.abstract && (
                        <p className="text-sm text-gray-600 leading-relaxed mt-3 mb-2">
                          {paper.abstract}
                        </p>
                      )}
                      {authors.length > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                          <Users size={11} />
                          {authors.slice(0, 4).join(', ')}
                          {authors.length > 4 && ` +${authors.length - 4} more`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty run state */}
      {!isRunning && papers.length === 0 && !isPending && (
        <div className="card-p text-center py-10">
          <p className="text-sm text-gray-500">No papers found yet.</p>
        </div>
      )}
    </div>
  )
}
