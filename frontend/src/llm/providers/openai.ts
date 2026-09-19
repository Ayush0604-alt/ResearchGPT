import { z } from 'zod'
import { sseEvents } from '../sse'
import {
  InvalidKeyError,
  LLMError,
  RateLimitError,
  type Completion,
  type CompletionRequest,
  type LLMProvider,
  type ModelInfo,
} from '../types'

// OpenAI Chat Completions, called from the browser with the user's key.

export const OPENAI_HOST = 'api.openai.com'
const BASE = `https://${OPENAI_HOST}/v1`

/** Reasoning models (o-series, GPT-5) only accept the default temperature. */
const fixedTemperature = (model: string) => /^(o\d|gpt-5)/.test(model)

/** Chat models only: no embeddings, audio, images, moderation or legacy completions. */
const isChatModel = (id: string) =>
  /^(gpt-|o\d|chatgpt-)/.test(id) &&
  !/(audio|realtime|transcribe|tts|image|search|instruct|embedding|moderation)/.test(id)

interface OpenAIErrorBody {
  error?: { message?: string; type?: string; code?: string }
}

/** Map a failed OpenAI response to a typed error. Messages never include the key. */
export async function toOpenAIError(resp: Response): Promise<Error> {
  let body: OpenAIErrorBody = {}
  try {
    body = await resp.json()
  } catch {
    /* non-JSON error body */
  }
  const err = body.error ?? {}
  if (resp.status === 401 || resp.status === 403) return new InvalidKeyError()
  if (resp.status === 429) {
    if (err.code === 'insufficient_quota') {
      // Retrying won't help: the account is out of credit.
      return new LLMError('Your OpenAI account has no credit left. Check your billing.', 429)
    }
    const seconds = Number(resp.headers.get('retry-after'))
    return new RateLimitError(undefined, Number.isFinite(seconds) ? seconds * 1000 : undefined)
  }
  return new LLMError(
    err.message || `OpenAI request failed (${resp.status})`,
    resp.status,
    resp.status >= 500,
  )
}

async function openaiFetch(apiKey: string, path: string, init: RequestInit = {}) {
  let resp: Response
  try {
    resp = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new LLMError('Could not reach OpenAI. Check your connection.', undefined, true)
  }
  if (!resp.ok) throw await toOpenAIError(resp)
  return resp
}

function requestBody(req: CompletionRequest, stream: boolean) {
  const messages = [
    ...(req.system ? [{ role: 'system', content: req.system }] : []),
    ...req.messages.map((m) =>
      m.role === 'assistant' || !m.files?.length
        ? { role: m.role, content: m.text }
        : {
            role: 'user',
            content: [
              ...m.files.map((f, i) => ({
                type: 'file',
                file: {
                  filename: `paper-${i + 1}.pdf`,
                  file_data: `data:${f.mimeType};base64,${f.data}`,
                },
              })),
              { type: 'text', text: m.text },
            ],
          },
    ),
  ]
  let responseFormat: unknown
  if (req.schema) {
    const schema = z.toJSONSchema(req.schema) as Record<string, unknown>
    delete schema.$schema
    // Not `strict`: strict mode needs every field required. generate.ts validates.
    responseFormat = { type: 'json_schema', json_schema: { name: 'result', schema, strict: false } }
  }
  return {
    model: req.model,
    messages,
    max_completion_tokens: req.maxOutputTokens ?? 8192,
    ...(fixedTemperature(req.model) ? {} : { temperature: req.temperature ?? 0.3 }),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(stream ? { stream: true } : {}),
  }
}

interface ChatChoice {
  message?: { content?: string | null; refusal?: string | null }
  delta?: { content?: string | null; refusal?: string | null }
  finish_reason?: string | null
}

function finishReasonOf(choice?: ChatChoice): Completion['finishReason'] {
  const reason = choice?.finish_reason
  if (choice?.message?.refusal || choice?.delta?.refusal) return 'blocked'
  if (!reason || reason === 'stop') return 'stop'
  if (reason === 'length') return 'length'
  return reason === 'content_filter' ? 'blocked' : 'other'
}

export const openai: LLMProvider = {
  id: 'openai',
  label: 'OpenAI',
  keyUrl: 'https://platform.openai.com/api-keys',
  apiHost: OPENAI_HOST,
  acceptsPdf: true,
  defaultModels: { fast: 'gpt-5-mini', strong: 'gpt-5' },

  async listModels(apiKey, signal) {
    const resp = await openaiFetch(apiKey, '/models', { signal })
    const data: { data?: { id: string }[] } = await resp.json()
    const models: ModelInfo[] = (data.data ?? [])
      .filter((m) => isChatModel(m.id))
      .map((m) => ({ id: m.id, label: m.id }))
    return models.sort((a, b) => a.id.localeCompare(b.id))
  },

  async complete(req) {
    const resp = await openaiFetch(req.apiKey, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify(requestBody(req, false)),
      signal: req.signal,
    })
    const data: {
      choices?: ChatChoice[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    } = await resp.json()
    const choice = data.choices?.[0]
    return {
      text: choice?.message?.content ?? '',
      finishReason: finishReasonOf(choice),
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    }
  },

  async *stream(req) {
    const resp = await openaiFetch(req.apiKey, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify(requestBody(req, true)),
      signal: req.signal,
    })
    if (!resp.body) throw new LLMError('Streaming is not supported in this browser.')
    for await (const event of sseEvents(resp.body)) {
      if (event === '[DONE]') return
      const chunk: { choices?: ChatChoice[] } = JSON.parse(event)
      const choice = chunk.choices?.[0]
      if (finishReasonOf(choice) === 'blocked') {
        throw new LLMError('The model declined to answer (safety filter).')
      }
      const text = choice?.delta?.content
      if (text) yield text
    }
  },
}
