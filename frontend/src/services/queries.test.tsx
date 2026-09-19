import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewsAPI } from './api'
import { projectPollInterval, useReview } from './queries'
import type { Project } from './types'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  reviewsAPI: { get: vi.fn(), markdown: vi.fn() },
}))

const project = (status: Project['status']) => ({ status }) as Project

describe('projectPollInterval', () => {
  it('polls while the server is collecting papers', () => {
    expect(projectPollInterval(project('collecting'))).toBe(2000)
  })

  it('does not poll in any other state', () => {
    for (const status of ['pending', 'collected', 'completed', 'failed'] as const) {
      expect(projectPollInterval(project(status))).toBe(false)
    }
    expect(projectPollInterval(undefined)).toBe(false)
  })
})

describe('useReview', () => {
  let client: QueryClient
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  // Braces matter: a function returned from beforeEach runs as a cleanup hook,
  // and mockReset() returns the mock itself.
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.mocked(reviewsAPI.get).mockReset()
  })

  it('resolves to null when there is no review yet', async () => {
    vi.mocked(reviewsAPI.get).mockRejectedValue({ response: { status: 404 } })
    const { result } = renderHook(() => useReview('1'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeNull()
  })

  it('surfaces other errors', async () => {
    vi.mocked(reviewsAPI.get).mockRejectedValue({ response: { status: 500 } })
    const { result } = renderHook(() => useReview('1'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
