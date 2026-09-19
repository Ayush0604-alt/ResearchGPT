# ResearchGPT — Design Improvements

> **Status (2026-09-19):** §0–§2 and §4–§6 are implemented. The browser holds the key, the server has no
> LLM code, and the app is secured and ready to deploy (see [DEPLOY.md](../DEPLOY.md)). The pipeline upgrades in §3
> (better sources, screening, full-PDF input, RAG) are Phases 5–7 of [fix-plan.md](fix-plan.md).

> **End goal:** a public deployment where each user enters **their own LLM API key**
> in the frontend. The key is kept **only in that browser's `localStorage`**. It is
> never stored in the database, in server memory, or in logs. The user then runs the app with it.
>
> This document redesigns the system around that goal and proposes stronger tools
> and techniques for better research output. It builds on
> [architecture.md](architecture.md) (the current state),
> [decisions.md](decisions.md) (why things are the way they are) and
> [improvements.md](improvements.md) (fixes to the current code).

---

## 0. What the goal requires

"The key lives only in the browser" leads to these hard requirements:

| # | Requirement | Current code violates it? |
|---|---|---|
| R1 | The server must never persist the key (no DB, disk, logs or error trackers) | no, but only because the key is a server env var today |
| R2 | The server should ideally never **see** the key | ❌ all LLM calls run on the server ([gemini_client.py](../backend/app/utils/gemini_client.py)) |
| R3 | A production server must not have its own `GEMINI_API_KEY` as a fallback, or public users will spend your quota | ❌ it is required in `config.py` |
| R4 | XSS must be treated as critical, because any injected script can read `localStorage` | ⚠️ `dangerouslySetInnerHTML` renderer, no CSP |
| R5 | The server still pays for search APIs, PDF downloads, CPU and the database, so those need abuse limits | ❌ no rate limiting |
| R6 | Hosting disks are usually temporary, so local PDF storage won't survive | ❌ PDFs are written to `./storage` |

---

## 1. Key handling: call the LLM from the browser ⭐ core design change

### Recommended: a hybrid design where the browser owns the LLM calls and the backend owns everything else

```
                  ┌──────────── Browser ─────────────┐
                  │ localStorage: llm.provider,      │
                  │               llm.apiKey, model  │
                  │                                  │
  1. create run ─►│  LLM client (provider adapter)───┼──► Gemini / OpenAI / Anthropic
                  │     ▲            │               │    (key is sent ONLY here)
                  └─────┼────────────┼───────────────┘
        papers + text   │            │ results (JSON, no key)
                  ┌─────┴────────────▼───────────────┐
                  │ FastAPI (never sees the key)     │
                  │  search · PDF fetch · text       │
                  │  extraction · persistence · auth │──► OpenAlex / S2 / arXiv / Europe PMC
                  └──────────────────────────────────┘
```

**How a run works:**

1. The browser calls `POST /projects/{id}/collect`. The server searches, removes duplicates, fetches open-access PDFs, extracts their text, and stores the paper records. The server needs no LLM for this.
2. The browser calls `GET /projects/{id}/papers?with_text=true`, then makes the LLM calls itself (extraction and synthesis, see §3) using the key from `localStorage`.
3. The browser sends the results to `PUT /projects/{id}/analysis`. The server saves the summaries, findings and review.
4. Chat follows the same pattern. The browser fetches the context, calls the LLM, and posts both messages to `/chat/history` for storage.

**Why this design over the alternatives:**
- It meets R1 **and** R2 exactly. The key only ever goes from the browser to the provider. You can say "your key never touches our servers" in the UI, and anyone can confirm it in DevTools. For a public BYOK app, that is how you earn users' trust.
- The server has no LLM code, no key handling, no LLM rate-limit handling, and no LLM cost.
- All three major providers allow browser calls with the user's own key:
  - Gemini: the `@google/genai` JS SDK
  - OpenAI: `dangerouslyAllowBrowser: true`
  - Anthropic: `dangerouslyAllowBrowser: true`, which sends the `anthropic-dangerous-direct-browser-access` header

  The "dangerous" warnings are about shipping *your* key to users. With a user's own key, that risk does not apply.
- Streaming the answer into the UI is simple in the browser.

