import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { generateJSON } from '../generate'
import { gemini } from './gemini'

// Opt-in check against the real API (costs a few hundred tokens):
//   GEMINI_LIVE_KEY=... GEMINI_LIVE_MODEL=gemini-2.5-flash npx vitest run gemini.live
const key = process.env.GEMINI_LIVE_KEY
const model = process.env.GEMINI_LIVE_MODEL ?? 'gemini-2.5-flash'

describe.skipIf(!key)('Gemini live API', () => {
  it('lists models, returns schema-valid JSON and streams', { timeout: 60_000 }, async () => {
    const models = await gemini.listModels(key!)
    expect(models.length).toBeGreaterThan(0)

    const Schema = z.object({
      paper: z.string().describe('A made-up paper title'),
      keywords: z.array(z.string()).min(1).max(3),
      year: z.number().nullable(),
    })
    const { data } = await generateJSON(gemini, {
      apiKey: key!,
      model,
      schema: Schema,
      messages: [{ role: 'user', text: 'Invent one machine-learning paper.' }],
      maxOutputTokens: 1024,
    })
    expect(Schema.safeParse(data).success).toBe(true)

    let streamed = ''
    for await (const t of gemini.stream({
      apiKey: key!,
      model,
      messages: [{ role: 'user', text: 'Say hello in three words.' }],
      maxOutputTokens: 256,
    })) {
      streamed += t
    }
    expect(streamed.trim().length).toBeGreaterThan(0)
  })
})
