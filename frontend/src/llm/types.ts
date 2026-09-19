// Provider-neutral LLM types. The browser talks to the provider directly with
// the user's own key; the ResearchGPT backend never sees the key.

export type ProviderId = 'gemini'

export interface ModelInfo {
  id: string
  label: string
  inputTokenLimit?: number
}

/** The key was rejected (invalid, revoked, or the API isn't enabled). */
export class InvalidKeyError extends Error {
  constructor(message = 'Your API key was rejected. Check it in Settings.') {
    super(message)
    this.name = 'InvalidKeyError'
  }
}

/** Quota or rate limit hit. `retryAfterMs` comes from the provider when it says. */
export class RateLimitError extends Error {
  constructor(
    message = 'Your API key hit its rate limit. Wait a minute and try again.',
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'RateLimitError'
  }
}

/** Any other provider failure. `retryable` marks transient ones (5xx, network). */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface CompletionRequest {
  apiKey: string
  model: string
  system?: string
  messages: ChatTurn[]
  maxOutputTokens?: number
  temperature?: number
  /** When set, the provider is asked for JSON matching this schema. */
  schema?: import('zod').ZodType
  signal?: AbortSignal
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface Completion {
  text: string
  /** 'length' = cut off by maxOutputTokens; 'blocked' = safety filter. */
  finishReason: 'stop' | 'length' | 'blocked' | 'other'
  usage?: Usage
}

export interface LLMProvider {
  id: ProviderId
  label: string
  /** Where users get a key (shown on the settings page). */
  keyUrl: string
  /** Domain the key is sent to (shown to users and allowed by the CSP). */
  apiHost: string
  listModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]>
  /** One request, no retries (see generate.ts for retries and validation). */
  complete(req: CompletionRequest): Promise<Completion>
  /** Yields text chunks as they arrive. */
  stream(req: CompletionRequest): AsyncGenerator<string>
}
