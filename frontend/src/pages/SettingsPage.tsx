import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { getProvider, InvalidKeyError } from '../llm'
import { authAPI, errorMessage } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { useLLMSettings } from '../store/llmSettings'

export default function SettingsPage() {
  const [params] = useSearchParams()
  const settings = useLLMSettings()
  const provider = getProvider(settings.provider)
  const [draft, setDraft] = useState(settings.apiKey)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)

  const testKey = async (e: FormEvent) => {
    e.preventDefault()
    const key = draft.trim()
    if (!key) return
    settings.setKey(key)
    setTesting(true)
    try {
      const models = await provider.listModels(key)
      if (models.length === 0) throw new Error('This key has no text models available.')
      settings.markVerified(models)
      toast.success('Key works — saved in this browser')
    } catch (err) {
      toast.error(
        err instanceof InvalidKeyError
          ? 'That key was rejected. Copy it again from ' + provider.label + '.'
          : (err as Error).message,
      )
    } finally {
      setTesting(false)
    }
  }

  const clearKey = () => {
    if (!confirm('Remove your API key from this browser?')) return
    settings.clear()
    setDraft('')
    toast.success('Key removed from this browser')
  }

  return (
    <div className="max-w-xl space-y-5">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Bring your own AI key</p>
      </div>

      {params.get('welcome') && !settings.verified && (
        <div className="card-p bg-brand-50 border-brand-100 text-sm text-espresso-900">
          <p className="font-medium mb-1">One more step</p>
          <p>
            ResearchGPT runs the AI analysis with your own {provider.label} API key. Add it below to
            start your first project.
          </p>
        </div>
      )}

      <form onSubmit={testKey} className="card-p space-y-4">
        <div>
          <label htmlFor="llm-provider" className="label">
            Provider
          </label>
          <select id="llm-provider" className="input" value={settings.provider} disabled>
            <option value="gemini">{provider.label}</option>
          </select>
        </div>

        <div>
          <label htmlFor="llm-api-key" className="label">
            API key
          </label>
          <div className="flex gap-2">
            <input
              id="llm-api-key"
              type={showKey ? 'text' : 'password'}
              className="input flex-1 font-mono"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste your key"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn-secondary px-3"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            No key yet?{' '}
            <a
              href={provider.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Get one from {provider.label}
            </a>
            .
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button type="submit" className="btn-primary" disabled={testing || !draft.trim()}>
            {testing ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Test &amp; save key
          </button>
          {settings.apiKey && (
            <button type="button" className="btn-ghost text-red-600" onClick={clearKey}>
              Clear key
            </button>
          )}
          {settings.verified && draft.trim() === settings.apiKey && (
            <span className="badge-green ml-auto">
              <CheckCircle size={11} /> Key works
            </span>
          )}
        </div>
      </form>

      {settings.verified && (
        <div className="card-p space-y-4">
          <div>
            <label htmlFor="llm-extract-model" className="label">
              Model for reading each paper
            </label>
            <select
              id="llm-extract-model"
              className="input"
              value={settings.extractModel}
              onChange={(e) => settings.setModels({ extractModel: e.target.value })}
            >
              {settings.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1.5">
              Runs once per paper. A fast model is fine.
            </p>
          </div>
          <div>
            <label htmlFor="llm-synth-model" className="label">
              Model for the review and chat
            </label>
            <select
              id="llm-synth-model"
              className="input"
              value={settings.synthModel}
              onChange={(e) => settings.setModels({ synthModel: e.target.value })}
            >
              {settings.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="card-p flex gap-3 text-sm text-gray-600">
        <ShieldCheck size={18} className="text-green-600 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-gray-900">How your key is handled</p>
          <p>
            Stored only in this browser. Sent directly to <code>{provider.apiHost}</code>. Never
            sent to ResearchGPT servers. Usage is billed to your {provider.label} account.{' '}
            <Link to="/privacy" className="underline">
              More about your data
            </Link>
          </p>
        </div>
      </div>

      <DeleteAccount />
    </div>
  )
}

function DeleteAccount() {
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (
      !confirm(
        'Delete your account and all projects, papers, reviews and chats? This cannot be undone.',
      )
    )
      return
    setDeleting(true)
    try {
      await authAPI.deleteAccount(password)
      logout()
      toast.success('Your account was deleted')
      navigate('/login')
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the account'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <form onSubmit={submit} className="card-p space-y-3 border-red-100">
      <p className="text-sm font-medium text-gray-900">Delete account</p>
      <p className="text-xs text-gray-500">
        Removes your account and every project, paper, review and chat. Your API key stays in this
        browser until you clear it above.
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          className="input flex-1"
          placeholder="Your password"
          aria-label="Password to confirm deletion"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button
          type="submit"
          className="btn-secondary text-red-600"
          disabled={!password || deleting}
        >
          Delete account
        </button>
      </div>
    </form>
  )
}
