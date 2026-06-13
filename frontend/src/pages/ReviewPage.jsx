import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Download, Loader2, BookOpen } from 'lucide-react'
import toast from 'react-hot-toast'
import { reviewsAPI } from '../services/api'

const TABS = [
  { key: 'introduction', label: 'Introduction' },
  { key: 'body',         label: 'Survey'       },
  { key: 'discussion',   label: 'Discussion'   },
  { key: 'trends',       label: 'Trends'       },
  { key: 'gaps',         label: 'Gaps'         },
  { key: 'conclusion',   label: 'Conclusion'   },
]

// Very minimal markdown-to-HTML renderer (no external dep needed for this)
function renderMd(text) {
  if (!text) return ''
  return text
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\| .+$/gm, m => `<tr>${m.replace(/\|/g,'<td>').replace(/<td>$/, '')}</tr>`)
    .replace(/(<tr>.*<\/tr>\n?)+/gs, t => `<table>${t}</table>`)
    .replace(/^- (.+)$/gm,   '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, l => `<ul>${l}</ul>`)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hultd])(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '')
}

export default function ReviewPage() {
  const { id } = useParams()
  const [review,    setReview]    = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('introduction')

  useEffect(() => { fetchReview() }, [id])

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

  const download = async () => {
    try {
      const { data } = await reviewsAPI.markdown(id)
      const blob = new Blob([data], { type: 'text/markdown' })
      const url  = URL.createObjectURL(blob)
      const a    = Object.assign(document.createElement('a'), {
        href: url, download: `literature_review_project_${id}.md`
      })
      a.click(); URL.revokeObjectURL(url)
    } catch { toast.error('Download failed') }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="animate-spin text-blue-500" size={22} />
    </div>
  )

  if (!review) return (
    <div className="text-center py-16">
      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
        <BookOpen size={18} className="text-blue-500" />
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
          <Link to={`/project/${id}`}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
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
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px
              ${activeTab === tab.key
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="card-p min-h-64">
        {content ? (
          <div
            className="prose-content"
            dangerouslySetInnerHTML={{ __html: renderMd(content) }}
          />
        ) : (
          <div className="text-center py-12">
            <p className="text-sm text-gray-400">No content for this section.</p>
          </div>
        )}
      </div>
    </div>
  )
}
