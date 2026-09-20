# ResearchGPT — Design Decisions

This is a record of the choices behind the project and the reasons for them.

Each entry has a **Source** line that says where the reasoning comes from:
- **stated**: written down in a code comment, commit message or the README
- **inferred**: worked out from the code and git history, but not written down anywhere; confirm or correct these

Each entry uses this format: **Decision → Why → Trade-offs accepted → Status**.

> **Update (2026-09-20):** D-1 to D-19 record the original design. Entries replaced during
> the fixes are marked *Superseded*. D-20 to D-34 are the decisions made in
> [fix-plan.md](fix-plan.md), with the reasoning behind each. D-35 to D-37 come from the
> bug-fix pass that followed it.

---

## D-1. FastAPI (async) + async SQLAlchemy 2.0 + asyncpg

**Decision:** The backend is async from end to end. It uses FastAPI routes,
`AsyncSession` and the asyncpg driver.

**Why:** A pipeline run spends most of its time waiting on network I/O: three
search APIs, PDF downloads and Gemini. With async, one process can serve API
requests while those calls are in flight. The README says the goal was to "keep
the API non-blocking under concurrent uploads/queries, matching FastAPI's async
model end-to-end."

**Trade-offs:** Async SQLAlchemy is harder to use correctly. For example,
`expire_on_commit=False` is required, and lazy-loaded relationships fail inside
async code. Alembic also needs a separate sync driver (see D-2).

**Status:** Active. **Source:** stated (README "Design Decisions").

---

## D-2. Alembic is the only schema authority, running on a separate psycopg3 URL

**Decision:**
- The app no longer calls `Base.metadata.create_all()` (see the comment at the top of `main.py`).
- Alembic runs through `SYNC_DATABASE_URL`. A validator in `config.py` rewrites any `postgresql://` URL to `postgresql+psycopg://`.
- The Docker image runs `alembic upgrade head` before it starts uvicorn.

**Why:**
- If both `create_all` and Alembic manage the schema, the database and the migrations drift apart.
- The driver switch from psycopg2 to psycopg3 in commit `26966f6` fits the same Windows / Python 3.13 compatibility work as D-6. psycopg3 ships binary wheels.
- The URL rewrite means a plain `postgresql://` URL copied from a hosting provider works without changes.

**Trade-offs:** There are two database URLs to keep in sync. The schema changes through only one hand-written migration (`0001_initial`).

**Status:** Active. **Source:** stated (docstrings in `main.py` and `config.py`) plus inferred.

---

## D-3. PostgreSQL, with built-in support for hosted Neon and Supabase

**Decision:** The database is PostgreSQL 15. `session.py` checks the URL for
`neon.tech`, `supabase` or `sslmode=require`. When it finds one, it removes the
query string and passes `ssl="require"` instead.

**Why:** asyncpg rejects the `sslmode` query parameter that hosted providers put
in their connection strings. The check lets the app run against a free hosted
Postgres without a local install. `pool_size` / `max_overflow` were originally
removed too, on the grounds that they "conflict when connect_args includes ssl."

**Trade-offs:** The check matches on hostnames, so a new provider needs a code change.

**Status:** Active, but **amended by D-36**: the pool settings are back and set
explicitly. They do not in fact conflict with `connect_args={"ssl": ...}` — they
are pool arguments, not connection arguments — and relying on the defaults left a
ceiling of 15 that the app's own fan-out could exhaust on a single request.
**Source:** stated (docstring in `session.py`).

---

## D-4. LangGraph as the orchestrator

**Decision:** The pipeline is a LangGraph `StateGraph` over a `ResearchState` TypedDict.
It pins `langgraph==0.2.16` with the matching `langchain-core==0.2.38`, and has no
full `langchain` dependency.

**Why:** A graph with shared state gives each agent a clear boundary. It was also
meant to leave room for branching and retries between agents later. Node names
start with `step_` because LangGraph 0.2 raises an error when a node name matches a
state key.

