import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { InvalidKeyError, LLMError, RateLimitError } from '../types'
import { openai } from './openai'

const KEY = 'sk-test-openai-key'

function mockFetch(...responses: Response[]) {
  const fn = vi.fn()
  for (const r of responses) fn.mockResolvedValueOnce(r)
  vi.stubGlobal('fetch', fn)
  return fn
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const req = { apiKey: KEY, model: 'gpt-5-mini', messages: [{ role: 'user' as const, text: 'x' }] }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openai.complete', () => {
  it('sends a chat completion with the key as a bearer token', async () => {
    const fetchMock = mockFetch(
      json({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 50, completion_tokens: 9 },
      }),
    )
    const result = await openai.complete({
      ...req,
      system: 'Be brief.',
      messages: [
        { role: 'user', text: 'Read', files: [{ mimeType: 'application/pdf', data: 'JVBERi0=' }] },
      ],
      schema: z.object({ ok: z.boolean() }),
      temperature: 0.2,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(init.body)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' })
    expect(body.messages[1].content[0]).toEqual({
      type: 'file',
      file: { filename: 'paper-1.pdf', file_data: 'data:application/pdf;base64,JVBERi0=' },
    })
    expect(body).not.toHaveProperty('temperature') // GPT-5 only takes the default
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.schema.properties.ok.type).toBe('boolean')
    expect(body.response_format.json_schema.schema).not.toHaveProperty('$schema')
    expect(result).toEqual({
      text: '{"ok":true}',
      finishReason: 'stop',
      usage: { inputTokens: 50, outputTokens: 9 },
    })
  })

  it('keeps temperature for models that accept it, and maps finish reasons', async () => {
    const fetchMock = mockFetch(
      json({ choices: [{ message: { content: 'cut' }, finish_reason: 'length' }] }),
      json({ choices: [{ message: { content: null, refusal: 'No' }, finish_reason: 'stop' }] }),
    )
    const first = await openai.complete({ ...req, model: 'gpt-4.1-mini', temperature: 0.4 })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).temperature).toBe(0.4)
    expect(first.finishReason).toBe('length')
    expect((await openai.complete(req)).finishReason).toBe('blocked')
  })

  it('maps errors', async () => {
    mockFetch(json({ error: { message: 'Incorrect API key provided' } }, 401))
    await expect(openai.complete(req)).rejects.toBeInstanceOf(InvalidKeyError)

    mockFetch(json({ error: { message: 'slow down' } }, 429, { 'retry-after': '3' }))
    const limited = await openai.complete(req).catch((e) => e)
    expect(limited).toBeInstanceOf(RateLimitError)
    expect(limited.retryAfterMs).toBe(3000)

    // Out of credit is not a rate limit: waiting won't help.
    mockFetch(json({ error: { message: 'quota', code: 'insufficient_quota' } }, 429))
    const broke = await openai.complete(req).catch((e) => e)
    expect(broke).toBeInstanceOf(LLMError)
    expect(broke.retryable).toBe(false)

    mockFetch(json({ error: { message: 'boom' } }, 503))
    expect((await openai.complete(req).catch((e) => e)).retryable).toBe(true)
  })
})

describe('openai.stream', () => {
  it('yields content deltas until [DONE]', async () => {
    const chunk = (content: string) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
    mockFetch(
      new Response(chunk('Hello ') + chunk('world') + 'data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
    const chunks: string[] = []
    for await (const c of openai.stream(req)) chunks.push(c)
    expect(chunks.join('')).toBe('Hello world')
  })
})

describe('openai.listModels', () => {
  it('keeps chat models only', async () => {
    mockFetch(
      json({
        data: [
          { id: 'gpt-5' },
          { id: 'gpt-5-mini' },
          { id: 'text-embedding-3-small' },
          { id: 'gpt-4o-realtime-preview' },
          { id: 'o3' },
          { id: 'dall-e-3' },
        ],
      }),
    )
    expect((await openai.listModels(KEY)).map((m) => m.id)).toEqual(['gpt-5', 'gpt-5-mini', 'o3'])
  })
})
