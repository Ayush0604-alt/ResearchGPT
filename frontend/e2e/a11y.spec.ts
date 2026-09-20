import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { newProject, signUpWithKey, stubGemini } from './helpers'

// Automated accessibility checks (WCAG 2.1 A and AA rules in axe-core) on
// every page, in the states users actually see them.

test.describe.configure({ timeout: 90_000 })

// Measure the settled page, not a frame of the fade-in (which the app also
// skips for users who ask for reduced motion).
test.use({ contextOptions: { reducedMotion: 'reduce' } })

async function expectNoViolations(page: Page, where: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const summary = violations.map(
    (v) =>
      `${where}: [${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`,
  )
  expect(summary, summary.join('\n')).toEqual([])
}

test('public pages', async ({ page }) => {
  for (const path of ['/login', '/register', '/privacy']) {
    await page.goto(path)
    await expect(page.locator('h1, h2').first()).toBeVisible()
    await expectNoViolations(page, path)
  }
})

test('pages of a finished project', async ({ page }) => {
  await stubGemini(page)
  await signUpWithKey(page)
  await expectNoViolations(page, 'settings')

  await page.goto('/project/new')
  await page.getByText('Search filters').click()
  await expectNoViolations(page, 'new project')

  await newProject(page, 'accessible graphs')
  await expectNoViolations(page, 'project (ready)')
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })
  await page
    .getByRole('button', { name: /Graph Transformers for Molecular Property Prediction$/ })
    .click()
  await expectNoViolations(page, 'project (done)')

  await page.goto('/dashboard')
  await expect(page.getByRole('table')).toBeVisible()
  await expectNoViolations(page, 'dashboard')

  await page.goBack()
  await page.getByRole('link', { name: 'Review' }).click()
  for (const tab of ['Introduction', 'Comparison', 'References', /Citation check/]) {
    await page.getByRole('tab', { name: tab }).click()
    await expectNoViolations(page, `review: ${tab}`)
  }

  await page.goBack()
  await page.getByRole('link', { name: 'Chat' }).click()
  await page.getByLabel('Your question').fill('Which models are used?')
  await page.getByRole('button', { name: 'Send question' }).click()
  await expect(page.getByText(/Most papers use/)).toBeVisible()
  await expectNoViolations(page, 'chat')
})

test('the review tabs work with the keyboard', async ({ page }) => {
  await stubGemini(page)
  await signUpWithKey(page)
  await newProject(page, 'keyboard graphs')
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByText(/Review ready/)).toBeVisible({ timeout: 30_000 })
  await page.getByRole('link', { name: 'Review' }).click()

  const first = page.getByRole('tab', { name: 'Introduction' })
  await first.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Survey' })).toBeFocused()
  await expect(page.getByRole('tab', { name: 'Survey' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: /Citation check/ })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(first).toBeFocused()
  // Only the selected tab is in the tab order.
  await expect(page.getByRole('tab', { name: 'Survey' })).toHaveAttribute('tabindex', '-1')
})