**Trade-offs:** The graph is now just three steps in a row. It uses no LangGraph
features: no conditional edges, checkpointing, streaming or retry policies. In its
current form it could be three plain `await` calls. The dependency is worth keeping
only if those features get used (see improvements.md §4).

**Status:** Superseded by D-20 (LangGraph removed). **Source:** stated (for the naming) plus inferred.

---

## D-5. From 10 nodes to 3: one batched Gemini call ⭐ the key decision

**Decision:** The original graph had 10 nodes:
search → collection → document processing → summarization → key findings →
comparison → trends → gaps → literature review → presentation.

Commit `26966f6` ("Local Done") reduced it to 3 nodes. The last node,
`ComprehensiveAnalysisAgent`, makes one structured-output call that returns the
comparison, trends, gaps and literature review together.

**Why:**
- **Cost and rate limits.** The docstring in `workflow.py` says the change was
  made "to reduce API costs and avoid rate limits." The commit just before it is
  literally named "Expensive". The old design made several Gemini calls **per
  paper** (summaries, findings) plus one per synthesis step. On the free tier that
  ran into `429 ResourceExhausted` errors.
- **Latency and fewer bugs.** The README adds that more nodes meant more round-trips
  and "more surface area for state-management bugs, without a meaningful quality
  improvement."

**Trade-offs:**
- Per-paper summaries and structured findings (model, dataset, accuracy) are gone.
  The tables and endpoints for them still exist but stay empty.
- The one big call is a single point of failure. If the output is cut off or is not
  valid JSON, everything is lost at once.
- The UI can no longer show progress during analysis (a single step goes from 45% to 80%).
- The model only sees abstracts, which limits the depth of the analysis.

**Status:** Superseded by D-20 (browser-side map-reduce, per-paper extraction restored). **Source:** stated (docstring, README, commit history).

---

## D-6. Gemini 2.5 Flash through the new `google-genai` SDK

**Decision:**
- The model is `gemini-2.5-flash`.
- The code moved from `google-generativeai` to `google-genai` and uses its async client.
- Temperature is 0.3.
- The analysis call uses structured output (`response_schema` = a Pydantic model).

**Why:**
- Flash is cheap and fast, and has a free tier, which fits a side project.
- The new SDK uses REST, which "bypasses the `grpcio` Python 3.13 Windows issue" (from the docstring in `gemini_client.py`).
- A low temperature and a response schema make the output more predictable and easier to parse.

**Trade-offs:**
- The whole app depends on one vendor.
- A 429 is detected by matching the error message text.
- There is no retry, backoff or request timeout.

