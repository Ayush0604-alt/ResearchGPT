import { expect, test } from '@playwright/test'
import { KEY, newProject, signUpWithKey, stubAnthropic, stubGemini, stubOpenAI } from './helpers'

// A full research run in the browser: the server collects papers (search is
// stubbed on the e2e server), then this page analyses them with the user's
// key against stubbed provider APIs (Gemini, Anthropic, OpenAI).

// These journeys wait on a server job plus several model calls.
test.describe.configure({ timeout: 60_000 })

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
  await page
    .getByRole('button', { name: /Graph Transformers for Molecular Property Prediction$/ })
    .click()
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
  await page
    .getByRole('button', { name: /Graph Transformers for Molecular Property Prediction$/ })
    .click()
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

test('papers can be added, uploaded and removed, then the review updated', async ({ page }) => {
  await stubGemini(page)
  await signUpWithKey(page)
  await newProject(page, 'manual papers')
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('3 papers · 2 with full text')).toBeVisible()

  // Remove one paper: the saved review no longer covers the papers.
  page.on('dialog', (d) => d.accept())
  await page.getByRole('button', { name: /^Remove "Graph Transformers/ }).click()
  await expect(page.getByText(/^2 papers ·/)).toBeVisible()
  await expect(page.getByText('Papers ready — analysis not finished')).toBeVisible()

  // Add one by DOI, and one from a PDF on disk.
  await page.getByLabel('Add a paper by DOI or arXiv id').fill('10.1000/manual')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(
    page.getByRole('button', { name: /Manually added paper \(10\.1000\/manual\)$/ }),
  ).toBeVisible()
  await page.getByLabel('Upload a paper PDF').setInputFiles('e2e/fixtures/uploaded-paper.pdf')
  await expect(page.getByRole('button', { name: /uploaded-paper$/ })).toBeVisible()
  await expect(page.getByText(/^4 papers ·/)).toBeVisible()

  // Only the two new papers are read; the review is rewritten over all four.
  await page.getByRole('button', { name: 'Continue analysis' }).click()
  await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Analysed')).toHaveCount(4)
  await expect(page.getByText('Completed')).toBeVisible()
})
