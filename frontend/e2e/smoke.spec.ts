import { expect, test, type Page } from '@playwright/test'

// Real browser + real API + throwaway DB. No LLM key is configured, so
// anything that would call Gemini must fail cleanly.

let counter = 0
function uniqueUser() {
  const n = `${Date.now()}${counter++}`
  return { username: `e2e_${n}`, email: `e2e_${n}@example.com`, password: 'correct-horse-battery' }
}

async function register(page: Page, user = uniqueUser()) {
  await page.goto('/register')
  await page.getByLabel('Username').fill(user.username)
  await page.getByLabel('Email address').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  // New users are sent to add their API key first.
  await expect(page).toHaveURL(/\/settings\?welcome=1$/)
  return user
}

async function createProject(page: Page, topic: string) {
  await page.goto('/project/new')
  await page.getByLabel(/Research topic/).fill(topic)
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page).toHaveURL(/\/project\/\d+$/)
}

test('register, create a project with only a topic, see it on the dashboard', async ({ page }) => {
  await register(page)
  await page.goto('/dashboard')
  await expect(page.getByText('No projects yet').first()).toBeVisible()

  // Regression: optional fields left blank used to be rejected with a 422.
  await createProject(page, 'graph neural networks')
  await expect(page.getByRole('heading', { name: 'Research: graph neural networks' })).toBeVisible()
  await expect(page.getByText('Ready to run')).toBeVisible()

  await page.goto('/dashboard')
  await expect(page.getByText('Research: graph neural networks')).toBeVisible()
})

test('validation errors are shown as readable messages', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Username').fill('bad name!') // fails the API pattern
  await page.getByLabel('Username').evaluate((el) => el.removeAttribute('pattern'))
  await page.getByLabel('Email address').fill(`${uniqueUser().email}`)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(/username: String should match pattern/)).toBeVisible()
})

test('logging in again restores the session', async ({ page, context }) => {
  const user = await register(page)
  await context.clearCookies()
  await page.evaluate(() => localStorage.clear())
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel('Email address').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
})

test('review page explains when there is no review yet', async ({ page }) => {
  await register(page)
  await createProject(page, 'diffusion models')
  await page.goto(page.url() + '/review')
  await expect(page.getByText('No literature review yet')).toBeVisible()
})

test('deleting a project removes it from the dashboard', async ({ page }) => {
  await register(page)
  await createProject(page, 'vision transformers')
  await page.goto('/dashboard')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /Delete project/ }).click()
  await expect(page.getByText('Project deleted')).toBeVisible()
  await expect(page.getByText('No projects yet').first()).toBeVisible()
})

test('sessions use httpOnly cookies, renew silently, and end on sign-out', async ({
  page,
  context,
}) => {
  await register(page)

  const cookies = await context.cookies()
  const access = cookies.find((c) => c.name === 'rg_access')
  const refresh = cookies.find((c) => c.name === 'rg_refresh')
  expect(access?.httpOnly && refresh?.httpOnly).toBe(true)
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }))
  expect(stored).not.toContain(access!.value)
  expect(stored).not.toContain('access_token')

  // The access cookie expires every 15 minutes; the refresh cookie renews it.
  await context.clearCookies({ name: 'rg_access' })
  await page.goto('/dashboard')
  await expect(page.getByText('No projects yet').first()).toBeVisible()
  expect((await context.cookies()).some((c) => c.name === 'rg_access')).toBe(true)

  // Signing out revokes the session: the old refresh cookie is useless.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await context.addCookies([{ ...refresh!, value: refresh!.value }])
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
    return r.status
  })
  expect(status).toBe(401)
})

test('the privacy page is public and explains where the key goes', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'How your key and data are used' }).click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page.getByText(/never sent to ResearchGPT's servers/i)).toBeVisible()
})

test('deleting the account needs the password and signs the user out', async ({ page }) => {
  const user = await register(page)
  await page.goto('/settings')
  page.on('dialog', (d) => d.accept())

  await page.getByLabel('Password to confirm deletion').fill('wrong-password')
  await page.getByRole('button', { name: 'Delete account' }).click()
  await expect(page.getByText('Password is incorrect')).toBeVisible()

  await page.getByLabel('Password to confirm deletion').fill(user.password)
  await page.getByRole('button', { name: 'Delete account' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email address').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Invalid credentials')).toBeVisible()
})
