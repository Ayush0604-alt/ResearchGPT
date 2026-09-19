import { expect, type Page, type Route } from '@playwright/test'

// Shared e2e helpers: stubbed LLM provider APIs (the browser calls them with
// the user's key) and sign-up with a key.

export const KEY = 'AIza-e2e-research-key-0123456789'

export const EXTRACTION = {
  summary: 'The paper shows graph transformers improve molecular property prediction.',
  methodology: 'Benchmarks on OGB molecular datasets.',
  model_used: 'GraphGPS',
  dataset_used: 'ogbg-molhiv',
  metrics: 'ROC-AUC 0.79',
  contributions: 'A new positional encoding.',
  limitations: 'Quadratic memory in the number of nodes.',
  conclusion: 'Attention helps on molecules.',
  key_quotes: ['we observe consistent gains'],
}

export type Mode = 'ok' | 'rate-limited' | 'chat-down' | 'one-irrelevant'

function geminiResponse(body: unknown) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
  }
}

/**
 * What the stubbed model answers, whatever the provider: picked by the system
 * prompt of each pipeline stage. Returns null for a paper extraction, which
 * each stub handles itself (PDFs, rate limits).
 */
function answer(system: string, prompt: string, mode: Mode = 'ok'): unknown {
  if (system.includes('search academic databases')) {
    return { queries: ['graph neural networks', 'molecular graph learning'] }
  }
  if (system.includes('You screen papers')) {
    const ids = [...prompt.matchAll(/<paper id="C(\d+)">/g)].map((m) => Number(m[1]))
    return {
      ratings: ids.map((id) => ({
        id,
        score: mode === 'one-irrelevant' && id === 1 ? 1 : 8,
        reason: id === 1 && mode === 'one-irrelevant' ? 'Off topic' : 'Directly on topic',
      })),
    }
  }
  if (system.includes('fact-check')) {
    // The first claim is flagged, the rest are supported.
    const n = [...prompt.matchAll(/CLAIM (\d+):/g)].length
    return {
      checks: Array.from({ length: n }, (_, index) => ({
        index,
        verdict: index === 0 ? 'unsupported' : 'supported',
        note: index === 0 ? 'The papers do not say this.' : '',
      })),
    }
  }
  if (system.includes('literature reviews')) {
    const ids = [...prompt.matchAll(/<paper id="P(\d+)">/g)].map((m) => m[1])
    return {
      introduction: `Graph learning is moving fast [P${ids[0]}]. One claim is invented [P999999].`,
      body: `Transformers [P${ids[0]}] and message passing [P${ids[1]}] are compared.`,
      comparison: `| Paper | Approach |\n|---|---|\n| [P${ids[0]}] | Transformer |`,
      trends: 'Attention everywhere.',
      gaps: 'Scalability to large graphs.',
      discussion: 'Evidence is mixed.',
      conclusion: 'Promising but costly.',
    }
  }
  return null
}

/** Stub Anthropic's Messages API (what the official SDK calls from the browser). */
export async function stubAnthropic(page: Page) {
  const requests: { model: string; hasPdf: boolean }[] = []
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    const request = route.request()
    if (request.headers()['x-api-key'] !== KEY) {
      return route.fulfill({
        status: 401,
        json: {
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' },
        },
      })
    }
    if (request.method() === 'GET') {
      const model = (id: string, name: string) => ({
        id,
        display_name: name,
        type: 'model',
        created_at: '2026-01-01T00:00:00Z',
      })
      return route.fulfill({
        json: {
          data: [
            model('claude-opus-5', 'Claude Opus 5'),
            model('claude-haiku-4-5', 'Claude Haiku 4.5'),
          ],
          has_more: false,
          first_id: 'claude-opus-5',
          last_id: 'claude-haiku-4-5',
        },
      })
    }
    const body = request.postDataJSON()
    const content: { type: string; text?: string }[] = body.messages[0].content
    const prompt = content.find((b) => b.type === 'text')?.text ?? ''
    requests.push({ model: body.model, hasPdf: content.some((b) => b.type === 'document') })
    const reply = answer(body.system ?? '', prompt) ?? EXTRACTION
    return route.fulfill({
      json: {
        id: 'msg_e2e',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: JSON.stringify(reply) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    })
  })
  return { requests }
}

