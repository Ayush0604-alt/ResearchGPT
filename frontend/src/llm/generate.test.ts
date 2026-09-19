import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { generateJSON } from './generate'
import { withRetry } from './retry'
import { toGeminiSchema } from './schema'
import {
  InvalidKeyError,
  LLMError,
  RateLimitError,
  type Completion,
  type CompletionRequest,
  type LLMProvider,
} from './types'

const Schema = z.object({
  title: z.string().describe('Paper title'),
  tags: z.array(z.string()),
  score: z.number().nullable(),
})

function fakeProvider(...replies: (Completion | Error)[]) {
  const calls: CompletionRequest[] = []
  const provider = {
    id: 'gemini',
    label: 'Fake',
    keyUrl: '',
    apiHost: '',
    listModels: async () => [],
    stream: async function* () {},
    complete: vi.fn(async (req: CompletionRequest) => {
      calls.push(req)
      const next = replies.shift()
      if (!next) throw new Error('no more replies')
      if (next instanceof Error) throw next
      return next
    }),
  } satisfies LLMProvider
  return { provider, calls }
}

const reply = (text: string, finishReason: Completion['finishReason'] = 'stop'): Completion => ({
  text,
  finishReason,
  usage: { inputTokens: 10, outputTokens: 5 },
})

const req = { apiKey: 'k', model: 'm', messages: [{ role: 'user' as const, text: 'go' }] }
const noSleep = { sleep: async () => {} }

describe('toGeminiSchema', () => {
  it('produces upper-case types, required fields and property order', () => {
    expect(toGeminiSchema(Schema)).toEqual({
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Paper title' },
        tags: { type: 'ARRAY', items: { type: 'STRING' } },
        score: { type: 'NUMBER', nullable: true },
      },
      propertyOrdering: ['title', 'tags', 'score'],
      required: ['title', 'tags', 'score'],
    })
  })
})

describe('generateJSON', () => {
  it('returns validated data and usage', async () => {
    const { provider, calls } = fakeProvider(reply('{"title":"A","tags":[],"score":1}'))
    const result = await generateJSON(provider, { ...req, schema: Schema })
    expect(result.data).toEqual({ title: 'A', tags: [], score: 1 })
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    expect(calls[0].schema).toBe(Schema)
  })

  it('accepts JSON wrapped in a code fence', async () => {
    const { provider } = fakeProvider(reply('```json\n{"title":"A","tags":[],"score":null}\n```'))
    expect((await generateJSON(provider, { ...req, schema: Schema })).data.title).toBe('A')
  })

  it('asks once for a correction when the reply does not match the schema', async () => {
    const { provider, calls } = fakeProvider(
      reply('{"title":"A"}'),
      reply('{"title":"A","tags":["x"],"score":2}'),
    )
    const result = await generateJSON(provider, { ...req, schema: Schema })
    expect(result.data.tags).toEqual(['x'])
    expect(result.usage.outputTokens).toBe(10) // summed over both calls
    const repair = calls[1].messages.at(-1)!.text
    expect(repair).toMatch(/did not match the required format: tags/)
  })

  it('gives up after one failed correction', async () => {
    const { provider } = fakeProvider(reply('not json'), reply('still not json'))
    await expect(generateJSON(provider, { ...req, schema: Schema })).rejects.toThrow(
      /malformed data/,
    )
  })

  it('retries a truncated answer once with twice the token budget', async () => {
    const { provider, calls } = fakeProvider(
      reply('{"title":"A","ta', 'length'),
      reply('{"title":"A","tags":[],"score":null}'),
    )
    await generateJSON(provider, { ...req, schema: Schema, maxOutputTokens: 1000 })
    expect(calls.map((c) => c.maxOutputTokens)).toEqual([1000, 2000])
  })

  it('reports safety blocks without retrying', async () => {
    const { provider, calls } = fakeProvider(reply('', 'blocked'))
    await expect(generateJSON(provider, { ...req, schema: Schema })).rejects.toThrow(/declined/)
    expect(calls).toHaveLength(1)
  })

  it('retries rate limits, then succeeds', async () => {
    const { provider } = fakeProvider(
      new RateLimitError(undefined, 10),
      reply('{"title":"A","tags":[],"score":null}'),
    )
    const result = await generateJSON(provider, { ...req, schema: Schema, retry: noSleep })
    expect(result.data.title).toBe('A')
  })
})

describe('withRetry', () => {
  it('does not retry an invalid key', async () => {
    const fn = vi.fn().mockRejectedValue(new InvalidKeyError())
    await expect(withRetry(fn, noSleep)).rejects.toBeInstanceOf(InvalidKeyError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries retryable errors up to the limit', async () => {
    const fn = vi.fn().mockRejectedValue(new LLMError('503', 503, true))
    await expect(withRetry(fn, { ...noSleep, retries: 2 })).rejects.toBeInstanceOf(LLMError)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('waits for the provider-suggested delay on rate limits', async () => {
    const sleep = vi.fn(async () => {})
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitError(undefined, 7000))
      .mockResolvedValue('ok')
    await withRetry(fn, { sleep })
    expect(sleep).toHaveBeenCalledWith(7000, undefined)
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fn = vi.fn().mockRejectedValue(new LLMError('503', 503, true))
    await expect(withRetry(fn, { signal: controller.signal })).rejects.toBeInstanceOf(LLMError)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
