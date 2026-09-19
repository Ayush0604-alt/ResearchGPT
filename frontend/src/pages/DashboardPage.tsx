import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { FileSearch, Loader2, Plus, Search, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { errorMessage } from '../services/api'
import { useDeleteProject, useProjects } from '../services/queries'
import type { Project, ProjectStatus } from '../services/types'

const STATUS: Record<ProjectStatus, { label: string; cls: string; dot: string }> = {
  pending: { label: 'Pending', cls: 'badge-amber', dot: 'bg-amber-400' },
  collecting: { label: 'Collecting', cls: 'badge-blue', dot: 'bg-brand-400 animate-pulse' },
  collected: { label: 'Analysis pending', cls: 'badge-blue', dot: 'bg-brand-400' },
  completed: { label: 'Done', cls: 'badge-green', dot: 'bg-green-500' },
  failed: { label: 'Failed', cls: 'badge-red', dot: 'bg-red-400' },
}

function matches(project: Project, query: string, status: ProjectStatus | 'all'): boolean {
  if (status !== 'all' && project.status !== status) return false
  const q = query.trim().toLowerCase()
  return !q || `${project.title} ${project.topic}`.toLowerCase().includes(q)
}

export default function DashboardPage() {
  const { data: projects = [], isPending, isError, error, refetch } = useProjects()
  const deleteProject = useDeleteProject()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ProjectStatus | 'all'>('all')

  const handleDelete = (project: Project, e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Delete this project? This action cannot be undone.')) return
    deleteProject.mutate(project.id, {
      onSuccess: () => toast.success('Project deleted'),
      onError: (err) => toast.error(errorMessage(err, 'Could not delete project')),
    })
  }

  if (isError) {
    return (
      <div className="card-p text-center py-12">
        <p className="text-sm text-gray-600 mb-3">
          {errorMessage(error, 'Failed to load projects')}
        </p>
        <button onClick={() => refetch()} className="btn-secondary btn-sm">
          Try again
        </button>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="flex items-center justify-center h-48" role="status" aria-label="Loading">
        <Loader2 className="animate-spin text-brand-500" size={24} />
      </div>
    )
  }

  const shown = projects.filter((p) => matches(p, query, status))

  return (
    <div>
      <div className="page-header flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">
            {projects.length === 0
              ? 'No projects yet'
              : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Link to="/project/new" className="btn-primary">
          <Plus size={15} /> New project
        </Link>
      </div>

      {projects.length === 0 && (
        <div className="card-p text-center py-16">
          <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-4">
            <FileSearch size={22} className="text-brand-500" />
          </div>
          <h2 className="font-medium text-gray-900 mb-1">No projects yet</h2>
          <p className="text-sm text-gray-500 mb-5">
            Create your first project to start analyzing research papers with AI.
          </p>
          <Link to="/project/new" className="btn-primary">
            <Plus size={15} /> Create first project
          </Link>
        </div>
      )}

      {projects.length > 0 && (
        <>
          <div className="flex gap-2 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                aria-hidden
              />
              <input
                type="search"
                className="input pl-8"
                placeholder="Search projects"
                aria-label="Search projects"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              className="input w-auto"
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus | 'all')}
            >
              <option value="all">All statuses</option>
              {Object.entries(STATUS).map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {shown.length === 0 ? (
            <p className="card-p text-sm text-gray-500 text-center py-10" role="status">
              No projects match.
            </p>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Project
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">
                      Status
                    </th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">
                      Papers
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">
                      Created
                    </th>
                    <th className="w-12">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {shown.map((project) => {
                    const cfg = STATUS[project.status] ?? STATUS.pending
                    return (
                      <tr key={project.id} className="group hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3.5">
                          <Link to={`/project/${project.id}`} className="block">
                            <p className="text-sm font-medium text-gray-900 group-hover:text-brand-600 transition-colors truncate max-w-sm">
                              {project.title}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-sm">
                              {project.topic}
                            </p>
                          </Link>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={cfg.cls}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} aria-hidden />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 text-right tabular-nums">
                          {project.paper_count ?? 0}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-gray-500">
                          {new Date(project.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="pr-4 py-3.5 text-right">
                          <button
                            onClick={(e) => handleDelete(project, e)}
                            aria-label={`Delete project ${project.title}`}
                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
