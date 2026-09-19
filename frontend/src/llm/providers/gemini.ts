import { toGeminiSchema } from '../schema'
import {
  InvalidKeyError,
  LLMError,
  RateLimitError,
  type Completion,
  type CompletionRequest,
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

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

function requestBody(req: CompletionRequest) {
  return {
    contents: req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    })),
    ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
    generationConfig: {
      temperature: req.temperature ?? 0.3,
      maxOutputTokens: req.maxOutputTokens ?? 8192,
      ...(req.schema
        ? { responseMimeType: 'application/json', responseSchema: toGeminiSchema(req.schema) }
        : {}),
    },
  }
}

/** Text of the first candidate, without "thought" parts. */
function textOf(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? []
  return parts
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
}

const BLOCKED = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']

function finishReasonOf(data: GeminiResponse): Completion['finishReason'] {
  if (data.promptFeedback?.blockReason) return 'blocked'
  const reason = data.candidates?.[0]?.finishReason
  if (!reason || reason === 'STOP') return 'stop'
  if (reason === 'MAX_TOKENS') return 'length'
  return BLOCKED.includes(reason) ? 'blocked' : 'other'
}

const jsonPost = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal,
})

/** Split a server-sent-events buffer into complete `data:` payloads. */
export function takeSSEEvents(buffer: string): { events: string[]; rest: string } {
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? ''
  const events = blocks
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join(''),
    )
    .filter(Boolean)
  return { events, rest }
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

  async complete(req) {
    const resp = await geminiFetch(
      req.apiKey,
      `/models/${encodeURIComponent(req.model)}:generateContent`,
      jsonPost(requestBody(req), req.signal),
    )
    const data: GeminiResponse = await resp.json()
    return {
      text: textOf(data),
      finishReason: finishReasonOf(data),
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    }
  },

  async *stream(req) {
    const resp = await geminiFetch(
      req.apiKey,
      `/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`,
      jsonPost(requestBody(req), req.signal),
    )
    if (!resp.body) throw new LLMError('Streaming is not supported in this browser.')
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() + '\n\n' : decoder.decode(value, { stream: true })
      const { events, rest } = takeSSEEvents(buffer)
      buffer = rest
      for (const event of events) {
        const chunk: GeminiResponse = JSON.parse(event)
        if (finishReasonOf(chunk) === 'blocked') {
          throw new LLMError('The model declined to answer (safety filter).')
        }
        const text = textOf(chunk)
        if (text) yield text
      }
      if (done) break
    }
  },
}