**Costs of this design:**
- The analysis and chat prompts move from Python to TypeScript.
- The tab must stay open during the analysis step, which takes about 30–90 s. Save progress after each paper so a closed tab can resume where it stopped (§3 splits the work per paper, which makes this easy).
- The LangGraph workflow shrinks to "collect" on the server. Remove LangGraph (see §5).

### Interim option: a per-request header proxy
If you want to deploy before the rewrite, the browser sends `X-LLM-Key` with each
request and the server uses it only in memory for that call. This meets R1 but
**not** R2, because the server does see the key. Rules if you do this:
- Never put the key in `ResearchState`, the database, the task store, exceptions or log lines.
- Pass it through a `contextvars.ContextVar` or a function argument.
- Remove it from every logging and error-tracking processor.
- Never send it in a URL query string, because those end up in access logs.

The in-process `BackgroundTasks` run keeps the key in memory for the whole run.
Moving to a job queue would mean putting the key in Redis, which breaks R1.
That is one more reason to prefer the browser-side design.

### Rejected: storing keys on the server, even encrypted
This goes directly against the stated goal. It also makes the server a target
worth attacking, because it would hold many users' paid API keys.

### Frontend rules for the key (R4)
- Keep it in a **separate** zustand store (`llmSettings`, persisted under its own name), not in `researchgpt-auth`. That way logging out doesn't erase it unless the user chooses to.
- Add a settings page with: a provider dropdown, a masked key input, a "Test key" button (a cheap list-models call made directly to the provider), a model picker, a "Clear key" button, and a clear note: *"Stored only in this browser. Sent directly to {provider}. Never sent to ResearchGPT servers."*
- Block pipeline and chat actions until a key has passed the test. If the provider returns 401 or 403, send the user to settings.
- **Harden against XSS**, because it is now the main threat to the key:
  - set a strict Content-Security-Policy: `script-src 'self'` and `connect-src 'self' https://generativelanguage.googleapis.com https://api.openai.com https://api.anthropic.com`
  - no third-party analytics or tag scripts
  - replace `renderMd` + `dangerouslySetInnerHTML` with `react-markdown` + `rehype-sanitize`
  - treat all model output and paper text as untrusted
- Never put the key into toasts, error messages, `console.log`, or error-reporting breadcrumbs.

---

## 2. LLM layer: support more than Gemini

In a BYOK app, users arrive with whichever key they already have. A thin **provider
adapter** in the frontend widens the audience and lets users choose a stronger model.

```ts
interface LLMProvider {
  id: 'gemini' | 'openai' | 'anthropic'
  generateJSON<T>(prompt: Prompt, schema: ZodSchema<T>, opts): Promise<T>   // structured output
  stream(prompt: Prompt, opts): AsyncIterable<string>                          // chat
  acceptsPdf: boolean                                                         // native PDF input
  validateKey(key: string): Promise<boolean>
}
```

- **Define schemas once with Zod.** Every provider can return structured JSON from a JSON schema: Gemini `responseSchema`, OpenAI `response_format: json_schema`, and Anthropic through tool use or structured outputs. Validate each response with Zod, and retry once if validation fails. This replaces the fragile slicing from `{` to `}` in [comprehensive/agent.py](../backend/app/agents/comprehensive/agent.py).
- **Two model tiers per provider.** Use a fast, cheap model for the many per-paper calls and a stronger model for the one synthesis call. Examples:
  - Gemini: Flash for extraction, Pro for synthesis
  - Anthropic: `claude-haiku-4-5` for extraction, `claude-sonnet-5` or `claude-opus-5` for synthesis
  - OpenAI: the equivalent small and large models

  Let users override both. Show a rough token estimate before a run so they know what it costs on their key.
- **Native PDF input.** Gemini and Claude both accept PDFs directly as input. When the provider supports it, send the PDF itself instead of extracted text. Tables, figures and equations then survive, and you need no parsing library. Keep extracted text as the fallback for providers or files that don't support this.

---

## 3. Better results: redesign the research pipeline

Today the pipeline takes the first ~10 search hits and summarises only their
abstracts in one call. The biggest quality gains come from **finding better papers**
and **reading more than the abstract**.