**Status:** Superseded by D-19 and D-23 (no server-side SDK; the browser calls Gemini's REST API). **Source:** stated (docstring) plus inferred.

---

## D-7. ChromaDB, PDF parsing, PPTX and LangChain removed; the model works on abstracts only

**Decision:** Commit `26966f6` removed `chromadb`, `pypdf`, `pdfplumber`, `python-pptx`,
`langchain`, `langchain-community` and `langchain-google-genai`, along with
`rag/pipeline.py`, `db/chroma.py` and the processing and presentation agents.
Chat now pastes up to 15 abstracts into the prompt instead of retrieving chunks.

**Why (inferred):**
- The commit is named "Local Done". The goal seems to have been an app that installs and runs reliably on a local Windows machine.
- ChromaDB and its dependencies (onnxruntime, hnswlib) plus the PDF libraries are the heaviest and most fragile installs on Windows and Python 3.13.
- Per-chunk embedding also costs extra API calls.
- Ten abstracts easily fit in Gemini's context window, so retrieval was not strictly needed.

**Trade-offs:**
- "RAG with exact citations" no longer exists, even though the README still describes it.
- Answers can only use abstract-level detail.
- PDFs are still downloaded but nothing reads them (wasted bandwidth and disk).
- Leftover config keys (`CHROMA_*`), startup directories and the `CitationSource` / `RAGResponse` schemas remain in the code.

**Status:** Partly reversed. Full text is extracted again (D-21), and RAG is still deferred. **Source:** inferred from the diff of `26966f6`.

---

## D-8. Three free academic sources, searched concurrently and fault-tolerantly

**Decision:**
- Semantic Scholar, arXiv and PubMed are queried together with `asyncio.gather(return_exceptions=True)`.
- Each source is retried 3× with exponential backoff (tenacity).
- Results are deduplicated by normalised title, and papers without a real abstract are dropped.

**Why:**
- All three sources are free and need no key, and together they cover computer science (arXiv, Semantic Scholar) and biomedical research (PubMed).
- With `return_exceptions`, one source that is down or rate-limited does not fail the whole search.
- Papers without abstracts are dropped because the analysis step only has abstracts to work from (see D-7).

**Trade-offs:**
- Keyless use is heavily rate-limited.
- The deduplication is simple: the first 80 characters of the title.
- The results are not re-ranked after merging, so the source order (S2, then arXiv, then PubMed) decides which papers survive the `max_papers` cut.

**Status:** Active. **Source:** stated (docstrings) plus inferred.

---

## D-9. In-process background tasks + in-memory task store instead of Celery / Redis

**Decision:** `POST /agents/run` starts the workflow as a FastAPI `BackgroundTask`.
Progress is stored in a module-level dict (`core/task_store.py`), and the frontend
polls `/agents/status/{task_id}` every 2.5 s. Celery and Redis are commented out in
`requirements.txt`. The Redis container in Compose is "optional".

**Why:** This setup has no extra infrastructure and is simple to run locally. The
dict lives in its own module "to avoid circular imports" between the route and the
workflow, and the file says to "replace with Redis for multi-worker deployments."

**Trade-offs:**
- **It only works with a single worker.** Behind `--workers N` or several containers, the status requests reach a different process.
- **All task state is lost on restart.** A project that was `running` stays `running` in the database, and neither the UI nor the API can recover it (see improvements.md P0).
- Nothing limits how many pipelines run at once.

**Status:** Superseded by D-22 (database-backed job with a heartbeat). **Source:** stated (docstring in `task_store.py`).

---

## D-10. Re-run semantics: only an active run is blocked, and data is replaced after success

**Decision:**
- A new run is refused only while the project is `RUNNING`. Failed and completed projects can run again.
- Task ids contain a timestamp (`task_{pid}_{uid}_{ts}`).
- Old papers, the review and the presentation are deleted **after** the workflow succeeds, in the same transaction as the new inserts.

**Why:** The docstring in `agents.py` lists these as fixes:
- Re-runs used to break on the unique constraints on `literature_reviews.project_id` and `presentations.project_id`.
- A failed project could never be retried.

Deleting after success means a run that fails half-way does not erase the last good results.

**Trade-offs:**
- The frontend shows the Run button only for `pending` and `failed`, so a completed project cannot be re-run from the UI.
- Every re-run makes all its Gemini calls again, with nothing cached.

**Status:** Updated. Re-collecting replaces papers and drops the stale review; completed projects can be re-run from the UI. **Source:** stated.

---

## D-11. Fail fast on rate limits, continue on other errors

**Decision:**
- A `RateLimitError` from Gemini stops the pipeline and marks the project FAILED.
- Any other analysis error returns an empty result, and the run still ends as COMPLETED.
- A failed search returns `[]`, and a failed PDF download is skipped.

**Why:** A 429 means retrying right away won't help. It is better to tell the user
clearly than to make more calls. Search and download failures are expected, since
some sources will always be flaky, so they should not kill the whole run.

**Trade-offs:** The "continue anyway" path is too generous. If the JSON cannot be
parsed, or the search finds zero papers, the project still shows **Completed**
with no review and no hint about why. Combined with D-10, the user cannot re-run it from the UI.

**Status:** Superseded. Collection failures store a user-safe reason; in the browser a rejected key or rate limit stops the run, and a single bad paper is skipped. **Source:** stated.

---

## D-12. Mixed transaction handling: `get_db` commits, and some routes commit themselves

**Decision:** `get_db()` commits after the request handler returns. Delete routes
and `/chat/query` also call `await db.commit()` themselves.

**Why:** From the comments in `chat.py` and `projects.py`: deletions on routes that
return 204 "appeared to work but messages reappeared on reload." The explicit commit fixed that.

**Trade-offs:** It is no longer clear which code is responsible for committing.
The actual cause, when a dependency's cleanup code runs relative to the response,
was patched in individual routes rather than fixed in one place.

**Status:** Resolved. `get_db` owns the commit; routes only flush (fix-plan Step 14). **Source:** stated.

---

## D-13. Status fields stored as plain strings, not database ENUMs

**Decision:** `ProjectStatus` and `PaperStatus` are Python `str` enums, but the
columns are `String(50)`.

**Why:** To avoid "SQLAlchemy Enum type migration complications." Postgres ENUM
types need their own `ALTER TYPE` steps in migrations.

**Trade-offs:** The database does not check the values, so any string can be stored.

**Status:** Active. **Source:** stated (comment in `models.py`).

---

## D-14. JWT bearer auth, stored in localStorage

**Decision:**
- Tokens are HS256 JWTs with a 60-minute lifetime, created with python-jose.
- Passwords use bcrypt through passlib, with `bcrypt==3.2.0` pinned because passlib 1.7.4 breaks on bcrypt ≥ 4.
- The frontend keeps the token in zustand `persist` (localStorage) and logs out on any 401.

**Why:** This is the standard pattern for a stateless SPA and API. It needs no
session store and works the same through the Vite proxy and through nginx.

**Trade-offs:**
- There is no refresh token, so users are logged out every hour.
- A token in localStorage can be read by any XSS on the page.
- Both python-jose and passlib are no longer maintained.

**Status:** Superseded by D-24 (httpOnly cookie sessions, PyJWT and pwdlib). **Source:** inferred.

---

## D-15. Same-origin API through a proxy, in both dev and prod

**Decision:** The frontend calls a relative `/api`. In development the Vite dev
server forwards it to :8000. In production nginx forwards `/api/` to `backend:8000`.

**Why:** The browser never makes a cross-origin request, so there is no CORS
preflight, and the same frontend build works in every environment with no API URL
baked in. The CORS middleware is still there as a fallback.

**Status:** Active. **Source:** inferred.

---

## D-16. "S3-ready" and "Pinecone-ready" as config placeholders only

**Decision:** Settings contain `USE_S3`, `AWS_*`, `USE_PINECONE` and `PINECONE_*`.
PDFs go to local disk at `storage/pdfs/{project_id}/{md5(url)[:12]}.pdf`.

**Why:** The plan was to start local and swap in cloud storage later without
touching the config format. File names come from a hash of the URL, so the same
PDF is not downloaded twice for a project.

**Trade-offs:** No storage or vector-store abstraction exists yet, so "ready"
really means "the env keys are defined". `services/` is empty.

**Status:** Dropped. PDFs are read in memory and discarded; only text is stored (D-21). **Source:** stated (comments) plus inferred.

---

## D-17. A lean frontend stack

**Decision:** React 18 + Vite + Tailwind + zustand + axios + react-hot-toast + lucide.
There is no component library, no data-fetching library, and a hand-written Markdown renderer.

**Why:** Few dependencies and full control over the look. The design went from a
generic look to a custom warm orange / cream palette with the Outfit font in `26966f6`.
The hand-written renderer escapes HTML **before** it applies inline formatting,
which is what makes its `dangerouslySetInnerHTML` safe.

**Trade-offs:**
- The Markdown support is partial: no links, no nested lists, no code blocks.
- Data fetching and polling are written by hand in each page.

**Status:** Updated. TypeScript, TanStack Query, Zod and react-markdown with sanitising were added. **Source:** inferred.

---

## D-18. Loguru for logging

**Decision:** Loguru writes coloured output to stdout and a daily file, rotated at
midnight, kept for 30 days and zipped.

**Why:** It needs almost no setup, and its log messages are easier to read than the
standard `logging` module's. Log lines are prefixed with tags like `[Workflow]` or
`[SearchAgent]` so each run is easy to follow.

**Trade-offs:** The logs are plain text, not JSON, and carry no request or task id.

**Status:** Active. JSON output and request IDs were added (fix-plan Step 28). **Source:** inferred.

---

## D-19. Bring-your-own LLM key, stored only in the browser (target)

**Decision:** The public deployment will not use a server-owned LLM key. Each user
enters their own key in the frontend. The key is stored **only in `localStorage`**,
never in the database, logs or server storage.

**Why:** Hosting costs stay independent of how much people use the LLM, and users
keep control of their own keys and spending.

**Consequences:**
- LLM calls move to the browser, so the server never sees the key. This replaces D-6 (a server-side Gemini client) and most of D-4 and D-5.
- XSS hardening (CSP, sanitised Markdown) becomes critical.
- Server resources such as search, PDF downloads and the database still need rate limits.

The full plan is in [design-improvements.md](design-improvements.md).

**Status:** Active (fix-plan Phase 3). **Source:** stated by the project owner.

---

## D-20. The analysis runs in the browser as a map-reduce

**Decision:**
- **Map:** one structured extraction per paper, 3 at a time, each saved as soon as it finishes.
- **Reduce:** one review over all the extractions.

Both run in the browser with the user's key. There is no LangGraph.

**Why:**
- It meets D-19: the server never sees the key.
- Saving per paper makes runs resumable. A closed tab or a rate limit leaves the project `collected`, and "Continue analysis" skips the papers already done.
- Per-paper findings come back cheaply, with a fast model for extraction and a stronger one for the review.
- Grounding improves. Every claim cites `[P<id>]`, and citations of unknown papers are removed.

**Trade-offs:**
- The tab must stay open during the analysis. Mitigations: a warning before closing, a resumable run, and a "Stop" button.

**Status:** Active. **Source:** fix-plan Step 22.

---

## D-21. Full text via pypdf, and PDFs are never stored

**Decision:** The server extracts text with **pypdf** (BSD licence) in a worker thread, bounded to 60 pages and 150k characters. PDFs are downloaded into memory, read, and discarded. Only the text is stored.

**Why:**
- The model needs methods and results, not only abstracts.
- PyMuPDF (`pymupdf4llm`) is AGPL, which carries obligations for a hosted service.
- Hosting platforms usually have temporary disks.
- Not keeping files avoids storing copyrighted PDFs.

**Trade-offs:** pypdf's layout extraction is weaker than PyMuPDF's or GROBID's. Tables and multi-column layouts can come out jumbled. Sending the PDF itself to the model (fix-plan Step 35) would fix that for providers that accept PDFs.

**Status:** Active. **Source:** fix-plan Step 21.

---

## D-22. A database-backed collection job with a heartbeat, not a job queue

**Decision:** Collection runs as an in-process background task. It writes `progress`, `current_step` and a `heartbeat_at` (every 15 seconds) to `research_projects`. A project that is `collecting` with a heartbeat older than 90 seconds is treated as dead: it's marked failed at startup and whenever the project is read, and a live job blocks a second one with a 409.

**Why:** The plan proposed procrastinate or arq. Both need a worker process, which means a second paid instance on most platforms. A heartbeat gives the property that matters: no project stuck in `collecting` forever, and correct behaviour with several API instances or after a restart. No new infrastructure is needed.

**Trade-offs:**
- A job isn't retried automatically after a crash; the user runs it again.
- Very long jobs keep a request worker's event loop busy. That's fine at 25 papers or fewer.

**Status:** Active. **Source:** fix-plan Step 20.

---

## D-23. Gemini through REST with `fetch`, not the JS SDK (extended by D-28)

**Decision:** The browser calls `generativelanguage.googleapis.com` directly with `fetch`, sending the key only in the `x-goog-api-key` header. Structured output uses `responseSchema`, which is generated from Zod schemas.

**Why:** A smaller bundle, full control over where the key goes (never in a URL, never in an error message), and one provider-neutral interface (`LLMProvider`), so OpenAI and Anthropic adapters can follow.

**Status:** Active. **Source:** fix-plan Step 19.

---

## D-24. Sessions in httpOnly cookies with rotating refresh tokens

**Decision:**
- **Access token:** a 15-minute JWT in an httpOnly, SameSite=Lax cookie.
- **Refresh token:** a 7-day random token, stored only as a hash and rotated on every use. Reusing one revokes all of the user's sessions.
- **CSRF:** unsafe methods need an `X-Requested-With` header.
- **API clients:** a Bearer token still works.

**Why:** Once users' LLM keys live in localStorage, nothing else secret should be readable by JavaScript. Rotation and reuse detection limit the damage if a refresh token is stolen.

**Status:** Active. **Source:** fix-plan Step 26.

---

## D-25. Defence in depth for a key-in-the-browser app

**Decision:**
- a strict CSP (scripts only from our own origin; connections only to our API and the LLM provider)
- a self-hosted font
- all model output rendered through react-markdown with rehype-sanitize
- the same headers in nginx and in `_headers`, kept identical by a test
- no third-party scripts, including no frontend error tracker

**Why:** Cross-site scripting is the one way a user's key could be stolen from our site. Every third-party script would be another way in.

**Status:** Active. **Source:** fix-plan Steps 10, 27 and 28.

---

## D-26. Abuse limits: per IP for auth, per user in the database

**Decision:**
- **Per IP (slowapi):** register 5/hour, login 10/minute.
- **Per user, checked in Postgres:** 20 projects per 24 hours, and one active collection at a time.

**Why:** The server still pays for search APIs, PDF downloads and storage. The per-user quotas live in the database, so they hold across instances. The IP limits count per instance unless `RATE_LIMIT_STORAGE_URI` points at Redis.

**Status:** Active. **Source:** fix-plan Step 25.

---

## D-27. Migrations as a release step; non-root images

**Decision:** `alembic upgrade head` runs once per deploy (the compose `migrate` service, or the platform's release command), not on container start. The API image is multi-stage, has no compiler, and runs as the unprivileged `app` user.

**Why:** Several instances starting together must not race to migrate. A non-root process with no compiler limits what an attacker can do after a compromise.

**Status:** Active. **Source:** fix-plan Step 29.

---

## D-28. Three providers behind one interface: `fetch` for Gemini and OpenAI, the official SDK for Claude

**Decision:** Gemini and OpenAI are called with plain `fetch`; Anthropic is called with
`@anthropic-ai/sdk`, imported on demand (`dangerouslyAllowBrowser`, SDK retries off) so it is
downloaded only by the people who pick Claude. All three implement the same `LLMProvider`
interface, and each names a **fast** model (one call per paper) and a **strong** one (the review
and chat).

**Why:** The Anthropic API's browser support, structured output and document blocks are easier to
get right through the SDK than by hand, and the SDK is the vendor's supported path; the other two
are a single JSON endpoint each, where a dependency would buy nothing. Lazy loading keeps the
default bundle the size it was (the SDK is ~53 kB gzipped in its own chunk).

**Trade-offs:** One more dependency to keep current, and two code paths for error mapping. The
key still belongs to one provider at a time: switching provider clears it, rather than juggling
several keys in localStorage.

**Status:** Active. **Source:** fix-plan Step 38.

---

## D-29. A cost estimate from an editable price table, not a billing API

**Decision:** Before a run, the project page shows roughly what it will cost, from token estimates
per stage and a list-price table (`llm/pricing.ts`) the user can override per model in Settings.
Every run records what it actually used, per model.

**Why:** Nobody should start a run without knowing whether it costs cents or dollars. Providers
have no browser-callable billing API, prices change, and a stale hard-coded number is worse than
one the user can correct.

**Trade-offs:** The estimate is approximate, and the defaults go out of date. The actual usage
recorded per run is what corrects the picture afterwards.

**Status:** Active. **Source:** fix-plan Step 38.

---

## D-30. Keyword retrieval over paper passages, not embeddings

**Decision:** Chat retrieves passages with Postgres full-text search over ~1,500-character chunks
(`paper_chunks`, a generated `tsvector` with a GIN index, built lazily on a project's first
search). pgvector and browser-side embeddings were dropped from the plan.

**Why:** A project holds at most 25 papers, so a question matches a handful of passages by keyword
just as well; ranking is `ts_rank_cd` with at most three passages per paper so one long paper
can't crowd out the rest. Embeddings would have had to be computed in the browser with the user's
key, uploaded, versioned per model and re-computed when the model changed — real cost and
complexity for a corpus this size.

**Trade-offs:** Questions that share no words with the papers retrieve nothing (the model still
has every paper's extracted findings, so it answers from those). If projects ever hold hundreds of
papers, this is the decision to revisit.

**Status:** Active. **Source:** fix-plan Step 39.

---

## D-31. Citation checking against extracted findings, best effort

**Decision:** After the review is written, every cited sentence (up to 40, in batches of 10) is
checked against the extracted findings of the papers it cites, and gets a verdict of *supported*,
*partly* or *unsupported*. A failure of this step never costs the user the review that is already
written, and the results are shown in their own tab with a banner.

**Why:** The failure mode people actually fear in a generated review is a citation that doesn't
support the claim. Checking against what was already extracted adds one cheap call per ten claims
instead of re-reading every paper.

**Trade-offs:** The check sees the extraction, not the whole paper, so it can be wrong in both
directions; the UI says so and tells the reader to check flagged claims against the paper. An
alternative — asking for a supporting quote with every claim — was dropped because it shapes the
prose around quotable sentences.

**Status:** Active. **Source:** fix-plan Step 36.

---

## D-32. Measuring quality from stored runs, with no LLM judge

**Decision:** Every review is saved with its prompt version, provider, models, token usage and
duration. `backend/scripts/eval_reviews.py` reads the stored reviews (read-only) and averages
metrics per prompt version over the fixed topics in `eval/topics.json`: citation density, coverage
of the analysed papers, supported and unsupported claim rates, invented citations removed, tokens.

**Why:** It answers "did that prompt change help?" from data each run already produces, and costs
the user nothing extra. A second model grading the prose would spend the user's key on every run
and drift as models change.

**Trade-offs:** The metrics are proxies; they say nothing about whether the prose reads well. The
evaluation README says to read a couple of reviews from each version side by side before adopting
a prompt.

**Status:** Active. **Source:** fix-plan Step 37.

---

## D-33. Papers are the user's to change, and each run is kept

**Decision:** A paper can be added by DOI or arXiv id, uploaded as a PDF (only its text is stored,
never the file) or removed. Any change puts the project back to `collected`, so the next run
rewrites the review over the papers that are now there, re-reading only the new ones. The last ten
reviews per project are kept (`review_runs`) and compared in a History tab.

**Why:** Search never finds exactly the right set: the seminal paper is paywalled, or a result is
off-topic. Without run history, re-running is a gamble — the previous review is gone.

**Trade-offs:** A row per run, capped at ten, and one more status transition to reason about. The
old review stays readable while the papers no longer match it, which the UI has to say plainly.

**Status:** Active. **Source:** fix-plan Step 40.

---

## D-34. Accessibility checked by axe in CI, and no component library

**Decision:** Playwright runs axe-core (WCAG 2.1 A and AA) over every page in the states users see
them, and the suite fails on any violation. The pages stay plain Tailwind with a small
`Tabs` component that follows the WAI-ARIA tabs pattern; shadcn/ui was not adopted.

**Why:** An automated check that fails the build keeps accessibility from rotting, and it caught
real problems: text at 2.5:1 contrast, a link nested inside a button, icon-only controls with no
name. Swapping in a component library would have rewritten every page for no user-visible gain.

**Trade-offs:** axe catches maybe half of what a manual audit would; keyboard behaviour is covered
by an explicit test instead. Lighthouse was not run, so the "score at least 95" target in the plan
is met in spirit (no axe violations), not by that number.

**Status:** Active. **Source:** fix-plan Step 40.

---

## D-35. Reload is supervised by watchfiles, not `uvicorn --reload`

**Decision:** `start.ps1` runs the API under the `watchfiles` CLI
(`watchfiles "uvicorn main:app --port 8000" .`) instead of passing `--reload` to
uvicorn. The venv's `Scripts` directory goes on `PATH` first so that `uvicorn`
in that command is the venv's.

**Why:** uvicorn's reloader restarts its worker on Windows with
`os.kill(pid, signal.CTRL_C_EVENT)`, which is delivered by
`GenerateConsoleCtrlEvent` and needs a console and a process-group leader. The
launcher redirects the output streams so it can prefix and interleave both
servers' logs, which leaves the worker without one. The call then *succeeds*
without delivering anything, the `process.join()` after it waits forever, and no
replacement worker starts — so the server keeps serving the code you just edited
and the last line in the log is "Reloading...". Silently testing stale code is
far worse than losing the unified log, and watchfiles restarts the command by
terminating it, which needs no console.

**Trade-offs:** The port is released and rebound on each restart instead of being
held by a parent, so there is a brief window where the API refuses connections;
reload takes ~3–4 s rather than ~1 s. watchfiles watches all of `backend/`, so
editing a test restarts the API too. `uvicorn[standard]` already depends on
watchfiles, so this adds nothing to install; the script falls back to
`--reload` with a warning if it is somehow absent. Running `uvicorn --reload` by
hand in a normal terminal is unaffected and still works.

**Status:** Active. **Source:** stated — `start.ps1`, and the bug-fix pass of 2026-09-20.

---

## D-36. An explicit connection pool, and a cap on database fan-out

**Decision:** The engine sets `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` and
`DB_POOL_TIMEOUT` explicitly (10 + 20, 30 s) with `pool_recycle=1800`, and the
two places that fan out over the database are bounded: a semaphore caps how many
(source, query) cache lookups touch the pool at once, and the collection job's
existing 4-at-a-time semaphore was widened to cover the "text already extracted
elsewhere" lookup as well as the download.

**Why:** SQLAlchemy's default is 5 + 10, and a request handler holds a connection
of its own while the work it starts opens more. A single search over four sources
and up to six queries asked for 24 sessions at once against a ceiling of 15, and a
25-paper collection opened a session per paper for the reuse lookup and another
per paper to write progress. None of that fails in a quiet dev database; it fails
under concurrent users, as pool timeouts surfacing as 500s.

**Trade-offs:** A cap makes a cold search slightly slower, since cache lookups
queue in batches — the source HTTP call, which is the slow part, stays outside the
semaphore and holds no connection. The ceiling is now a number someone has to keep
under what the database allows: hosted Postgres plans cap connections low, and
this is per instance, so N instances multiply it.

**Status:** Active. **Source:** stated — the bug-fix pass of 2026-09-20.

---

## D-37. Providers declare their minimum output budget

**Decision:** `LLMProvider` has an optional `minOutputTokens`. `generateJSON`
starts from `max(requested, provider.minOutputTokens)`, and the retry after a
truncated answer doubles from there. Anthropic declares 16,000.

**Why:** Anthropic raises any smaller `max_tokens` to its floor. Extraction,
screening and verification all ask for 4,096, so the first attempt was sent as
16,000 and the "retry with twice the budget" was sent as 16,000 as well — the
same number, guaranteed to truncate again and then fail with "the answer was too
long". The recovery path existed but could never work for those three calls. It
matters most with thinking-enabled models, where thinking counts toward the
limit.

**Trade-offs:** The floor is duplicated in the provider (as the clamp it still
applies) and in the interface. A provider that gains or changes a floor has to
update both, and a mismatch is invisible until something truncates — so a test
pins the growth sequence (`[16000, 32000]`) rather than the clamp alone.

**Status:** Active. **Source:** stated — the bug-fix pass of 2026-09-20.
