import type Anthropic from '@anthropic-ai/sdk'
import {
  InvalidKeyError,
  LLMError,
  RateLimitError,
  type Completion,
  type CompletionRequest,
  type LLMProvider,
  type ModelInfo,
} from '../types'

// Claude, called straight from the browser with the official SDK. The SDK is
// loaded only when this provider is used, so Gemini users don't download it.
// `dangerouslyAllowBrowser` is what BYOK needs: the key is the user's own and
// never leaves this browser except to api.anthropic.com.

export const ANTHROPIC_HOST = 'api.anthropic.com'

/** Models that get server-side refusal fallbacks (a declined request is re-run on a fallback model). */
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1'])

/** Non-streaming requests stay at or above this, per the API's guidance; thinking counts toward it. */
const MIN_MAX_TOKENS = 16_000

let sdk: Promise<typeof import('@anthropic-ai/sdk')> | null = null
const loadSdk = () => (sdk ??= import('@anthropic-ai/sdk'))

async function client(apiKey: string): Promise<Anthropic> {
  const { default: Client } = await loadSdk()
  // Retries are done by generate.ts (withRetry), with the rest of the app's policy.
  return new Client({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 })
}

/** Map an SDK error to the app's typed errors. Messages never include the key. */
export async function toAnthropicError(err: unknown): Promise<unknown> {
  const { default: SDK } = await loadSdk()
  if (err instanceof SDK.APIUserAbortError) {
    return new DOMException('Aborted', 'AbortError')
  }
  if (err instanceof SDK.AuthenticationError || err instanceof SDK.PermissionDeniedError) {
    return new InvalidKeyError()
  }
  if (err instanceof SDK.RateLimitError) {
    // Headers.get() returns null when absent, and Number(null) is 0 — which is
    // finite, and would tell withRetry to retry with no backoff at all.
    const header = err.headers?.get('retry-after')
    const seconds = header ? Number(header) : NaN
    return new RateLimitError(undefined, Number.isFinite(seconds) ? seconds * 1000 : undefined)
  }
  if (err instanceof SDK.APIConnectionError) {
    return new LLMError('Could not reach Anthropic. Check your connection.', undefined, true)
  }
  if (err instanceof SDK.APIError) {
    const body = err.error as { error?: { message?: string } } | undefined
    const status = err.status
    return new LLMError(
      body?.error?.message || `Anthropic request failed (${status ?? 'network'})`,
      status,
      status === undefined || status >= 500, // 500s and 529 "overloaded" are transient
    )
  }
  return err
}

async function withErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw await toAnthropicError(err)
  }
}

async function params(req: CompletionRequest) {
  const messages: Anthropic.Beta.BetaMessageParam[] = req.messages.map((m) =>
    m.role === 'assistant'
      ? { role: 'assistant', content: m.text }
      : {
          role: 'user',
          content: [
            // Documents go before the text that refers to them.
            ...(m.files ?? []).map((f) => ({
              type: 'document' as const,
              source: { type: 'base64' as const, media_type: f.mimeType, data: f.data },
            })),
            { type: 'text' as const, text: m.text },
          ],
        },
  )
  let format: Anthropic.Beta.BetaJSONOutputFormat | undefined
  if (req.schema) {
    const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod')
    const { type, schema } = zodOutputFormat(req.schema)
    format = { type, schema }
  }
  const fallback = FALLBACK_MODELS.has(req.model)
  // No `temperature`: current Claude models reject sampling parameters.
  return {
    model: req.model,
    max_tokens: Math.max(req.maxOutputTokens ?? MIN_MAX_TOKENS, MIN_MAX_TOKENS),
    messages,
    ...(req.system ? { system: req.system } : {}),
    ...(format ? { output_config: { format } } : {}),
    ...(fallback
      ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
      : {}),
  }
}

function finishReasonOf(stop: string | null | undefined): Completion['finishReason'] {
  if (!stop || stop === 'end_turn' || stop === 'stop_sequence') return 'stop'
  if (stop === 'max_tokens' || stop === 'model_context_window_exceeded') return 'length'
  return stop === 'refusal' ? 'blocked' : 'other'
}

export const anthropic: LLMProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  apiHost: ANTHROPIC_HOST,
  acceptsPdf: true,
  minOutputTokens: MIN_MAX_TOKENS,
  defaultModels: { fast: 'claude-haiku-4-5', strong: 'claude-opus-5' },

  listModels: (apiKey, signal) =>
    withErrors(async () => {
      const models: ModelInfo[] = []
      for await (const m of (await client(apiKey)).models.list({ limit: 100 }, { signal })) {
        models.push({
          id: m.id,
          label: m.display_name || m.id,
          inputTokenLimit: m.max_input_tokens ?? undefined,
        })
      }
      return models.sort((a, b) => a.id.localeCompare(b.id))
    }),

  complete: (req) =>
    withErrors(async () => {
      const api = await client(req.apiKey)
      const response = await api.beta.messages.create(await params(req), { signal: req.signal })
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
      return {
        text,
        finishReason: finishReasonOf(response.stop_reason),
        usage: {
          inputTokens:
            response.usage.input_tokens +
            (response.usage.cache_read_input_tokens ?? 0) +
            (response.usage.cache_creation_input_tokens ?? 0),
          outputTokens: response.usage.output_tokens,
        },
      }
    }),

  async *stream(req) {
    const api = await client(req.apiKey)
    const stream = api.beta.messages.stream(await params(req), { signal: req.signal })
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text
        } else if (event.type === 'message_delta' && event.delta.stop_reason === 'refusal') {
          throw new LLMError('The model declined to answer (safety filter).')
        }
      }
    } catch (err) {
      throw err instanceof LLMError ? err : await toAnthropicError(err)
    }
  },
}
