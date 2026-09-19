# ResearchGPT — Design Decisions

This is a record of the choices behind the project and the reasons for them.

Each entry has a **Source** line that says where the reasoning comes from:
- **stated**: written down in a code comment, commit message or the README
- **inferred**: worked out from the code and git history, but not written down anywhere; confirm or correct these

Each entry uses this format: **Decision → Why → Trade-offs accepted → Status**.

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
Postgres without a local install. The `pool_size` / `max_overflow` settings were
removed because they "conflict when connect_args includes ssl."

**Trade-offs:** The check matches on hostnames, so a new provider needs a code change. It relies on default pool sizes.

**Status:** Active. **Source:** stated (docstring in `session.py`).

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

**Status:** Active. **Source:** stated (for the naming) plus inferred.

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

**Status:** Active. **Source:** stated (docstring, README, commit history).

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

**Status:** Active. **Source:** stated (docstring) plus inferred.

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

**Status:** Active. The README is out of date. **Source:** inferred from the diff of `26966f6`. *Please confirm the reason.*

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

**Status:** Active. It is known to be temporary. **Source:** stated (docstring in `task_store.py`).

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

**Status:** Active. **Source:** stated.

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

**Status:** Active. **Source:** stated (comments in `workflow.py` and `comprehensive/agent.py`).

---

## D-12. Mixed transaction handling: `get_db` commits, and some routes commit themselves

**Decision:** `get_db()` commits after the request handler returns. Delete routes
and `/chat/query` also call `await db.commit()` themselves.

**Why:** From the comments in `chat.py` and `projects.py`: deletions on routes that
return 204 "appeared to work but messages reappeared on reload." The explicit commit fixed that.

**Trade-offs:** It is no longer clear which code is responsible for committing.
The actual cause, when a dependency's cleanup code runs relative to the response,
was patched in individual routes rather than fixed in one place.

**Status:** Active. **Source:** stated.

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

**Status:** Active. **Source:** inferred (the reason for the bcrypt pin is well known).

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

**Status:** Planned, not implemented. **Source:** stated (comments) plus inferred.

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

**Status:** Active. **Source:** inferred.

---

## D-18. Loguru for logging

**Decision:** Loguru writes coloured output to stdout and a daily file, rotated at
midnight, kept for 30 days and zipped.

**Why:** It needs almost no setup, and its log messages are easier to read than the
standard `logging` module's. Log lines are prefixed with tags like `[Workflow]` or
`[SearchAgent]` so each run is easy to follow.

**Trade-offs:** The logs are plain text, not JSON, and carry no request or task id.

**Status:** Active. **Source:** inferred.

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

**Status:** Planned. **Source:** stated by the project owner.
