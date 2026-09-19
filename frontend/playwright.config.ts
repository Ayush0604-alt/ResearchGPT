import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// End-to-end tests: real browser, real API, throwaway database.
// Needs the test Postgres: docker compose -f ../docker-compose.test.yml up -d
const API_PORT = 8001
const WEB_PORT = 5174
// Absolute, quoted paths: Windows' cmd can't run "../x/python.exe".
const backendDir = path.resolve(process.cwd(), '../backend')
const python =
  process.env.E2E_PYTHON ??
  (process.platform === 'win32' ? path.join(backendDir, 'venv', 'Scripts', 'python.exe') : 'python')
const e2eServer = path.join(backendDir, 'scripts', 'e2e_server.py')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    // Local runs reuse installed Chrome; CI installs Playwright's Chromium.
    ...devices['Desktop Chrome'],
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `"${python}" "${e2eServer}" --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
})
