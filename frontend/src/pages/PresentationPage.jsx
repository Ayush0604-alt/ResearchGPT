import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Download, Loader2, ChevronLeft, ChevronRight, Presentation } from 'lucide-react'
import toast from 'react-hot-toast'
import { presentationsAPI } from '../services/api'

export default function PresentationPage() {
  const { id }    = useParams()
  const [pres,    setPres]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [idx,     setIdx]     = useState(0)   // 0 = title slide

  // FIX: renamed from `fetch` to `loadPresentation` — `fetch` shadowed window.fetch,
  // which axios/httpx use internally and which caused silent failures in some environments.
  useEffect(() => { loadPresentation() }, [id])

  const loadPresentation = async () => {
    try {
      const { data } = await presentationsAPI.get(id)
      setPres(data)
    } catch (err) {
      if (err.response?.status !== 404) toast.error('Failed to load presentation')
    } finally {
      setLoading(false)
    }
  }

  const download = async () => {
    try {
      const { data } = await presentationsAPI.download(id)
      const url = URL.createObjectURL(new Blob([data],
        { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }))
      const a = Object.assign(document.createElement('a'), {
        href: url, download: `presentation_project_${id}.pptx`
      })
      a.click(); URL.revokeObjectURL(url)
      toast.success('Downloaded')
    } catch { toast.error('Download failed') }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="animate-spin text-blue-500" size={22} />
    </div>
  )

  if (!pres) return (
    <div className="text-center py-16">
      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
        <Presentation size={18} className="text-blue-500" />
      </div>
      <h3 className="text-sm font-medium text-gray-900 mb-1">No presentation yet</h3>
      <p className="text-xs text-gray-500 mb-4">Run the pipeline to generate a PPTX.</p>
      <Link to={`/project/${id}`} className="btn-secondary btn-sm">
        <ArrowLeft size={13} /> Back to project
      </Link>
    </div>
  )

  const slides       = pres.slide_data?.slides || []
  const titleText    = pres.slide_data?.title    || 'Research Presentation'
  const subtitleText = pres.slide_data?.subtitle || 'AI-Powered Literature Review'
  const totalSlides  = slides.length + 1   // +1 for title slide
  const current      = idx === 0 ? null : slides[idx - 1]

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
            <h1 className="page-title">Presentation</h1>
            <p className="page-sub">{slides.length + 1} slides generated</p>
          </div>
        </div>
        <button onClick={download} className="btn-primary btn-sm">
          <Download size={13} /> Download PPTX
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Main slide view */}
        <div className="lg:col-span-3">
          <div className="card overflow-hidden">
            {/* Slide canvas */}
            <div className="aspect-video bg-gradient-to-br from-slate-900 to-slate-800
                            relative flex items-center justify-center p-10 overflow-hidden">
              {/* Top accent bar */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />

              {idx === 0 ? (
                /* Title slide */
                <div className="text-center">
                  <p className="text-xs text-blue-400 uppercase tracking-widest mb-3 font-medium">
                    Research Review
                  </p>
                  <h2 className="text-3xl font-bold text-white mb-4 leading-tight">
                    {titleText}
                  </h2>
                  <div className="w-12 h-0.5 bg-blue-500 mx-auto mb-4" />
                  <p className="text-slate-400 text-base">{subtitleText}</p>
                </div>
              ) : current ? (
                /* Content slide */
                <div className="w-full">
                  <h2 className="text-2xl font-semibold text-white mb-6 pb-3
                                  border-b border-slate-700">
                    {current.title}
                  </h2>
                  <ul className="space-y-3">
                    {(current.bullets || []).map((b, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
                        <span className="text-slate-200 text-base leading-snug">{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Slide number */}
              <span className="absolute bottom-3 right-4 text-xs text-slate-600">
                {idx + 1} / {totalSlides}
              </span>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-white">
              <button
                onClick={() => setIdx(i => Math.max(0, i - 1))}
                disabled={idx === 0}
                className="btn-secondary btn-sm disabled:opacity-30"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span className="text-sm text-gray-500">
                Slide {idx + 1} of {totalSlides}
              </span>
              <button
                onClick={() => setIdx(i => Math.min(totalSlides - 1, i + 1))}
                disabled={idx >= totalSlides - 1}
                className="btn-secondary btn-sm disabled:opacity-30"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Thumbnails panel */}
        <div className="lg:col-span-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Slides
          </p>
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {/* Title thumbnail */}
            <button
              onClick={() => setIdx(0)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border text-xs transition-colors
                ${idx === 0
                  ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
            >
              <span className="text-gray-400 mr-1.5">1.</span> Title
            </button>

            {slides.map((slide, i) => (
              <button
                key={i}
                onClick={() => setIdx(i + 1)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border text-xs transition-colors truncate
                  ${idx === i + 1
                    ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
              >
                <span className="text-gray-400 mr-1.5">{i + 2}.</span>
                {slide.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}