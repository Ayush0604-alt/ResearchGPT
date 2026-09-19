import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewsAPI } from './api'
import { taskPollInterval, useReview } from './queries'
import type { TaskStatus } from './types'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  reviewsAPI: { get: vi.fn(), markdown: vi.fn() },
}))

const task = (status: TaskStatus['status']): TaskStatus => ({
  task_id: 't',
  status,
  progress: 0,
  current_agent: null,
  error: null,
})

describe('taskPollInterval', () => {
  it('keeps polling while a run is in progress', () => {
    expect(taskPollInterval({ data: task('running'), error: null })).toBe(2500)
    expect(taskPollInterval({ data: undefined, error: null })).toBe(2500)
  })

  it('stops on completion or failure', () => {
    expect(taskPollInterval({ data: task('completed'), error: null })).toBe(false)
    expect(taskPollInterval({ data: task('failed'), error: null })).toBe(false)
  })

  it('stops when the task is gone (e.g. a 404 after a restart)', () => {
    expect(taskPollInterval({ data: task('running'), error: new Error('404') })).toBe(false)
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
