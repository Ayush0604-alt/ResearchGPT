import { expect, test, type Page, type Route } from '@playwright/test'

// A full research run in the browser: the server collects papers (search is
// stubbed on the e2e server), then this page analyses them with the user's
// key against stubbed provider APIs (Gemini, Anthropic, OpenAI).

const KEY = 'AIza-e2e-research-key-0123456789'

// These journeys wait on a server job plus several model calls.
test.describe.configure({ timeout: 60_000 })

const EXTRACTION = {
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

type Mode = 'ok' | 'rate-limited' | 'chat-down' | 'one-irrelevant'

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
async function stubAnthropic(page: Page) {
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
async function stubOpenAI(page: Page) {
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
async function stubGemini(page: Page) {
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

async function signUpWithKey(page: Page, provider?: string) {
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

async function newProject(page: Page, topic: string) {
  await page.goto('/project/new')
  await page.getByLabel(/Research topic/).fill(topic)
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page).toHaveURL(/\/project\/\d+$/)
}

test('a full run: collect on the server, analyse in the browser, read the review', async ({
  page,
}) => {
  const apiRequestsWithKey: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/') && JSON.stringify([r.headers(), r.postData()]).includes(KEY)) {
      apiRequestsWithKey.push(r.url())
    }
  })
  await stubGemini(page)
  await signUpWithKey(page)
  await newProject(page, 'graph transformers')

  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByText(/Review ready.*1 invalid citation\(s\) removed/)).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Completed')).toBeVisible()
  await expect(page.getByText('3 papers · 2 with full text')).toBeVisible()
  await expect(page.getByText('Analysed')).toHaveCount(3)

  // Per-paper findings are shown on the project page.
  await page.getByRole('button', { name: /Graph Transformers for Molecular/ }).click()
  await expect(page.getByText('ogbg-molhiv')).toBeVisible()

  // The review keeps real citations (as numbered links) and drops the invented one.
  await page.getByRole('link', { name: 'Review' }).click()
  const panel = page.getByRole('tabpanel')
  await expect(panel.getByText(/Graph learning is moving fast/)).toBeVisible()
  await expect(panel.getByRole('link', { name: '[1]' })).toBeVisible()
  await expect(page.getByText('P999999')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Comparison' }).click()
  await expect(page.getByRole('cell', { name: 'Transformer' })).toBeVisible()

  // How it was made: every model call was metered (the stub reports 150 tokens a call).
  await expect(page.getByTestId('run-info')).toContainText(/gemini-2\.5-\w+ · [\d,]+ tokens/)

  // References are numbered in citation order.
  await page.getByRole('tab', { name: 'References' }).click()
  await expect(panel.getByRole('listitem')).toHaveCount(3)

  // The flagged claim is surfaced first in the citation check.
  await expect(page.getByText(/1 of \d+ checked claims aren't fully supported/)).toBeVisible()
  await page.getByRole('tab', { name: 'Citation check (1)' }).click()
  await expect(panel.getByText('Not supported')).toBeVisible()
  await expect(panel.getByText('The papers do not say this.')).toBeVisible()

  // Exports are generated in the browser.
  const bib = page.waitForEvent('download')
  await page.getByRole('button', { name: 'BibTeX' }).click()
  const file = await bib
  expect(file.suggestedFilename()).toBe('graph-transformers.bib')
  const text = await (await file.createReadStream()).toArray()
  expect(Buffer.concat(text).toString()).toMatch(/^@article\{/)

  expect(apiRequestsWithKey).toEqual([])
})

test('a rate-limited run keeps its progress and can be continued', async ({ page }) => {
  const gemini = await stubGemini(page)
  await signUpWithKey(page)
  await newProject(page, 'positional encodings')

  gemini.setMode('rate-limited')
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByText(/rate limit.*Continue analysis/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Papers ready — analysis not finished')).toBeVisible()
  await expect(page.getByText('Analysed')).toHaveCount(1) // the paper done before the 429

  gemini.setMode('ok')
  await page.getByRole('button', { name: 'Continue analysis' }).click()
  await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Completed')).toBeVisible()
  await expect(page.getByText('Analysed')).toHaveCount(3)
})

test('without a key, the project asks for one instead of running', async ({ page }) => {
  const n = `${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Username').fill(`nokey_${n}`)
  await page.getByLabel('Email address').fill(`nokey_${n}@example.com`)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/settings\?welcome=1$/)
  await newProject(page, 'anything')

  await expect(page.getByRole('button', { name: 'Run analysis' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Add your API key to run' }).click()
  await expect(page).toHaveURL(/\/settings$/)
})

test('chat answers stream in, cite papers, and are saved with their sources', async ({ page }) => {
  await stubGemini(page)
  await signUpWithKey(page)
  await newProject(page, 'graph chat')
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })

  await page.getByRole('link', { name: 'Chat' }).click()
  await page.getByLabel('Your question').fill('Which models are used?')
  await page.getByRole('button', { name: 'Send question' }).click()
  await expect(page.getByText(/Most papers use GraphGPS \[P\d+\]/)).toBeVisible()
  const sources = page.getByRole('list', { name: 'Sources' })
  await expect(sources.getByRole('link')).toHaveCount(1)

  // A follow-up sends the earlier turns too (2 history messages + the question).
  await page.getByLabel('Your question').fill('And the second one?')
  await page.getByRole('button', { name: 'Send question' }).click()
  await expect(page.getByText('(turns: 3)')).toBeVisible()

  await page.reload()
  await expect(page.getByText('Which models are used?')).toBeVisible()
  await expect(page.getByText('(turns: 3)')).toBeVisible()
})

test('a failed chat answer keeps the question and stores nothing', async ({ page }) => {
  const gemini = await stubGemini(page)
  await signUpWithKey(page)
  await newProject(page, 'graph chat failure')
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('link', { name: 'Chat' }).click()

  gemini.setMode('chat-down')
  const input = page.getByLabel('Your question')
  await input.fill('What datasets are used?')
  await page.getByRole('button', { name: 'Send question' }).click()
  await expect(page.getByText('Model overloaded')).toBeVisible()
  await expect(input).toHaveValue('What datasets are used?')

  await page.reload()
  await expect(page.getByText('Ask anything about your papers')).toBeVisible()
})

test('screening keeps only relevant papers and shows why', async ({ page }) => {
  const gemini = await stubGemini(page)
  await signUpWithKey(page)
  await newProject(page, 'graph screening')

  gemini.setMode('one-irrelevant')
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })

  // 3 candidates were found; the one rated 1/10 was not collected.
  await expect(page.getByText(/^2 papers ·/)).toBeVisible()
  await expect(page.getByText('Relevance 8/10')).toHaveCount(2)
  await page.getByRole('button', { name: /Graph Transformers for Molecular/ }).click()
  await expect(page.getByText('Directly on topic')).toBeVisible()
})

test('search filters are saved with the project', async ({ page }) => {
  await stubGemini(page)
  await signUpWithKey(page)
  await page.goto('/project/new')
  await page.getByLabel(/Research topic/).fill('filtered topic')
  await page.getByText('Search filters').click()
  await page.getByLabel('From year').fill('2020')
  await page.getByLabel('arXiv').uncheck()
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/projects') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Create project' }).click()
  const body = await (await created).json()
  expect(body.year_from).toBe(2020)
  expect(body.sources).toEqual(['semantic_scholar', 'openalex', 'europepmc'])
})

test('following citations adds papers the best matches cite', async ({ page }) => {
  await stubGemini(page)
  await signUpWithKey(page)
  await page.goto('/project/new')
  await page.getByLabel(/Research topic/).fill('graph attention')
  await page.getByText('Search filters').click()
  await page.getByLabel(/Also follow citations/).check()
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page).toHaveURL(/\/project\/\d+$/)

  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/^4 papers ·/)).toBeVisible()
  await expect(page.getByText('A Foundational Paper on Graph Attention')).toBeVisible()
})

test('papers with a PDF are sent to the model as the PDF itself', async ({ page }) => {
  const gemini = await stubGemini(page)
  await signUpWithKey(page)
  await newProject(page, 'pdf reading')
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })
  // Two of the three stub papers have a PDF link.
  expect(gemini.pdfExtractions).toEqual(['application/pdf', 'application/pdf'])
})

for (const [label, stub, models] of [
  ['Anthropic Claude', stubAnthropic, ['claude-haiku-4-5', 'claude-opus-5']],
  ['OpenAI', stubOpenAI, ['gpt-5-mini', 'gpt-5']],
] as const) {
  test(`a full run works with ${label}`, async ({ page }) => {
    const apiRequestsWithKey: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/') && JSON.stringify([r.headers(), r.postData()]).includes(KEY)) {
        apiRequestsWithKey.push(r.url())
      }
    })
    const provider = await stub(page)
    await signUpWithKey(page, label)
    // Model tiers: a fast model reads papers, a strong one writes the review.
    await expect(page.getByLabel('Model for reading each paper')).toHaveValue(models[0])
    await expect(page.getByLabel('Model for the review and chat')).toHaveValue(models[1])

    await newProject(page, `graph ${label}`)
    await expect(page.getByTestId('run-cost')).toContainText(/\$\d/)
    await page.getByRole('button', { name: 'Run analysis' }).click()
    await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Analysed')).toHaveCount(3)

    const used = new Set(provider.requests.map((r) => r.model))
    expect([...used].sort()).toEqual([...models].sort())
    expect(provider.requests.filter((r) => r.hasPdf)).toHaveLength(2) // the stub papers with a PDF
    expect(apiRequestsWithKey).toEqual([])

    await page.getByRole('link', { name: 'Review' }).click()
    await expect(
      page.getByRole('tabpanel').getByText(/Graph learning is moving fast/),
    ).toBeVisible()
    await expect(page.getByTestId('run-info')).toContainText(models[1])
  })
}

test('chat quotes passages of the full texts that match the question', async ({ page }) => {
  await stubGemini(page)
  await signUpWithKey(page)
  await newProject(page, 'graph passages')
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })

  await page.getByRole('link', { name: 'Chat' }).click()
  // The stub papers' text reads "Full text of <url>." many times over.
  await page.getByLabel('Your question').fill('What does the full text say?')
  await page.getByRole('button', { name: 'Send question' }).click()
  await expect(page.getByText(/\(excerpts: [1-9]\d*\)/)).toBeVisible()
})
