import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Download, Loader2, BookOpen } from 'lucide-react'
import toast from 'react-hot-toast'
import { reviewsAPI } from '../services/api'
import Markdown from '../components/Markdown'

const TABS = [
  { key: 'introduction', label: 'Introduction' },
  { key: 'body', label: 'Survey' },
  { key: 'discussion', label: 'Discussion' },
  { key: 'comparison', label: 'Comparison' },
  { key: 'trends', label: 'Trends' },
  { key: 'gaps', label: 'Gaps' },
  { key: 'conclusion', label: 'Conclusion' },
]

export default function ReviewPage() {
  const { id } = useParams()
  const [review, setReview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('introduction')

  const fetchReview = async () => {
    try {
      const { data } = await reviewsAPI.get(id)
      setReview(data)
    } catch (err) {
      if (err.response?.status !== 404) toast.error('Failed to load review')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReview()
  }, [id])

  const download = async () => {
    try {
      // FIX: api.js now sets responseType: 'text' for this endpoint
      const { data } = await reviewsAPI.markdown(id)
      const blob = new Blob([data], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `literature_review_project_${id}.md`,
      })
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Downloaded!')
    } catch {
      toast.error('Download failed')
    }
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="animate-spin text-brand-500" size={22} />
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

  const content = review[activeTab]

  return (
    <div>
      {/* Header */}
      <div className="page-header flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to={`/project/${id}`}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h1 className="page-title">Literature review</h1>
            <p className="page-sub">AI-generated research survey</p>
          </div>
        </div>
        <button onClick={download} className="btn-secondary btn-sm">
          <Download size={13} /> Download .md
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 mb-5 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px
              ${
                activeTab === tab.key
                  ? 'border-brand-600 text-brand-600 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="card-p min-h-64">
        {content ? (
          <Markdown>{content}</Markdown>
        ) : (
          <div className="text-center py-12">
            <p className="text-sm text-gray-400">No content for this section.</p>
          </div>
        )}
      </div>
    </div>
  )
}
