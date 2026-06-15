import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Play, Loader2, CheckCircle, XCircle,
  MessageSquare, BookOpen, Presentation, ExternalLink,
  ChevronDown, ChevronUp, Users, ArrowLeft
} from 'lucide-react'
import toast from 'react-hot-toast'
import { projectsAPI, agentsAPI, papersAPI } from '../services/api'

const STEPS = [
  'Paper Search', 'Paper Collection', 'Doc Processing', 'Summarization',
  'Key Findings', 'Comparison', 'Trend Analysis', 'Research Gaps',
  'Lit. Review'
]

const SOURCE_LABELS = {
  arxiv:            'arXiv',
  semantic_scholar: 'Semantic Scholar',
  pubmed:           'PubMed',
}

function parseAuthors(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) } catch { return [] }
}

export default function ProjectPage() {
  const { id } = useParams()
  const [project,    setProject]    = useState(null)
  const [papers,     setPapers]     = useState([])
  const [taskStatus, setTaskStatus] = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [starting,   setStarting]   = useState(false)
  const [expanded,   setExpanded]   = useState({})
  const pollRef = useRef(null)

  useEffect(() => {
    load()
    return () => clearInterval(pollRef.current)
  }, [id])

  const load = async () => {
    try {
      const pjRes = await projectsAPI.get(id)
      setProject(pjRes.data)

      // FIX: papersAPI.list returns the papers array directly as data
      // (FastAPI List[PaperOut] response), so we handle both array and object shapes.
      try {
        const papRes = await papersAPI.list(id)
        const papersData = Array.isArray(papRes.data) ? papRes.data : (papRes.data || [])
        setPapers(papersData)
      } catch {
        setPapers([])
      }

      if (pjRes.data.task_id && pjRes.data.status === 'running') {
        poll(pjRes.data.task_id)
      }
    } catch {
      toast.error('Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const startPipeline = async () => {
    setStarting(true)
    try {
      const { data } = await agentsAPI.run({ project_id: parseInt(id), max_papers: 10 })
      setProject(p => ({ ...p, status: 'running', task_id: data.task_id }))
      setTaskStatus(data)
      poll(data.task_id)
      toast.success('Pipeline started!')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to start pipeline')
      setStarting(false)
    }
  }

  const poll = (tid) => {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await agentsAPI.status(tid)
        setTaskStatus(data)
        if (data.status === 'completed') {
          clearInterval(pollRef.current)
          setStarting(false)
          setProject(p => ({ ...p, status: 'completed' }))
          try {
            const { data: papData } = await papersAPI.list(id)
            setPapers(Array.isArray(papData) ? papData : (papData || []))
          } catch { /* non-critical */ }
          toast.success('Pipeline completed!')
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current)
          setStarting(false)
          setProject(p => ({ ...p, status: 'failed' }))
          toast.error('Pipeline failed: ' + (data.error || 'Unknown error'))
        }
      } catch { /* swallow polling errors */ }
    }, 2500)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="animate-spin text-brand-500" size={24} />
    </div>
  )

  if (!project) return (
    <div className="text-sm text-gray-500">Project not found.</div>
  )

  const isRunning   = project.status === 'running'
  const isCompleted = project.status === 'completed'
  const isFailed    = project.status === 'failed'
  const isPending   = project.status === 'pending'

  const stepIdx = taskStatus
    ? STEPS.findIndex(s => s === taskStatus.current_agent)
    : isCompleted ? STEPS.length : -1

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="page-header">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <Link to="/dashboard"
              className="mt-0.5 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
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
            {(isPending || isFailed) && (
              <button
                onClick={startPipeline}
                disabled={starting}
                className="btn-primary btn-sm"
              >
                {starting
                  ? <><Loader2 size={13} className="animate-spin" /> Starting…</>
                  : <><Play size={13} /> Run pipeline</>
                }
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Status pill */}
      <div className="flex items-center gap-2">
        {isPending   && <span className="badge-amber"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Ready to run</span>}
        {isRunning   && <span className="badge-blue"><span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" /> Running</span>}
        {isCompleted && <span className="badge-green"><CheckCircle size={11} /> Completed · {papers.length} papers</span>}
        {isFailed    && <span className="badge-red"><XCircle size={11} /> Failed</span>}
      </div>

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
              const done   = isCompleted || stepIdx > i
              const active = stepIdx === i && isRunning
              return (
                <div key={step} className="flex flex-col items-center gap-1.5 flex-1">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs
                    transition-all duration-300
                    ${done   ? 'bg-green-500 text-white'
                    : active ? 'bg-brand-500 text-white ring-2 ring-brand-200'
                    :          'bg-gray-100 text-gray-400'}`}>
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
            {papers.map(paper => {
              const authors = parseAuthors(paper.authors)
              const isOpen  = expanded[paper.id]
              return (
                <div key={paper.id}>
                  <button
                    className="w-full flex items-start justify-between px-5 py-3.5
                               hover:bg-gray-50 transition-colors text-left gap-4"
                    onClick={() => setExpanded(e => ({ ...e, [paper.id]: !e[paper.id] }))}
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
                          onClick={e => e.stopPropagation()}
                          className="p-1 text-gray-400 hover:text-brand-500 transition-colors"
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                      {isOpen
                        ? <ChevronUp size={15} className="text-gray-400" />
                        : <ChevronDown size={15} className="text-gray-400" />}
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
