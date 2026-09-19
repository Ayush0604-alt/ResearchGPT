import {
  InvalidKeyError,
  LLMError,
  RateLimitError,
  type LLMProvider,
  type ModelInfo,
} from '../types'

export const GEMINI_HOST = 'generativelanguage.googleapis.com'
const BASE = `https://${GEMINI_HOST}/v1beta`

interface GeminiErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    details?: { reason?: string; retryDelay?: string }[]
  }
}

/** Map a failed Gemini response to a typed error. Messages never include the key. */
export async function toGeminiError(resp: Response): Promise<Error> {
  let body: GeminiErrorBody = {}
  try {
    body = await resp.json()
  } catch {
    /* non-JSON error body */
  }
  const err = body.error ?? {}
  const reasons = (err.details ?? []).map((d) => d.reason)
  if (
    resp.status === 401 ||
    resp.status === 403 ||
    reasons.includes('API_KEY_INVALID') ||
    (resp.status === 400 && /api key/i.test(err.message ?? ''))
  ) {
    return new InvalidKeyError()
  }
  if (resp.status === 429) {
    const delay = (err.details ?? []).find((d) => d.retryDelay)?.retryDelay // e.g. "17s"
    const seconds = delay ? parseFloat(delay) : NaN
    return new RateLimitError(undefined, Number.isFinite(seconds) ? seconds * 1000 : undefined)
  }
  return new LLMError(
    err.message || `Gemini request failed (${resp.status})`,
    resp.status,
    resp.status >= 500,
  )
}

export async function geminiFetch(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let resp: Response
  try {
    resp = await fetch(`${BASE}${path}`, {
      ...init,
      // Header, not ?key=: URLs end up in logs and browser history.
      headers: { 'x-goog-api-key': apiKey, ...(init.headers ?? {}) },
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new LLMError('Could not reach Gemini. Check your connection.', undefined, true)
  }
  if (!resp.ok) throw await toGeminiError(resp)
  return resp
}

interface GeminiModel {
  name: string
  displayName?: string
  inputTokenLimit?: number
  supportedGenerationMethods?: string[]
}

export const gemini: LLMProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  keyUrl: 'https://aistudio.google.com/app/apikey',
  apiHost: GEMINI_HOST,

  async listModels(apiKey, signal) {
    const models: ModelInfo[] = []
    let pageToken = ''
    do {
      const query = `?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`
      const resp = await geminiFetch(apiKey, `/models${query}`, { signal })
      const data: { models?: GeminiModel[]; nextPageToken?: string } = await resp.json()
      for (const m of data.models ?? []) {
        if (!m.supportedGenerationMethods?.includes('generateContent')) continue
        const id = m.name.replace(/^models\//, '')
        if (!id.startsWith('gemini')) continue // skip embedding/imagen/etc.
        models.push({ id, label: m.displayName || id, inputTokenLimit: m.inputTokenLimit })
      }
      pageToken = data.nextPageToken ?? ''
    } while (pageToken)
    return models.sort((a, b) => a.id.localeCompare(b.id))
  },
}
