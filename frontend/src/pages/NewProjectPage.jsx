import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Loader2, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import { errorMessage } from '../services/api'
import { useCreateProject } from '../services/queries'

const SOURCES = [
  ['semantic_scholar', 'Semantic Scholar'],
  ['openalex', 'OpenAlex'],
  ['arxiv', 'arXiv'],
  ['europepmc', 'Europe PMC'],
]

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
  const [form, setForm] = useState({
    topic: '',
    title: '',
    description: '',
    year_from: '',
    year_to: '',
    sources: SOURCES.map(([value]) => value),
    snowball: false,
  })
  const createProject = useCreateProject()
  const loading = createProject.isPending
  const navigate = useNavigate()

  const handleSubmit = (e) => {
    e.preventDefault()
    const topic = form.topic.trim()
    if (!topic) return toast.error('Research topic is required')
    // Send optional fields only when filled in.
    const title = form.title.trim() || undefined
    const description = form.description.trim() || undefined
    if (form.sources.length === 0) return toast.error('Choose at least one source')
    const filters = {
      year_from: form.year_from ? Number(form.year_from) : undefined,
      year_to: form.year_to ? Number(form.year_to) : undefined,
      // Omitted when all are chosen, so new sources are included automatically.
      sources: form.sources.length === SOURCES.length ? undefined : form.sources,
      snowball: form.snowball,
    }
    createProject.mutate(
      { topic, title, description, ...filters },
      {
        onSuccess: (project) => {
          toast.success('Project created')
          navigate(`/project/${project.id}`)
        },
        onError: (err) => toast.error(errorMessage(err, 'Failed to create project')),
      },
    )
  }

  return (
    <div className="max-w-xl">
      {/* Header */}
      <div className="page-header flex items-center gap-3">
        <Link
          to="/dashboard"
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700
                                         hover:bg-gray-100 transition-colors"
        >
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
            <label htmlFor="project-topic" className="label">
              Research topic <span className="text-red-500">*</span>
            </label>
            <input
              id="project-topic"
              type="text"
              className="input"
              placeholder="e.g. AI in Healthcare Diagnostics"
              minLength={3}
              maxLength={300}
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
              required
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1.5">Be specific for higher-quality results</p>
          </div>

          <div>
            <label htmlFor="project-title" className="label">
              Project title <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="project-title"
              type="text"
              className="input"
              placeholder="Auto-generated from topic if left blank"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div>
            <label htmlFor="project-description" className="label">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="project-description"
              className="input resize-none"
              rows={3}
              placeholder="Any additional context or scope…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <details className="rounded-lg border border-gray-200 px-4 py-3">
            <summary className="text-sm text-gray-600 cursor-pointer">
              Search filters <span className="text-gray-400">(optional)</span>
            </summary>
            <div className="mt-3 space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label htmlFor="project-year-from" className="label">
                    From year
                  </label>
                  <input
                    id="project-year-from"
                    type="number"
                    min={1900}
                    max={2100}
                    className="input"
                    placeholder="Any"
                    value={form.year_from}
                    onChange={(e) => setForm({ ...form, year_from: e.target.value })}
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="project-year-to" className="label">
                    To year
                  </label>
                  <input
                    id="project-year-to"
                    type="number"
                    min={1900}
                    max={2100}
                    className="input"
                    placeholder="Any"
                    value={form.year_to}
                    onChange={(e) => setForm({ ...form, year_to: e.target.value })}
                  />
                </div>
              </div>
              <fieldset>
                <legend className="label">Sources</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {SOURCES.map(([value, label]) => (
                    <label key={value} className="flex items-center gap-1.5 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.sources.includes(value)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            sources: e.target.checked
                              ? [...form.sources, value]
                              : form.sources.filter((s) => s !== value),
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.snowball}
                  onChange={(e) => setForm({ ...form, snowball: e.target.checked })}
                />
                <span>
                  Also follow citations
                  <span className="block text-xs text-gray-400">
                    Adds key papers the best matches cite, and later work that cites them.
                  </span>
                </span>
              </label>
            </div>
          </details>

          <div className="pt-1">
            <button type="submit" className="btn-primary w-full py-2.5" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Creating…
                </>
              ) : (
                'Create project'
              )}
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
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setForm((f) => ({ ...f, topic: ex }))}
              className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg
                         text-gray-600 hover:border-brand-300 hover:text-brand-600
                         hover:bg-brand-50 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
