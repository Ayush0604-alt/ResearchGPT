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