/** Stub OpenAI's Chat Completions API. */
export async function stubOpenAI(page: Page) {
  const requests: { model: string; hasPdf: boolean }[] = []
  await page.route('https://api.openai.com/**', async (route: Route) => {
    const request = route.request()
    if (request.headers()['authorization'] !== `Bearer ${KEY}`) {
      return route.fulfill({ status: 401, json: { error: { message: 'Incorrect API key' } } })
    }
    if (request.method() === 'GET') {
      return route.fulfill({ json: { data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] } })
    }
    const body = request.postDataJSON()
    const [system, user] = body.messages
    const parts: { type: string; text?: string }[] =
      typeof user.content === 'string' ? [{ type: 'text', text: user.content }] : user.content
    const prompt = parts.find((b) => b.type === 'text')?.text ?? ''
    requests.push({ model: body.model, hasPdf: parts.some((b) => b.type === 'file') })
    const reply = answer(system.content, prompt) ?? EXTRACTION
    return route.fulfill({
      json: {
        choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      },
    })
  })
  return { requests }
}

/** Stub Gemini. Returns a setter to switch behaviour mid-test. */
export async function stubGemini(page: Page) {
  let mode: Mode = 'ok'
  let extractions = 0
  const pdfExtractions: string[] = []
  await page.route('https://generativelanguage.googleapis.com/**', async (route: Route) => {
    const request = route.request()
    if (request.headers()['x-goog-api-key'] !== KEY) {
      return route.fulfill({ status: 400, json: { error: { message: 'API key not valid.' } } })
    }
    if (request.method() === 'GET') {
      return route.fulfill({
        json: {
          models: [
            {
              name: 'models/gemini-2.5-flash',
              displayName: 'Gemini 2.5 Flash',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        },
      })
    }
    const body = request.postDataJSON()
    const system: string = body.systemInstruction?.parts?.[0]?.text ?? ''
    const prompt: string = body.contents[0].parts[0].text

    if (request.url().includes(':streamGenerateContent')) {
      if (mode === 'chat-down') {
        return route.fulfill({ status: 503, json: { error: { message: 'Model overloaded' } } })
      }
      const id = system.match(/<paper id="P(\d+)">/)?.[1]
      const event = (text: string) =>
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}

`
      const turns = body.contents.length
      const excerpts = [...system.matchAll(/<excerpt paper="P\d+">/g)].length
      return route.fulfill({
        contentType: 'text/event-stream',
        body:
          event('Most papers use ') +
          event(`GraphGPS [P${id}]. `) +
          event(`(turns: ${turns})`) +
          event(` (excerpts: ${excerpts})`),
      })
    }

    const reply = answer(system, prompt, mode)
    if (reply) return route.fulfill({ json: geminiResponse(reply) })
    extractions += 1
    const inline = body.contents[0].parts.find((p: { inlineData?: unknown }) => p.inlineData)
    if (inline) pdfExtractions.push(inline.inlineData.mimeType)
    if (mode === 'rate-limited' && extractions > 1) {
      return route.fulfill({
        status: 429,
        json: { error: { code: 429, details: [{ retryDelay: '0s' }] } },
      })
    }
    return route.fulfill({ json: geminiResponse(EXTRACTION) })
  })
  return { setMode: (m: Mode) => (mode = m), pdfExtractions }
}

export async function signUpWithKey(page: Page, provider?: string) {
  const n = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  await page.goto('/register')
  await page.getByLabel('Username').fill(`run_${n}`)
  await page.getByLabel('Email address').fill(`run_${n}@example.com`)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()
  if (provider) await page.getByLabel('Provider').selectOption({ label: provider })
  await page.getByLabel('API key').fill(KEY)
  await page.getByRole('button', { name: /Test & save key/ }).click()
  await expect(page.getByText('Key works').first()).toBeVisible()
}

export async function newProject(page: Page, topic: string) {
  await page.goto('/project/new')
  await page.getByLabel(/Research topic/).fill(topic)
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page).toHaveURL(/\/project\/\d+$/)
}
