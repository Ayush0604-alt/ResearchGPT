import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, KeyRound, Loader2, Send, Square, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Markdown from '../components/Markdown'
import { useChat } from '../research/useChat'
import { useChatHistory, useClearChat, usePapers, useProject } from '../services/queries'
import type { ChatMessage, Paper } from '../services/types'
import { useHasVerifiedKey } from '../store/llmSettings'

const SUGGESTIONS = [
  'What models were used across papers?',
  'What datasets are most commonly used?',
  'What are the key findings?',
  'What limitations are mentioned?',
  'What future directions are suggested?',
]

function Avatar({ children, user = false }: { children: ReactNode; user?: boolean }) {
  return (
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5 ${
        user ? 'bg-gray-200 text-gray-600' : 'bg-brand-100 text-brand-600'
      }`}
    >
      {children}
    </div>
  )
}

function Bubble({
  role,
  content,
  sources,
  time,
}: {
  role: ChatMessage['role']
  content: string
  sources?: { title: string; url?: string | null }[]
  time?: string
}) {
  const isUser = role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <Avatar>AI</Avatar>}
      <div className="max-w-xl">
        <div
          className={`px-4 py-3 rounded-xl text-sm leading-relaxed ${
            isUser
              ? 'bg-brand-600 text-white rounded-br-sm'
              : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : (
            <Markdown className="prose-content prose-chat">{content}</Markdown>
          )}
        </div>
        {sources && sources.length > 0 && (
          <ul className="mt-2 space-y-1" aria-label="Sources">
            {sources.map((s) => (
              <li key={s.title} className="text-xs text-gray-400 line-clamp-1">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {s.title}
                  </a>
                ) : (
                  s.title
                )}
              </li>
            ))}
          </ul>
        )}
        {time && (
          <p className="text-xs text-gray-400 mt-1 px-1">
            {new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
      {isUser && <Avatar user>You</Avatar>}
    </div>
  )
}

export default function ChatPage() {
  const { id = '' } = useParams()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const hasKey = useHasVerifiedKey()
  const { data: project } = useProject(id)
  const { data: papers = [] } = usePapers(id)
  const { data: history = [], isPending: fetching } = useChatHistory(id)
  const clear = useClearChat(id)
  const chat = useChat(id, project?.topic ?? '')

  const paperById = new Map<number, Paper>(papers.map((p) => [p.id, p]))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history.length, chat.pending, chat.streamed.length])

  const send = async () => {
    const question = input.trim()
    if (!question || chat.busy) return
    setInput('')
    const saved = await chat.ask(question)
    if (!saved) setInput(question) // keep the question so it can be retried
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const clearChat = () => {
    if (!confirm('Clear all messages?')) return
    clear.mutate(undefined, { onError: () => toast.error('Failed to clear chat') })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 5.5rem)' }}>
      <div className="page-header flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link
            to={`/project/${id}`}
            aria-label="Back to project"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h1 className="page-title">Research chat</h1>
            <p className="page-sub">Ask questions grounded in your analysed papers</p>
          </div>
        </div>
        {history.length > 0 && (
          <button
            onClick={clearChat}
            className="btn-ghost text-xs text-gray-400 hover:text-red-500"
          >
            <Trash2 size={13} /> Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 pb-2" aria-live="polite">
        {fetching && (
          <div className="flex justify-center py-8">
            <Loader2 className="animate-spin text-gray-300" size={20} />
          </div>
        )}

        {!fetching && history.length === 0 && !chat.pending && (
          <div className="text-center py-12">
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center mx-auto mb-3">
              <BookOpen size={18} className="text-brand-500" />
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">Ask anything about your papers</p>
            <p className="text-xs text-gray-400 mb-5">
              Answers use your API key and cite the papers they draw on
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-600 hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg) => (
          <Bubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            time={msg.created_at}
            sources={msg.citations?.papers?.map((c) => ({
              title: c.title,
              url: paperById.get(c.paper_id)?.url,
            }))}
          />
        ))}

        {chat.pending && (
          <>
            <Bubble role="user" content={chat.pending} />
            {chat.streamed ? (
              <Bubble role="assistant" content={chat.streamed} />
            ) : (
              <div className="flex gap-3">
                <Avatar>AI</Avatar>
                <div className="bg-white border border-gray-200 rounded-xl rounded-bl-sm px-4 py-3 shadow-sm">
                  <div className="flex gap-1 items-center h-4" aria-label="Thinking">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce"
                        style={{ animationDelay: `${i * 120}ms` }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {hasKey ? (
        <div className="flex-shrink-0 pt-3 border-t border-gray-100 flex gap-2 items-end">
          <textarea
            ref={inputRef}
            className="input flex-1 resize-none py-2.5 leading-snug"
            rows={1}
            placeholder="Ask a question about your papers…"
            aria-label="Your question"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            style={{ minHeight: '42px', maxHeight: '100px' }}
          />
          {chat.busy ? (
            <button
              onClick={chat.stop}
              aria-label="Stop answering"
              className="btn-secondary flex-shrink-0 p-2.5"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={send}
              aria-label="Send question"
              disabled={!input.trim()}
              className="btn-primary flex-shrink-0 p-2.5"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      ) : (
        <div className="flex-shrink-0 pt-3 border-t border-gray-100 text-sm text-gray-600 flex items-center gap-3">
          <span>Chat uses your own API key.</span>
          <Link to="/settings" className="btn-primary btn-sm">
            <KeyRound size={13} /> Add your API key
          </Link>
        </div>
      )}
    </div>
  )
}
