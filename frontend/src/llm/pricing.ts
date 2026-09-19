// A rough cost estimate shown before a run. Prices are list prices in USD per
// million tokens as of September 2026. They change, so the user can override
// any model's price in Settings.

export interface Price {
  input: number
  output: number
}

export const DEFAULT_PRICES: Record<string, Price> = {
  // Google
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  // Anthropic
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-fable-5-1': { input: 10, output: 50 },
  // OpenAI
  'gpt-5-nano': { input: 0.05, output: 0.4 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
}

/**
 * The price for a model: the user's override, else the list price of the
 * longest known prefix (so "gemini-2.5-flash-preview-09" uses gemini-2.5-flash),
 * else null when unknown.
 */
export function priceFor(model: string, overrides: Record<string, Price> = {}): Price | null {
  if (overrides[model]) return overrides[model]
  const known = Object.keys(DEFAULT_PRICES)
    .filter((id) => model === id || model.startsWith(`${id}-`))
    .sort((a, b) => b.length - a.length)[0]
  return known ? DEFAULT_PRICES[known] : null
}

export interface RunEstimate {
  /** USD, or null when a model's price is unknown. */
  usd: number | null
  inputTokens: number
  outputTokens: number
}

interface RunShape {
  papers: number
  extractModel: string
  synthModel: string
  sendPdfs: boolean
  /** Search candidates screened for relevance. */
  candidates?: number
}

/**
 * Tokens a typical run uses, by stage. Deliberately on the high side: a PDF
 * or a long paper costs more than an abstract-only one.
 */
export function estimateRun(run: RunShape, overrides: Record<string, Price> = {}): RunEstimate {
  const { papers, candidates = 60 } = run
  const perPaperIn = run.sendPdfs ? 25_000 : 12_000
  const fast = {
    // query planning + relevance screening + per-paper extraction + citation check
    input: 500 + candidates * 250 + papers * perPaperIn + 4 * (3_000 + papers * 800),
    output: 200 + candidates * 40 + papers * 1_200 + 4 * 800,
  }
  const strong = { input: 2_000 + papers * 1_000, output: 6_000 }

  const fastPrice = priceFor(run.extractModel, overrides)
  const strongPrice = priceFor(run.synthModel, overrides)
  const cost = (tokens: { input: number; output: number }, price: Price) =>
    (tokens.input * price.input + tokens.output * price.output) / 1_000_000

  return {
    usd: fastPrice && strongPrice ? cost(fast, fastPrice) + cost(strong, strongPrice) : null,
    inputTokens: fast.input + strong.input,
    outputTokens: fast.output + strong.output,
  }
}

export function formatUsd(usd: number): string {
  if (usd < 0.01) return '< $0.01'
  return `$${usd < 1 ? usd.toFixed(2) : usd.toFixed(1)}`
}
