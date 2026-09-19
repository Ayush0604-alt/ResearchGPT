import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getProvider, InvalidKeyError, LLMError, RateLimitError } from '../llm'
import { chatAPI, errorMessage, papersAPI } from '../services/api'
import { keys } from '../services/queries'
import type { ChatMessage } from '../services/types'
import { useLLMSettings } from '../store/llmSettings'
import { chatSystemPrompt, chatTurns, citedPaperIds } from './chat'

function chatErrorMessage(err: unknown): string {
  if (err instanceof InvalidKeyError) return 'Your API key was rejected. Update it in Settings.'
  if (err instanceof RateLimitError || err instanceof LLMError) return err.message
  return errorMessage(err, "Couldn't get an answer. Please try again.")
}

/**
 * Ask questions about a project's papers. The answer streams in from the
 * provider with the user's key; only a finished exchange is saved.
 */
export function useChat(projectId: string, topic: string) {
  const qc = useQueryClient()
  const [pending, setPending] = useState<string | null>(null)
  const [streamed, setStreamed] = useState('')
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  /** Resolves true when the answer was saved, false on failure or cancel. */
  async function ask(question: string): Promise<boolean> {
    const settings = useLLMSettings.getState()
    if (!settings.verified || !settings.apiKey) {
      toast.error('Add your API key in Settings to chat.')
      return false
    }
    const ctrl = new AbortController()
    controller.current = ctrl
    setPending(question)
    setStreamed('')
    try {
      const fetch = <T>(key: readonly unknown[], fn: () => Promise<T>) =>
        qc.ensureQueryData({ queryKey: key, queryFn: fn })
      const [papers, summaries, findings, history] = await Promise.all([
        fetch(keys.papers(projectId), async () => (await papersAPI.list(projectId)).data),
        fetch(keys.summaries(projectId), async () => (await papersAPI.summaries(projectId)).data),
        fetch(keys.findings(projectId), async () => (await papersAPI.findings(projectId)).data),
        fetch<ChatMessage[]>(
          keys.chat(projectId),
          async () => (await chatAPI.history(projectId)).data.messages,
        ),
      ])

      let answer = ''
      for await (const chunk of getProvider(settings.provider).stream({
        apiKey: settings.apiKey,
        model: settings.synthModel,
        system: chatSystemPrompt(
          topic,
          papers,
          new Map(summaries.map((s) => [s.paper_id, s])),
          new Map(findings.map((f) => [f.paper_id, f])),
        ),
        messages: chatTurns(history, question),
        maxOutputTokens: 2048,
        temperature: 0.3,
        signal: ctrl.signal,
      })) {
        answer += chunk
        setStreamed(answer)
      }
      if (!answer.trim()) throw new LLMError('The model returned an empty answer. Try again.')

      const cited = citedPaperIds(answer, new Set(papers.map((p) => p.id)))
      const { data } = await chatAPI.saveExchange(projectId, {
        question,
        answer,
        citations: cited.map((paper_id) => ({ paper_id })),
      })
      qc.setQueryData(keys.chat(projectId), data.messages)
      return true
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') toast.error(chatErrorMessage(err))
      return false
    } finally {
      if (controller.current === ctrl) controller.current = null
      setPending(null)
      setStreamed('')
    }
  }

  const stop = () => controller.current?.abort()

  return { ask, stop, pending, streamed, busy: pending !== null }
}
