import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Loader2, CheckCircle, Clock, XCircle, AlertCircle,
  Trash2, ChevronRight, FileSearch
} from 'lucide-react'
import toast from 'react-hot-toast'
import { projectsAPI } from '../services/api'

const STATUS = {
  pending:   { label: 'Pending',   cls: 'badge-amber', dot: 'bg-amber-400' },
  running:   { label: 'Running',   cls: 'badge-blue',  dot: 'bg-blue-400 animate-pulse' },
  completed: { label: 'Done',      cls: 'badge-green', dot: 'bg-green-500' },
  failed:    { label: 'Failed',    cls: 'badge-red',   dot: 'bg-red-400' },
}

export default function DashboardPage() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => { fetchProjects() }, [])

  const fetchProjects = async () => {
    try {
      const { data } = await projectsAPI.list()
      setProjects(data.projects || [])
    } catch {
      toast.error('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id, e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Delete this project? This action cannot be undone.')) return
    try {
      await projectsAPI.delete(id)
      setProjects(p => p.filter(x => x.id !== id))
      toast.success('Project deleted')
    } catch {
      toast.error('Could not delete project')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="animate-spin text-blue-500" size={24} />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header flex items-center justify-between">
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

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="card-p text-center py-16">
          <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <FileSearch size={22} className="text-blue-500" />
          </div>
          <h3 className="font-medium text-gray-900 mb-1">No projects yet</h3>
          <p className="text-sm text-gray-500 mb-5">
            Create your first project to start analyzing research papers with AI.
          </p>
          <Link to="/project/new" className="btn-primary">
            <Plus size={15} /> Create first project
          </Link>
        </div>
      )}

      {/* Table */}
      {projects.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Project
                </th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">
                  Status
                </th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">
                  Created
                </th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {projects.map(project => {
                const cfg = STATUS[project.status] || STATUS.pending
                return (
                  <tr key={project.id} className="group hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <Link to={`/project/${project.id}`} className="block">
                        <p className="text-sm font-medium text-gray-900 group-hover:text-blue-600
                                      transition-colors truncate max-w-sm">
                          {project.title}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate max-w-sm">
                          {project.topic}
                        </p>
                      </Link>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cfg.cls}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-400">
                      {new Date(project.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric'
                      })}
                    </td>
                    <td className="pr-4 py-3.5 text-right">
                      <button
                        onClick={e => handleDelete(project.id, e)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity
                                   p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
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
    </div>
  )
}
