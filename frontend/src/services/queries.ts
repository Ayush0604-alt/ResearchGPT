// TanStack Query hooks for all server state. Pages use these instead of
// fetching in useEffect or polling with setInterval.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { chatAPI, httpStatus, papersAPI, projectsAPI, reviewsAPI } from './api'
import type { LiteratureReview, Project } from './types'

export const keys = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  papers: (id: string) => ['papers', id] as const,
  review: (id: string) => ['review', id] as const,
  chat: (id: string) => ['chat', id] as const,
  summaries: (id: string) => ['summaries', id] as const,
  findings: (id: string) => ['findings', id] as const,
}

const POLL_MS = 2000

/** Poll a project while the server is collecting its papers; otherwise don't. */
export function projectPollInterval(project: Project | undefined): number | false {
  return project?.status === 'collecting' ? POLL_MS : false
}

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
    // Pauses while the tab is hidden (refetchIntervalInBackground is false).
    refetchInterval: (query) => projectPollInterval(query.state.data),
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

export function useSummaries(id: string) {
  return useQuery({
    queryKey: keys.summaries(id),
    queryFn: async () => (await papersAPI.summaries(id)).data,
  })
}

export function useFindings(id: string) {
  return useQuery({
    queryKey: keys.findings(id),
    queryFn: async () => (await papersAPI.findings(id)).data,
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

/** Refresh everything a run changes. */
export function invalidateProjectResults(qc: ReturnType<typeof useQueryClient>, id: string) {
  return Promise.all(
    [
      keys.project(id),
      keys.papers(id),
      keys.review(id),
      keys.summaries(id),
      keys.findings(id),
      keys.projects,
    ].map((queryKey) => qc.invalidateQueries({ queryKey })),
  )
}
