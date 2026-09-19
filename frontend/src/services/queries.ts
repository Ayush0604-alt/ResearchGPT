// TanStack Query hooks for all server state. Pages use these instead of
// fetching in useEffect or polling with setInterval.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsAPI, chatAPI, httpStatus, papersAPI, projectsAPI, reviewsAPI } from './api'
import type { LiteratureReview, TaskStatus } from './types'

export const keys = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  papers: (id: string) => ['papers', id] as const,
  review: (id: string) => ['review', id] as const,
  chat: (id: string) => ['chat', id] as const,
  task: (taskId: string) => ['task', taskId] as const,
}

const POLL_MS = 2500
const TERMINAL: TaskStatus['status'][] = ['completed', 'failed']

/** Don't retry "not found"; retry other failures twice. */
function retryUnlessNotFound(failureCount: number, err: unknown) {
  return httpStatus(err) !== 404 && failureCount < 2
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: async () => (await projectsAPI.list()).data.projects,
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: keys.project(id),
    queryFn: async () => (await projectsAPI.get(id)).data,
    retry: retryUnlessNotFound,
  })
}

export function usePapers(id: string) {
  return useQuery({
    queryKey: keys.papers(id),
    queryFn: async () => (await papersAPI.list(id)).data,
  })
}

/** Resolves to null when the project has no review yet (404). */
export function useReview(id: string) {
  return useQuery<LiteratureReview | null>({
    queryKey: keys.review(id),
    queryFn: async () => {
      try {
        return (await reviewsAPI.get(id)).data
      } catch (err) {
        if (httpStatus(err) === 404) return null
        throw err
      }
    },
  })
}

export function useChatHistory(id: string) {
  return useQuery({
    queryKey: keys.chat(id),
    queryFn: async () => (await chatAPI.history(id)).data.messages,
  })
}

/** Next poll delay for a task query, or false to stop polling. */
export function taskPollInterval(state: { data?: TaskStatus; error: unknown }): number | false {
  if (state.error) return false // e.g. 404: the task is gone
  const status = state.data?.status
  return status && TERMINAL.includes(status) ? false : POLL_MS
}

/**
 * Poll a pipeline task until it finishes. Polling stops on a terminal status
 * or an error (a 404 means the task is gone, e.g. the server restarted), and
 * pauses while the tab is hidden.
 */
export function useTaskStatus(taskId: string | null) {
  return useQuery({
    queryKey: keys.task(taskId ?? ''),
    queryFn: async () => (await agentsAPI.status(taskId!)).data,
    enabled: Boolean(taskId),
    retry: retryUnlessNotFound,
    refetchInterval: (query) => taskPollInterval(query.state),
    refetchIntervalInBackground: false,
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: { topic: string; title?: string; description?: string }) =>
      (await projectsAPI.create(data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects }),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => projectsAPI.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects }),
  })
}

export function useRunPipeline(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => (await agentsAPI.run({ project_id: Number(id), max_papers: 10 })).data,
    onSuccess: (task) => {
      qc.setQueryData(keys.task(task.task_id), task)
      return qc.invalidateQueries({ queryKey: keys.project(id) })
    },
  })
}

export function useAskQuestion(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (question: string) =>
      (await chatAPI.query({ project_id: Number(id), question })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.chat(id) }),
  })
}

export function useClearChat(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => chatAPI.clear(id),
    onSuccess: () => qc.setQueryData(keys.chat(id), []),
  })
}

/** Refresh everything a finished run changes. */
export function invalidateProjectResults(qc: ReturnType<typeof useQueryClient>, id: string) {
  return Promise.all(
    [keys.project(id), keys.papers(id), keys.review(id), keys.projects].map((queryKey) =>
      qc.invalidateQueries({ queryKey }),
    ),
  )
}
