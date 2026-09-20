import type { z } from 'zod'
import { withRetry, type RetryOptions } from './retry'
import { LLMError, type CompletionRequest, type LLMProvider, type Usage } from './types'

export interface JSONRequest<T extends z.ZodType> extends Omit<CompletionRequest, 'schema'> {
  schema: T
  retry?: Omit<RetryOptions, 'signal'>
}

export interface JSONResult<T> {
  data: T
  usage: Usage
}

function addUsage(a: Usage, b?: Usage): Usage {
  return b
    ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens }
    : a
}

function parseJSON(text: string): unknown {
  // Models occasionally wrap JSON in a code fence despite JSON mode.
  const fenced = text.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/)
  return JSON.parse(fenced ? fenced[1] : text)
}

/**
 * Ask for structured output and return it validated against `schema`.
 *
 * - transient failures and rate limits are retried with backoff
 * - an answer cut off by the token limit is retried once with twice the budget
 * - an answer that isn't valid JSON for the schema is retried once, with the
 *   validation error shown to the model
 */
export async function generateJSON<T extends z.ZodType>(
  provider: LLMProvider,
  req: JSONRequest<T>,
): Promise<JSONResult<z.infer<T>>> {
  const { schema, retry, ...base } = req
  let usage: Usage = { inputTokens: 0, outputTokens: 0 }
  // Start at the provider's own floor, if it has one: doubling a budget the
  // provider would raise anyway sends the same number twice, so the retry below
  // would ask again with no more room than the attempt that ran out.
  let maxOutputTokens = Math.max(base.maxOutputTokens ?? 8192, provider.minOutputTokens ?? 0)
  let messages = base.messages
  let grewBudget = false
  let repaired = false

  for (;;) {
    const completion = await withRetry(
      () => provider.complete({ ...base, messages, maxOutputTokens, schema }),
      { ...retry, signal: base.signal },
    )
    usage = addUsage(usage, completion.usage)

    if (completion.finishReason === 'blocked') {
      throw new LLMError('The model declined to answer (safety filter).')
    }
    if (completion.finishReason === 'length') {
      if (grewBudget) throw new LLMError('The answer was too long for the model to finish.')
      grewBudget = true
      maxOutputTokens *= 2
      continue
    }

    let problem: string
    try {
      const parsed = schema.safeParse(parseJSON(completion.text))
      if (parsed.success) return { data: parsed.data, usage }
      problem = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
    } catch {
      problem = 'the reply was not valid JSON'
    }
    if (repaired) throw new LLMError(`The model returned malformed data (${problem}).`)
    repaired = true
    messages = [
      ...base.messages,
      { role: 'assistant', text: completion.text },
      {
        role: 'user',
        text: `That reply did not match the required format: ${problem}. Reply again with only the corrected JSON.`,
      },
    ]
  }
}

/** Rough token count for cost estimates (≈4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