| Stage | Current | Proposed | Why it's better |
|---|---|---|---|
| Query | the raw topic string | **Query expansion:** the LLM turns the topic into 3–5 search queries (synonyms, sub-topics, key terms) | finds many more relevant papers |
| Sources | S2 (no key), arXiv, PubMed | **OpenAlex** (free, broad coverage, DOIs, citation data) + **Semantic Scholar with an API key** + arXiv + **Europe PMC** instead of PubMed (includes open-access full text) | better coverage and metadata; PubMed never provides PDFs |
| PDFs | only the URL the source gave | **Unpaywall** looks up an open-access PDF for each DOI | many more full texts |
| Dedup | first 80 chars of the title | DOI, then arXiv id, then a fuzzy title match | fewer duplicates, fewer wrongly merged papers |
| Selection | first N results in the order they came back | **Relevance screening:** a cheap model scores each abstract 0–10 against the topic with a one-line reason, and the top N are kept. Optionally add a citation-count or recency weight. | the largest single improvement in quality |
| Expansion (optional) | — | **Snowballing:** add highly cited references and papers that cite the top-ranked papers (OpenAlex / S2 citation graph) | this is how real literature reviews find key papers |
| Reading | abstract only | full text: native PDF input to the model, or **`pymupdf4llm`** (PDF → Markdown, fast) on the server; **GROBID** if you need section-level structure and parsed references | methods, datasets and results are rarely in the abstract |
| Analysis | 1 call covering everything | **Map:** one structured-extraction call per paper (summary, methodology, model, dataset, metrics, limitations, quotes that support each claim), run in parallel with a concurrency limit. Each result is saved as soon as it finishes, so work survives failures. **Reduce:** one synthesis call over the extracted findings. | grounded, resumable, shows real progress, and fills the empty `paper_findings` table |
| Citations | none | Synthesis must cite `[paper_id]` for every claim. **Check citations afterwards:** every cited id must exist, and optionally a cheap call checks that the supporting quote contains the claim. Unsupported claims get flagged. | a review researchers can trust |
| Output | a Markdown blob | sections with linked inline citations, a comparison table, plus **BibTeX/RIS** export | usable in real research work |

The search-side stages (query expansion aside) run on the server and need no LLM
key. Query expansion and screening are LLM calls, so they run in the browser: the
browser generates the queries, sends them to `/collect`, receives candidate papers,
screens them, and tells the server which ones to download.

### Chat
- **Use long context first.** With full text extracted, send the project's papers (or their extracted findings plus the relevant sections) straight to a long-context model. For 10–20 papers this is simpler than RAG and often gives better answers.
- **Add RAG later, when projects get big.** Once projects reach 50 or more papers, use **pgvector** in the Postgres database you already have, not ChromaDB. Combine keyword search (Postgres full-text) with vector search, and add a reranker. **Embeddings then need the user's key too**, so they have to be computed in the browser and uploaded as vectors. That still keeps the key off the server.
- Include recent turns so follow-up questions work. Have the model cite `[paper_id]` and render those as links to the paper cards.

---

## 4. Frontend improvements

- **TypeScript.** The LLM layer, the Zod schemas and the provider adapters benefit a lot from types.
- **TanStack Query** for server state: caching, retries, and polling with `refetchInterval` that stops automatically. It replaces the hand-written `setInterval` polling in each page.
- **An orchestration hook for the browser-side pipeline**, `useResearchRun(projectId)`. It should:
  - run the map step in parallel with a concurrency limit
  - save each result to the server as it finishes
  - resume from the papers not yet processed
  - support cancelling through `AbortController`
  - show accurate progress, for example "Extracting 6/15"
- **`react-markdown` + `remark-gfm` + `rehype-sanitize`** for the review and for chat answers.
- **UI kit:** shadcn/ui (Radix-based, accessible, fits the existing Tailwind setup) for dialogs, tabs, the settings form and toasts. This also fixes the ARIA gaps.
- **First-run onboarding:** after sign-up, open the key settings page directly, with links for getting a key from each provider.

---

## 5. Backend for a public deployment

With LLM calls moved to the browser, the backend becomes a small, stateless API for
search, file handling and storage.

