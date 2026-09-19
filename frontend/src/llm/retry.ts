import { LLMError, RateLimitError } from './types'

export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  signal?: AbortSignal
  /** Injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function isRetryable(err: unknown): boolean {
  return err instanceof RateLimitError || (err instanceof LLMError && err.retryable)
}

/**
 * Run `fn`, retrying rate limits and transient failures with exponential
 * backoff plus jitter. A rate limit's own retry-after hint wins when present.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    signal,
    sleep = abortableSleep,
  } = opts
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= retries || !isRetryable(err) || signal?.aborted) throw err
      const hinted = err instanceof RateLimitError ? err.retryAfterMs : undefined
      const backoff = baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5)
      await sleep(Math.min(hinted ?? backoff, maxDelayMs), signal)
    }
  }
}
