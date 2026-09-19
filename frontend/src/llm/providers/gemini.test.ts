import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvalidKeyError, LLMError, RateLimitError } from '../types'
import { gemini } from './gemini'

const KEY = 'AIza-test-key'

function mockFetch(...responses: Response[]) {
  const fn = vi.fn()
  for (const r of responses) fn.mockResolvedValueOnce(r)
  vi.stubGlobal('fetch', fn)
  return fn
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('gemini.listModels', () => {
  it('sends the key in a header, never in the URL', async () => {
    const fetchMock = mockFetch(json({ models: [] }))
    await gemini.listModels(KEY)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).not.toContain(KEY)
    expect(url).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models/)
    expect(init.headers['x-goog-api-key']).toBe(KEY)
  })

  it('keeps only Gemini text models and follows pagination', async () => {
    mockFetch(
      json({
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            supportedGenerationMethods: ['generateContent'],
          },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ],
        nextPageToken: 'p2',
      }),
      json({
        models: [
          { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        ],
      }),
    )
    const models = await gemini.listModels(KEY)
    expect(models.map((m) => m.id)).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
  })

  it('maps a rejected key to InvalidKeyError', async () => {
    mockFetch(
      json(
        {
          error: {
            code: 400,
            message: 'API key not valid. Please pass a valid API key.',
            details: [{ reason: 'API_KEY_INVALID' }],
          },
        },
        400,
      ),
    )
    await expect(gemini.listModels(KEY)).rejects.toBeInstanceOf(InvalidKeyError)
  })

  it('maps 429 to RateLimitError with the suggested delay', async () => {
    mockFetch(json({ error: { code: 429, details: [{ retryDelay: '17s' }] } }, 429))
    const err = await gemini.listModels(KEY).catch((e) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    expect(err.retryAfterMs).toBe(17000)
  })

  it('marks 5xx and network failures as retryable, without leaking the key', async () => {
    mockFetch(json({ error: { message: 'backend error' } }, 503))
    const err = await gemini.listModels(KEY).catch((e) => e)
    expect(err).toBeInstanceOf(LLMError)
    expect(err.retryable).toBe(true)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const netErr = await gemini.listModels(KEY).catch((e) => e)
    expect(netErr.retryable).toBe(true)
    expect(String(netErr.message)).not.toContain(KEY)
  })
})

describe('gemini.complete', () => {
  it('builds the request: roles, system prompt, JSON schema, no key in URL', async () => {
    const fetchMock = mockFetch(
      json({
        candidates: [{ content: { parts: [{ text: '{"a":"b"}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
      }),
    )
    const { z } = await import('zod')
    const result = await gemini.complete({
      apiKey: KEY,
      model: 'gemini-2.5-flash',
      system: 'Be brief.',
      messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'hello' },
      ],
      schema: z.object({ a: z.string() }),
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    )
    const body = JSON.parse(init.body)
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model'])
    expect(body.systemInstruction.parts[0].text).toBe('Be brief.')
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema.type).toBe('OBJECT')
    expect(result).toEqual({
      text: '{"a":"b"}',
      finishReason: 'stop',
      usage: { inputTokens: 12, outputTokens: 3 },
    })
  })

  it('drops thought parts and reports truncation and safety blocks', async () => {
    mockFetch(
      json({
        candidates: [
          {
            content: { parts: [{ text: 'thinking…', thought: true }, { text: 'answer' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
      }),
      json({ promptFeedback: { blockReason: 'SAFETY' } }),
    )
    const req = { apiKey: KEY, model: 'm', messages: [{ role: 'user' as const, text: 'q' }] }
    expect(await gemini.complete(req)).toMatchObject({ text: 'answer', finishReason: 'length' })
    expect((await gemini.complete(req)).finishReason).toBe('blocked')
  })
})

describe('gemini.stream', () => {
  function sseResponse(chunks: string[]) {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c))
        controller.close()
      },
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  const event = (text: string) =>
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\r\n\r\n`

  it('yields text as events arrive, even when an event is split across reads', async () => {
    const whole = event('Hello') + event(', world')
    const fetchMock = mockFetch(
      sseResponse([whole.slice(0, 20), whole.slice(20, 70), whole.slice(70)]),
    )
    const out: string[] = []
    for await (const t of gemini.stream({
      apiKey: KEY,
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', text: 'hi' }],
    })) {
      out.push(t)
    }
    expect(out.join('')).toBe('Hello, world')
    expect(fetchMock.mock.calls[0][0]).toMatch(/:streamGenerateContent\?alt=sse$/)
  })

  it('handles a final event without a trailing blank line', async () => {
    mockFetch(sseResponse([event('a'), event('b').trimEnd()]))
    const out: string[] = []
    for await (const t of gemini.stream({ apiKey: KEY, model: 'm', messages: [] })) out.push(t)
    expect(out).toEqual(['a', 'b'])
  })
})