- **Remove LangGraph and the in-memory task store.** Collection becomes one job that saves its progress in the database. Show progress with `GET /projects/{id}` polling or a Server-Sent Events (SSE) stream. This fixes the stuck-`running` bug and allows running several workers.
- **A job runner for collection:** `arq` (Redis) or `procrastinate` (Postgres, no extra infrastructure). Collection jobs never hold a key, so queueing them is safe.
- **Rate limits and quotas (R5):**
  - per user: projects per day, papers per run, concurrent jobs
  - per IP: sign-up and login attempts (`slowapi`)
  - cap PDF size and page count
- **Caching:** cache search results by (source, query) and extracted text by DOI in Postgres. Different users often research the same topics, and a cache also protects you from upstream API rate limits.
- **Server-owned keys only for free data APIs:** Semantic Scholar, NCBI and OpenAlex (or at least a contact email). These are *your* keys, used for search, and they are unrelated to users' LLM keys.
- **Storage (R6):** in the default flow, don't keep PDFs. Download, extract the text, store the text, and discard the file. When native PDF input is used, the browser can fetch the PDF through a short-lived `/papers/{id}/pdf` proxy that streams it without saving it. If files must be kept, use S3 or Cloudflare R2 behind the storage interface ([improvements.md §4](improvements.md#4-architecture-and-code-structure)).
- **Remove `GEMINI_API_KEY` from production config** (R3). Add a startup check that fails if an LLM key is set while `APP_ENV=production`.
- **SSRF protection:** the server downloads URLs that come from third-party APIs. Allow only `http`/`https`, block private and link-local IP ranges after DNS resolution, and cap redirects.
- **Security basics from [improvements.md §1](improvements.md#1-security)** become required once the app is public: ownership checks, a real `SECRET_KEY`, PyJWT, input limits, and refresh tokens in httpOnly cookies.

---

## 6. Deployment topology

| Piece | Suggested platform | Notes |
|---|---|---|
| Frontend (static SPA) | Cloudflare Pages / Vercel / Netlify | Send the CSP from §1 as a response header. HTTPS only. |
| API | Fly.io / Render / Railway / Google Cloud Run (container) | Stateless, so it can scale to several instances once the task store is removed. |
| Postgres (+ pgvector) | Neon / Supabase | SSL is already handled in [session.py](../backend/app/db/session.py). |
| Job queue | Postgres (`procrastinate`) or Upstash Redis (`arq`) | Only needed for collection. |
| Object storage (optional) | Cloudflare R2 / S3 | Only if PDFs are kept. |
| Error tracking | Sentry | Scrub the `Authorization` header and `X-LLM-*` headers, and never record request bodies from LLM routes. |

Hosting the frontend and API on the same domain (for example `app.example.com` and
`app.example.com/api` through a platform rewrite) keeps the current same-origin
setup and lets auth move to an httpOnly cookie, so the JWT leaves `localStorage`.
The LLM key stays in `localStorage` by design.

Publish a short **Privacy / How your key is used** page. It should say where the key
is stored, which domains it is sent to, how to delete it, and that the server keeps
your projects and papers but never your key.

---

## 7. Migration roadmap

> The detailed, step-by-step version, with a **Done when** check for each step, is [fix-plan.md](fix-plan.md).

| Phase | Scope | Result |
|---|---|---|
| **0: Make it safe to be public** | P0 items from improvements.md (ownership checks, status auth, secret key, stuck runs), `.dockerignore`, CSP, `react-markdown` | the current app is safe to expose |
| **1: BYOK** | key settings page + separate store, provider adapter (Gemini first), move analysis and chat prompts to the browser, `/collect` and `/analysis` endpoints, remove the server LLM code and `GEMINI_API_KEY` | the deployment goal is met |
| **2: Better papers** | OpenAlex + Europe PMC + Unpaywall, DOI deduplication, query expansion, relevance screening, search cache, rate limits | noticeably better inputs |
| **3: Deeper reading** | full text (native PDF or `pymupdf4llm`), map-reduce extraction with per-paper saving and resume, filled findings table, citation checking, BibTeX export | noticeably better outputs |
| **4: Scale and polish** | OpenAI and Anthropic adapters, model tiers and cost estimate, pgvector chat, snowballing, SSE, TypeScript + TanStack Query, shadcn/ui | a polished product |
