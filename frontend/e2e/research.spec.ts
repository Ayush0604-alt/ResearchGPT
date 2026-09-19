import { expect, test, type Page, type Route } from '@playwright/test'

// A full research run in the browser: the server collects papers (search is
// stubbed on the e2e server), then this page analyses them with the user's
// key against a stubbed Gemini API.

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

type Mode = 'ok' | 'rate-limited'

function geminiResponse(body: unknown) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
  }
}

/** Stub Gemini. Returns a setter to switch behaviour mid-test. */
async function stubGemini(page: Page) {
  let mode: Mode = 'ok'
  let extractions = 0
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

    if (system.includes('literature reviews')) {
      const ids = [...prompt.matchAll(/<paper id="P(\d+)">/g)].map((m) => m[1])
      return route.fulfill({
        json: geminiResponse({
          introduction: `Graph learning is moving fast [P${ids[0]}]. One claim is invented [P999999].`,
          body: `Transformers [P${ids[0]}] and message passing [P${ids[1]}] are compared.`,
          comparison: `| Paper | Approach |\n|---|---|\n| [P${ids[0]}] | Transformer |`,
          trends: 'Attention everywhere.',
          gaps: 'Scalability to large graphs.',
          discussion: 'Evidence is mixed.',
          conclusion: 'Promising but costly.',
        }),
      })
    }
    extractions += 1
    if (mode === 'rate-limited' && extractions > 1) {
      return route.fulfill({
        status: 429,
        json: { error: { code: 429, details: [{ retryDelay: '0s' }] } },
      })
    }
    return route.fulfill({ json: geminiResponse(EXTRACTION) })
  })
  return { setMode: (m: Mode) => (mode = m) }
}

async function signUpWithKey(page: Page) {
  const n = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  await page.goto('/register')
  await page.getByLabel('Username').fill(`run_${n}`)
  await page.getByLabel('Email address').fill(`run_${n}@example.com`)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()
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

  // The review keeps real citations and drops the invented one.
  await page.getByRole('link', { name: 'Review' }).click()
  await expect(page.getByText(/Graph learning is moving fast \[P\d+\]/)).toBeVisible()
  await expect(page.getByText('P999999')).toHaveCount(0)
  await page.getByRole('button', { name: 'Comparison' }).click()
  await expect(page.getByRole('cell', { name: 'Transformer' })).toBeVisible()

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
