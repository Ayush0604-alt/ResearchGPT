import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Loader2, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import { projectsAPI } from '../services/api'

const EXAMPLES = [
  'AI in Healthcare Diagnostics',
  'Large Language Models for Code Generation',
  'Transformer Architectures in NLP',
  'Federated Learning and Privacy',
  'Graph Neural Networks for Drug Discovery',
  'Diffusion Models for Image Synthesis',
  'Reinforcement Learning from Human Feedback',
  'Vision Transformers vs CNNs',
]

export default function NewProjectPage() {
  const [form, setForm]       = useState({ topic: '', title: '', description: '' })
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    const topic = form.topic.trim()
    if (!topic) return toast.error('Research topic is required')
    setLoading(true)
    try {
      const { data } = await projectsAPI.create({ ...form, topic })
      toast.success('Project created')
      navigate(`/project/${data.id}`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl">
      {/* Header */}
      <div className="page-header flex items-center gap-3">
        <Link to="/dashboard" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700
                                         hover:bg-gray-100 transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="page-title">New project</h1>
          <p className="page-sub">Enter a research topic to start the AI pipeline</p>
        </div>
      </div>

      {/* Form */}
      <div className="card-p mb-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">
              Research topic <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="input"
              placeholder="e.g. AI in Healthcare Diagnostics"
              value={form.topic}
              onChange={e => setForm({ ...form, topic: e.target.value })}
              required
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1.5">
              Be specific for higher-quality results
            </p>
          </div>

          <div>
            <label className="label">
              Project title{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              className="input"
              placeholder="Auto-generated from topic if left blank"
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div>
            <label className="label">
              Description{' '}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="Any additional context or scope…"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="pt-1">
            <button
              type="submit"
              className="btn-primary w-full py-2.5"
              disabled={loading}
            >
              {loading
                ? <><Loader2 size={15} className="animate-spin" /> Creating…</>
                : 'Create project'
              }
            </button>
          </div>
        </form>
      </div>

      {/* Examples */}
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          Example topics
        </p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map(ex => (
            <button
              key={ex}
              type="button"
              onClick={() => setForm(f => ({ ...f, topic: ex }))}
              className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg
                         text-gray-600 hover:border-blue-300 hover:text-blue-600
                         hover:bg-blue-50 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
