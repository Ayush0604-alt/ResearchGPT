import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Send, Loader2, ArrowLeft, Trash2, BookOpen } from 'lucide-react'
import toast from 'react-hot-toast'
import { chatAPI } from '../services/api'

const SUGGESTIONS = [
  'What models were used across papers?',
  'What datasets are most commonly used?',
  'What are the key findings?',
  'What limitations are mentioned?',
  'What future directions are suggested?',
]

export default function ChatPage() {
  const { id } = useParams()
  const [messages, setMessages] = useState([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [fetching, setFetching] = useState(true)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => { loadHistory() }, [id])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadHistory = async () => {
    try {
      const { data } = await chatAPI.history(id)
      setMessages(data.messages || [])
    } catch { /* empty is fine */ }
    finally { setFetching(false) }
  }

  const send = async () => {
    const q = input.trim()
    if (!q || loading) return
    setInput('')
    const userMsg = { id: Date.now(), role: 'user', content: q, created_at: new Date().toISOString() }
    setMessages(m => [...m, userMsg])
    setLoading(true)
    try {
      const { data } = await chatAPI.query({ project_id: parseInt(id), question: q })
      setMessages(m => [...m, {
        id: Date.now() + 1,
        role: 'assistant',
        content: data.answer,
        citations: { sources: data.citations },
        created_at: new Date().toISOString(),
      }])
    } catch {
      toast.error('Query failed — please try again')
      setMessages(m => m.filter(x => x.id !== userMsg.id))
      setInput(q)
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const clearChat = async () => {
    if (!confirm('Clear all messages?')) return
    try {
      await chatAPI.clear(id)
      setMessages([])
    } catch { toast.error('Failed to clear chat') }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 5.5rem)' }}>
      {/* Header */}
      <div className="page-header flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to={`/project/${id}`}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h1 className="page-title">Research chat</h1>
            <p className="page-sub">Ask questions grounded in your analyzed papers</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button onClick={clearChat}
            className="btn-ghost text-xs text-gray-400 hover:text-red-500">
            <Trash2 size={13} /> Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-2">
        {fetching && (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-gray-300" size={20} />
          </div>
        )}

        {!fetching && messages.length === 0 && (
          <div className="text-center py-12">
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-3">
              <BookOpen size={18} className="text-brand-500" />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">
              Ask anything about your papers
            </p>
            <p className="text-xs text-gray-400 mb-5">
              Answers are grounded in the research you analyzed
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg
                             text-gray-600 hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50
                             transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-600 flex items-center
                              justify-center text-xs font-semibold flex-shrink-0 mt-0.5">
                AI
              </div>
            )}

            <div className="max-w-xl">
              <div className={`px-4 py-3 rounded-xl text-sm leading-relaxed
                ${msg.role === 'user'
                  ? 'bg-brand-600 text-white rounded-br-sm'
                  : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'}`}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>

              {/* Citations */}
              {msg.citations?.sources?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.citations.sources.slice(0, 3).map((src, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="text-xs text-gray-400 flex-shrink-0 mt-px">[{i + 1}]</span>
                      <p className="text-xs text-gray-400 line-clamp-1">{src.paper_title}</p>
                      <span className="text-xs text-gray-300 flex-shrink-0">
                        {Math.round(src.relevance_score * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-300 mt-1 px-1">
                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 flex items-center
                              justify-center text-xs font-semibold flex-shrink-0 mt-0.5">
                You
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-600 flex items-center
                            justify-center text-xs font-semibold flex-shrink-0">
              AI
            </div>
            <div className="bg-white border border-gray-200 rounded-xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center h-4">
                {[0, 1, 2].map(i => (
                  <span key={i}
                    className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce"
                    style={{ animationDelay: `${i * 120}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 pt-3 border-t border-gray-100 flex gap-2 items-end">
        <textarea
          ref={inputRef}
          className="input flex-1 resize-none py-2.5 leading-snug"
          rows={1}
          placeholder="Ask a question about your papers…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          style={{ minHeight: '42px', maxHeight: '100px' }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="btn-primary flex-shrink-0 p-2.5"
        >
          {loading
            ? <Loader2 size={16} className="animate-spin" />
            : <Send size={16} />}
        </button>
      </div>
    </div>
  )
}
