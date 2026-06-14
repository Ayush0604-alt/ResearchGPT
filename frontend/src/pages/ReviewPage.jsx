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

/**
 * Minimal Markdown → HTML renderer.
 *
 * Fixes:
 * - ol closing tag was </ul> — now correctly </ol>
 * - Separator rows (|---|---|) are explicitly skipped
 * - thead/tbody properly structured for tables
 */
function renderMd(text) {
  if (!text) return ''

  const lines  = text.split('\n')
  const output = []
  let inTable  = false
  let inList   = false
  let inOl     = false
  let inPara   = false

  const closePara  = () => { if (inPara)  { output.push('</p>');   inPara  = false } }
  const closeUl    = () => { if (inList)  { output.push('</ul>');  inList  = false } }
  const closeOl    = () => { if (inOl)    { output.push('</ol>');  inOl    = false } } // FIX: was missing
  const closeTable = () => { if (inTable) { output.push('</tbody></table>'); inTable = false } }

  const closeLists = () => { closeUl(); closeOl() }

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i]
    const trimmed = line.trim()

    // Headings
    if (/^### /.test(trimmed)) {
      closePara(); closeLists(); closeTable()
      output.push(`<h3>${esc(trimmed.slice(4))}</h3>`)
      continue
    }
    if (/^## /.test(trimmed)) {
      closePara(); closeLists(); closeTable()
      output.push(`<h2>${esc(trimmed.slice(3))}</h2>`)
      continue
    }
    if (/^# /.test(trimmed)) {
      closePara(); closeLists(); closeTable()
      output.push(`<h1>${esc(trimmed.slice(2))}</h1>`)
      continue
    }

    // Tables — detect by leading pipe
    if (/^\|/.test(trimmed)) {
      // Skip separator rows like |---|---| or |:---|:---:|
      if (/^\|[\s\-|:]+\|$/.test(trimmed)) continue

      if (!inTable) {
        closePara(); closeLists()
        const nextLine = (lines[i + 1] || '').trim()
        const isHeader = /^\|[\s\-|:]+\|$/.test(nextLine)
        output.push('<table>')
        if (isHeader) {
          output.push('<thead><tr>')
          parseCells(trimmed).forEach(c => output.push(`<th>${inline(c)}</th>`))
          output.push('</tr></thead><tbody>')
          i++ // skip separator line
          inTable = true
          continue
        } else {
          output.push('<tbody>')
          inTable = true
        }
      }

      output.push('<tr>')
      parseCells(trimmed).forEach(c => output.push(`<td>${inline(c)}</td>`))
      output.push('</tr>')
      continue
    }

    // Unordered list items
    if (/^[-*] /.test(trimmed)) {
      closePara(); closeTable(); closeOl()
      if (!inList) { output.push('<ul>'); inList = true }
      output.push(`<li>${inline(trimmed.slice(2))}</li>`)
      continue
    }

    // Numbered / ordered list items
    if (/^\d+\. /.test(trimmed)) {
      closePara(); closeTable(); closeUl()
      if (!inOl) { output.push('<ol>'); inOl = true }
      output.push(`<li>${inline(trimmed.replace(/^\d+\. /, ''))}</li>`)
      continue
    }

    // Blank line — close everything open
    if (trimmed === '') {
      closePara(); closeLists(); closeTable()
      continue
    }

    // Normal paragraph text
    closeLists(); closeTable()
    if (!inPara) { output.push('<p>'); inPara = true }
    else output.push(' ')
    output.push(inline(trimmed))
  }

  // Close anything still open at EOF
  closePara(); closeLists(); closeTable()
  return output.join('')
}

function parseCells(row) {
  return row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim())
}

function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function inline(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
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
      // FIX: api.js now sets responseType: 'text' for this endpoint
      const { data } = await reviewsAPI.markdown(id)
      const blob = new Blob([data], { type: 'text/markdown' })
      const url  = URL.createObjectURL(blob)
      const a    = Object.assign(document.createElement('a'), {
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