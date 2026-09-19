import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { InvalidKeyError, LLMError, RateLimitError } from '../types'
import { anthropic } from './anthropic'

const KEY = 'sk-ant-test-key'

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

const message = (text: string, stop_reason = 'end_turn') =>
  json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text }],
    stop_reason,
    usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 5 },
  })

const headersOf = (init: RequestInit) => new Headers(init.headers)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('anthropic.complete', () => {
  it('calls the Messages API from the browser with the key in a header', async () => {
    const fetchMock = mockFetch(message('{"ok":true}'))
    const result = await anthropic.complete({
      apiKey: KEY,
      model: 'claude-haiku-4-5',
      system: 'Be brief.',
      messages: [
        {
          role: 'user',
          text: 'Summarise',
          files: [{ mimeType: 'application/pdf', data: 'JVBERi0=' }],
        },
      ],
      schema: z.object({ ok: z.boolean() }),
      maxOutputTokens: 4096,
      temperature: 0.2,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/)
    expect(String(url)).not.toContain(KEY)
    const headers = headersOf(init)
    expect(headers.get('x-api-key')).toBe(KEY)
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')

    const body = JSON.parse(init.body)
    expect(body.system).toBe('Be brief.')
    expect(body.max_tokens).toBe(16_000) // raised to the minimum
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('fallbacks')
    expect(body.messages[0].content[0]).toEqual({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' },
    })
    expect(body.output_config.format.type).toBe('json_schema')
    expect(body.output_config.format.schema.properties.ok.type).toBe('boolean')

    expect(result).toEqual({
      text: '{"ok":true}',
      finishReason: 'stop',
      usage: { inputTokens: 125, outputTokens: 30 },
    })
  })

  it('opts Opus 5 into server-side refusal fallbacks', async () => {
    const fetchMock = mockFetch(message('hi'))
    await anthropic.complete({
      apiKey: KEY,
      model: 'claude-opus-5',
      messages: [{ role: 'user', text: 'hi' }],
    })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body).fallbacks).toBe('default')
    expect(headersOf(init).get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
  })

  it('reports cut-off and refused answers', async () => {
    mockFetch(message('partial', 'max_tokens'), message('', 'refusal'))
    const req = {
      apiKey: KEY,
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user' as const, text: 'x' }],
    }
    expect((await anthropic.complete(req)).finishReason).toBe('length')
    expect((await anthropic.complete(req)).finishReason).toBe('blocked')
  })

  it('maps errors to the app’s error types', async () => {
    const error = (type: string) => ({
      type: 'error',
      error: { type, message: `${type} happened` },
    })
    const req = {
      apiKey: KEY,
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user' as const, text: 'x' }],
    }

    mockFetch(json(error('authentication_error'), 401))
    await expect(anthropic.complete(req)).rejects.toBeInstanceOf(InvalidKeyError)

    mockFetch(json(error('rate_limit_error'), 429, { 'retry-after': '7' }))
    const limited = await anthropic.complete(req).catch((e) => e)
    expect(limited).toBeInstanceOf(RateLimitError)
    expect(limited.retryAfterMs).toBe(7000)

    mockFetch(json(error('overloaded_error'), 529))
    const overloaded = await anthropic.complete(req).catch((e) => e)
    expect(overloaded).toBeInstanceOf(LLMError)
    expect(overloaded.retryable).toBe(true)
    expect(overloaded.message).toBe('overloaded_error happened')

    mockFetch(json(error('invalid_request_error'), 400))
    const bad = await anthropic.complete(req).catch((e) => e)
    expect(bad.retryable).toBe(false)
    expect(String(bad.message)).not.toContain(KEY)
  })
})

describe('anthropic.stream', () => {
  it('yields text deltas', async () => {
    const events = [
      [
        'message_start',
        {
          type: 'message_start',
          message: {
            id: 'm',
            type: 'message',
            role: 'assistant',
            model: 'claude-haiku-4-5',
            content: [],
            stop_reason: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
      ],
      [
        'content_block_start',
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      ],
      [
        'content_block_delta',
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
      ],
      [
        'content_block_delta',
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } },
      ],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      [
        'message_delta',
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      ],
      ['message_stop', { type: 'message_stop' }],
    ]
    const sse = events
      .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
      .join('')
    mockFetch(new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } }))

    const chunks: string[] = []
    for await (const chunk of anthropic.stream({
      apiKey: KEY,
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', text: 'hi' }],
    })) {
      chunks.push(chunk)
    }
    expect(chunks.join('')).toBe('Hello world')
  })
})

describe('anthropic.listModels', () => {
  it('lists models with their context window', async () => {
    mockFetch(
      json({
        data: [
          {
            id: 'claude-opus-5',
            display_name: 'Claude Opus 5',
            max_input_tokens: 1_000_000,
            type: 'model',
            created_at: '',
          },
          {
            id: 'claude-haiku-4-5',
            display_name: 'Claude Haiku 4.5',
            max_input_tokens: 200_000,
            type: 'model',
            created_at: '',
          },
        ],
        has_more: false,
        first_id: 'claude-opus-5',
        last_id: 'claude-haiku-4-5',
      }),
    )
    const models = await anthropic.listModels(KEY)
    expect(models).toEqual([
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', inputTokenLimit: 200_000 },
      { id: 'claude-opus-5', label: 'Claude Opus 5', inputTokenLimit: 1_000_000 },
    ])
  })
})
