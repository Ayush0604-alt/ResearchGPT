import { expect, test, type Page, type Request } from '@playwright/test'

// The user's key must only ever be sent to the LLM provider.
const KEY = 'AIza-e2e-fake-key-0123456789'
const GEMINI = 'https://generativelanguage.googleapis.com/**'

function stubGemini(page: Page) {
  return page.route(GEMINI, async (route) => {
    if (route.request().headers()['x-goog-api-key'] !== KEY) {
      return route.fulfill({
        status: 400,
        json: {
          error: { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] },
        },
      })
    }
    return route.fulfill({
      json: {
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      },
    })
  })
}

/** Collect every request to our own API that carries the key. */
function watchForKeyLeaks(page: Page) {
  const leaks: string[] = []
  page.on('request', (req: Request) => {
    if (!req.url().includes('/api/')) return
    const haystack = [req.url(), JSON.stringify(req.headers()), req.postData() ?? ''].join(' ')
    if (haystack.includes(KEY)) leaks.push(`${req.method()} ${req.url()}`)
  })
  return leaks
}

async function registerNewUser(page: Page) {
  const n = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  await page.goto('/register')
  await page.getByLabel('Username').fill(`byok_${n}`)
  await page.getByLabel('Email address').fill(`byok_${n}@example.com`)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/settings\?welcome=1$/)
}

async function saveKey(page: Page, key: string) {
  await page.getByLabel('API key').fill(key)
  await page.getByRole('button', { name: /Test & save key/ }).click()
}

test('new users add a key; it is tested, kept in this browser, and never sent to our API', async ({
  page,
}) => {
  const leaks = watchForKeyLeaks(page)
  await stubGemini(page)
  await registerNewUser(page)
  await expect(page.getByText('One more step')).toBeVisible()

  await saveKey(page, 'wrong-key')
  await expect(page.getByText(/That key was rejected/)).toBeVisible()

  await saveKey(page, KEY)
  await expect(page.getByText('Key works').first()).toBeVisible()
  await expect(page.getByLabel('Model for reading each paper')).toHaveValue('gemini-2.5-flash')

  // Survives a reload and lives under its own storage entry.
  await page.reload()
  await expect(page.getByLabel('API key')).toHaveValue(KEY)
  expect(await page.evaluate(() => localStorage.getItem('researchgpt-llm'))).toContain(KEY)
  expect(await page.evaluate(() => localStorage.getItem('researchgpt-auth'))).not.toContain(KEY)

  // Use the app, then sign out: the key stays unless the user clears it.
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate(() => localStorage.getItem('researchgpt-llm'))).toContain(KEY)

  expect(leaks).toEqual([])
})

test('clearing the key removes it from the browser', async ({ page }) => {
  await stubGemini(page)
  await registerNewUser(page)
  await saveKey(page, KEY)
  await expect(page.getByText('Key works').first()).toBeVisible()

  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Clear key' }).click()
  await expect(page.getByLabel('API key')).toHaveValue('')
  expect(await page.evaluate(() => localStorage.getItem('researchgpt-llm'))).not.toContain(KEY)
})
