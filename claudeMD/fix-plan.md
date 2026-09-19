# ResearchGPT — Step-by-Step Fix Plan

This is one ordered plan that covers **every** item in [improvements.md](improvements.md)
(**I§n**) and [design-improvements.md](design-improvements.md) (**D§n**), ending in
the deployment goal: **a public app where users bring their own LLM key, kept only in `localStorage`**.

**How to use it:**
- Work top to bottom. Each step lists what it depends on, the actions to take, and a **Done when** check.
- Make one branch or PR per step and keep `main` deployable.
- Tick the boxes as you go.
- Step numbers are stable. The table at the end maps every issue to its step.

**Ordering rules this plan follows:**
1. **Tests before fixes.** A test harness exists before the security fixes, so every fix gets a regression test.
2. **Don't polish code that will be deleted.** Several items in I§2 and I§3 apply to the server-side Gemini code, which Phase 3 deletes. Those items are done **once**, in the new browser code, and marked *(→ Step N)* below.
3. **Safe before public.** Nothing gets deployed until Phases 1 and 4 are complete.

```
Phase 0 Prep ─► Phase 1 Safe ─► Phase 2 Foundation ─► Phase 3 BYOK ─► Phase 4 Launch ─► Phase 5 Better papers ─► Phase 6 Deeper reading ─► Phase 7 Scale & polish
  (1–4)          (5–12)          (13–17)              (18–24)         (25–30) 🚀       (31–34)                  (35–37)                    (38–40)
```

---

## Phase 0: Preparation (no behaviour change)

### ◐ Step 1: Record a baseline
- Commit the `claudeMD/` folder. Decide what to do with the uncommitted `README.md` edits: stash them, because Step 30 rewrites the README anyway.
- Create a working branch, for example `fix/phase-1`.
- Run the app once locally (backend, frontend, one full pipeline run) and write down anything that is already broken.

**Done when:** you have a clean git status and one pipeline run completes locally.

> **Progress (2026-09-19):**
> - The paused rebase was finished, with the README committed as it was in the working copy (`de36b65`).
> - Work continues on branch `fix/phase-0`, and the docs are committed.
> - **Still open:** the baseline pipeline run. It was not done automatically, because `.env` points at a hosted Neon database with real data and a real Gemini key, and a run would write to that database and spend the key's quota. Run it yourself, or point `.env` at the local Compose `db` service first.

### ☑ Step 2: Linting and formatting · I§5

> **Done.** Deviations from the plan:
> - ESLint 10 is used **without** `eslint-plugin-react`, which does not support ESLint 10 yet. ESLint 10 tracks JSX usage by itself, which was the main reason for that plugin here.
> - `react-hooks/set-state-in-effect` is set to *warn* until Step 17 replaces the fetch-in-`useEffect` code.
> - Formatting is in separate commits: `65d7c44` (backend) and `3bbd3fe` (frontend).

- Backend: add `ruff` for linting and formatting, with a `pyproject.toml` config.
- Frontend: add ESLint (react and react-hooks plugins) and Prettier, with `lint` and `format` npm scripts.
- Add `pre-commit` hooks for both.
- Apply the formatter to the whole codebase in a **single commit on its own**, so later diffs stay readable.

**Done when:** `ruff check .` and `npm run lint` pass.

### ☑ Step 3: Backend test harness · I§5

> **Done.** It uses a Compose `test` profile (now `docker compose -f docker-compose.test.yml up -d`, postgres on 127.0.0.1:55432 with in-memory storage) instead of pytest-postgresql, because Windows has no local Postgres binaries. `conftest.py` refuses to run against any non-local database host. 8 tests pass.

- Add `pytest-asyncio`, `httpx` (`AsyncClient` + `ASGITransport`), `respx` and `pytest-postgresql` (or testcontainers).
- Write fixtures that create a test database (run `alembic upgrade head` against it) and the helpers `make_user()` and `auth_headers(user)`.
- Write smoke tests for register, login, `/auth/me` and project CRUD.

**Done when:** `pytest` passes locally with at least 5 tests.

### ◐ Step 4: CI · I§5

> **Written** in `.github/workflows/ci.yml` (it also runs `ruff format --check` and `npm run format:check`). **Not yet verified:** the branch hasn't been pushed, so CI has not run.

Add a GitHub Actions workflow with two jobs:
- **backend:** a Postgres service container, then `ruff check`, then `pytest`
- **frontend:** `npm ci`, `npm run lint`, `npm run build`

**Done when:** CI passes on a pull request.

---

## Phase 1: Make it safe (all P0 items and cheap P1s)

### ☑ Step 5: Ownership checks on every project route · I§1 (IDOR)
- Add a `get_owned_project` dependency, in `app/api/deps.py` or `core/security.py`. It returns 404 when the project does not exist **or** belongs to someone else.
- Use it in [papers.py](../backend/app/api/routes/papers.py) (all 3 routes), [reviews.py](../backend/app/api/routes/reviews.py) (both routes) and [chat.py](../backend/app/api/routes/chat.py) (`GET` and `DELETE /history`).
- In `/chat/query`, `project_id` arrives in the request body, so check ownership inside the handler.
- Write a parametrised test: user B calls every project-scoped route on user A's project and must get 404, and user A's chat history must be unchanged afterwards.

**Done when:** the ownership test covers every route and passes.

### ☑ Step 6: Protect `/agents/status` · I§1
- Add `Depends(get_current_user_id)`. Store `user_id` in the `_task_store` entry and return 404 if it doesn't match the caller.
- Add tests for: no token → 401, another user → 404.

**Done when:** both tests pass.

### ☑ Step 7: Configuration hardening · I§1, I§2 (minor items), I§1 (compose)
- In `config.py`: remove the default `SECRET_KEY`. Add a validator that fails at startup when `APP_ENV != "development"` and the key is shorter than 32 characters or is a known placeholder.
- Change the `DEBUG` default to `False`. Add a separate `SQL_ECHO: bool = False` and use it in `session.py` instead of `echo=settings.DEBUG`.
- In `docker-compose.yml`: read the Postgres password from `.env`, stop publishing ports 5432 and 6379 (or keep them only in a `docker-compose.override.yml` for dev), and remove the `version:` key.

**Done when:** the app refuses to start in `APP_ENV=production` without a strong key, and a test proves it.

### ☑ Step 8: Fix projects stuck in `running` · I§2 (P0)
- In `lifespan` startup: `UPDATE research_projects SET status='failed' WHERE status='running'`, and log how many rows it changed.
- In `run_agents`: if the project is `running` but its `task_id` is not in `_task_store`, treat the run as stale and allow a new one.
- In [ProjectPage.jsx](../frontend/src/pages/ProjectPage.jsx): when polling gets a 404, stop polling, set the status to `failed`, and show a toast asking the user to run again.

**Done when:** you start a run, restart the backend, reload the page, and the project shows **Failed** with a working Run button.

### ☑ Step 9: Docker cleanliness · I§5 (Docker)
- Delete the `.dockerignore` line from the root `.gitignore`.
- Add `backend/.dockerignore` (`venv/`, `storage/`, `logs/`, `.env`, `__pycache__/`, `.pytest_cache/`) and `frontend/.dockerignore` (`node_modules/`, `dist/`).
- Frontend image: use `node:22-alpine` and `npm ci`.

**Done when:** `docker compose build` works and `docker run --rm <backend-image> ls` shows no `venv`, `.env` or `storage`.

### ☑ Step 10: Remove the XSS risk · I§7, D§1 (R4)
- Replace `renderMd` and `dangerouslySetInnerHTML` in [ReviewPage.jsx](../frontend/src/pages/ReviewPage.jsx) with `react-markdown` + `remark-gfm` + `rehype-sanitize`.
- Render chat answers with the same component.
- Add a first CSP header in `nginx.conf`: `default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'`.
  - If `index.html` loads Google Fonts, add those domains to `style-src` and `font-src`, or better, host the font yourself.

**Done when:** a review containing `<img src=x onerror=alert(1)>` renders as harmless text, and the browser console shows no CSP errors.

### ☑ Step 11: Quick correctness fixes · I§1, I§2
- **Progress steps:** set `STEPS = ['Paper Search', 'Paper Collection', 'Comprehensive Analysis']`. Step 24 replaces this again, but the fix costs one line.
- **Silent "Completed":** if the search returns 0 papers, or the analysis returns an empty review, raise an error with a clear reason. The project is then `failed` and the reason appears in the UI.
- **Re-run:** show the Run button for `completed` projects as well, with a confirmation such as "This replaces the current results".
- **Citation key:** the backend should return `citations: []` and the frontend should read `citations`, so both use one name. Real citations come in Step 23.
- **Input limits:** add Pydantic `Field` constraints: password at least 8 characters, username 3–50 characters `[a-zA-Z0-9_]`, topic 3–300 characters, `max_papers` between 1 and 25.
- **Error leakage:** show users generic messages (`"Analysis failed. Please try again."`) and send the full error to `logger.exception`. Apply this to the chat fallback and the task `error` field.
- **Deactivated users:** `get_current_user_id` loads the user and rejects the request when `is_active` is false.

**Done when:** each bullet has a test or a documented manual check, and CI passes.

### ☑ Step 12: Replace unmaintained auth libraries · I§1
- Replace `python-jose` with `PyJWT`, and `passlib` with `pwdlib[bcrypt]` (or `bcrypt` directly). Remove the `bcrypt==3.2.0` pin.
- Check that existing bcrypt hashes still verify. They are standard `$2b$` hashes, so they should.

**Done when:** the auth tests pass and a user created before the change can still log in.

> **Phase 1 notes (2026-09-19):** 75 backend and 8 frontend tests pass.
> - Step 10 pulled Vitest forward from Step 17. It uses **Vitest 3**, because Vitest 5 needs Vite 6 or newer.
> - Step 11 also re-checks `is_active` on every request. Step 12 also fixes a 500 error on tokens with a non-numeric `sub`.
> - Step 9 added `.gitattributes` (`eol=lf`), because Docker builds copy the Windows working tree.

> ✅ **At the end of Phase 1** the current app has no known security holes. It is still **not** deployed, because it still depends on a server-side Gemini key.

---

## Phase 2: Foundation for the redesign

### ☑ Step 13: Schema migration `0002` · I§2 (minor items)
Use Alembic autogenerate, then review the result by hand:
- Change every `DateTime` to `DateTime(timezone=True)`.
- Add indexes on `papers.project_id`, `chat_messages.project_id`, `paper_summaries.paper_id` and `paper_findings.paper_id`. Add `ondelete="CASCADE"` to all child foreign keys.
- Add progress columns to `research_projects`: `progress INT`, `current_step TEXT`, `error TEXT`, `started_at`, `finished_at`.
- Add `papers.full_text TEXT` and `papers.doi TEXT` (indexed), and `literature_reviews.comparison TEXT`.
- Add `alembic check` to CI so the models and migrations can't drift apart.

**Done when:** `alembic upgrade head` and `alembic downgrade -1` both work on a copy of your local database.

### ☑ Step 14: One transaction pattern · I§2
- Rule: `get_db` owns the commit. Routes and services only `flush`.
- Remove the explicit `commit()` calls from `chat.py` and `projects.py`.
- Add a regression test for the original bug: `DELETE` a resource, then `GET` it again in a **new** client or session, and expect it to be gone.

**Done when:** the delete tests pass without any explicit commits in the routes.

### ☑ Step 15: Service layer · I§4
- Move the persistence code out of `_run_workflow_background` into `services/research_service.py` (`replace_results(project_id, papers, review)`).
- Move chat storage into `services/chat_service.py`.
- Routes then only parse the request, call a service, and return the result.

**Done when:** no route file contains business logic longer than about 15 lines, and the tests pass.

### ☑ Step 16: Remove dead code and dependencies · I§4, I§5
- Delete:
  - the `CHROMA_*` settings and the startup `mkdir` calls for `chroma` and `presentations`
  - the `Presentation` handling in the worker
  - the unused schemas: `RAGQuery`, `CitationSource`, `RAGResponse`, `PresentationOut`, `ChatMessageIn`, `PaperMetadata`
  - the unused imports in `db/base.py`
  - the `Presentation` icon import in ProjectPage
  - the empty `hooks/` and `utils/` folders, unless Step 17 fills them
- Drop the `presentations` table in migration `0003`, or keep it if you plan to bring back PPTX export.
- `requirements.txt`: remove `pandas`, `numpy` and `aiohttp`, and fix the out-of-date Chroma comment.
- Remove the `redis` service from Compose. Step 20 uses a job queue that runs on Postgres.
- Optional: move to `uv` with a lockfile.

**Done when:** `ruff` reports no unused imports, the app runs, and CI passes.

### ☑ Step 17: Frontend foundation · D§4, I§7
- TypeScript: add `tsconfig.json` with `allowJs`. Write new files in `.ts`/`.tsx`, and convert `services/api.js` and the stores first.
- Add **TanStack Query**. Replace the hand-written data fetching and `setInterval` polling with `useQuery`, where `refetchInterval` stops on a terminal status or a 404 and pauses while the tab is hidden.
- Add **Vitest** + Testing Library, with a first test for the polling logic.

**Done when:** every page behaves as before, `npm run build`, `tsc --noEmit` and `vitest` pass, there are no `setInterval` calls in `pages/`, and `react-hooks/set-state-in-effect` is set back to `error` in `eslint.config.js`.

---

> **Phase 2 notes (2026-09-19):** 78 backend, 13 unit and 6 end-to-end tests pass.
> - Step 13 also fixed existing drift: 13 columns were NOT NULL in the models but nullable in the database. The saved `error` and `comparison` columns are used already.
> - Step 14 confirmed the old "explicit commit for 204" workaround isn't needed on FastAPI 0.111. Chat now stores nothing when the LLM call fails.
> - Step 16 dropped the `presentations` table (migration 0003).
> - Step 17 surfaced a regression from Step 11 (blank optional fields returned 422), now fixed. It also added **Playwright end-to-end tests** (`npm run e2e`), which weren't in the plan, because Phase 3 moves LLM calls into the browser.
> - **Production database:** run `alembic upgrade head` (migrations 0002 and 0003) before deploying this code.

## Phase 3: Bring your own key (the deployment goal)

### ☑ Step 18: Key settings in the browser · D§1
- Create a new zustand store `llmSettings`, persisted as `researchgpt-llm` **separately** from auth. It holds `{ provider, apiKey, extractModel, synthModel }`.
- Build a `/settings` page with:
  - provider dropdown, masked key input with show and hide, model pickers
  - a **Test key** button (a list-models call sent directly to the provider)
  - a **Clear key** button
  - the note "Stored only in this browser. Sent directly to {provider}. Never sent to our servers."
- After sign-up, redirect to `/settings` if no key is set. Disable Run and Chat until the key has passed the test.
- Add a lint rule or code review checklist item: the key must never go into `console.*`, toasts, error objects or the backend `api` instance.

**Done when:** the key survives a reload, logging out does not erase it (unless the user clicks Clear), and the Network tab shows the key going **only** to the provider's domain.

### ☑ Step 19: Provider adapter and Gemini implementation · D§2, *covers I§2 "Gemini retry/timeout" and "structured parse"*
- Create `src/llm/`:
  - `types.ts`: the `LLMProvider` interface
  - `providers/gemini.ts`: uses `@google/genai`
  - `schemas.ts`: Zod schemas for paper extraction and synthesis
- `generateJSON(prompt, schema)` sends the provider's native JSON schema, validates the response with Zod, and **retries once** with the validation error when it fails. It detects responses cut off by the token limit (`finishReason`) and handles them.
- Retries with exponential backoff and jitter on 429 and 5xx, a per-request timeout, and `AbortController` cancellation.
- `stream()` for chat. A `estimateTokens()` helper.
- Vitest unit tests with mocked `fetch`: valid JSON, invalid JSON then retry, 429 then backoff, 401 → `InvalidKeyError`.

**Done when:** the adapter tests pass, and a manual test-page call returns validated JSON using your own key.

### ☑ Step 20: Replace LangGraph and the in-memory task store with a Postgres job · D§5, I§2 (task state), I§4 (LangGraph)
- Add `procrastinate` (a job queue that runs on Postgres) and a `collect_project(project_id)` job.
- Write progress to the `research_projects` columns added in Step 13.
- New endpoints:
  - `POST /projects/{id}/collect`, which enqueues the job and returns 409 if one is already running
  - `GET /projects/{id}`, which returns the progress (polled by the Step 17 query)
- Delete `agents/workflow.py`, `core/task_store.py`, the `/agents` routes and the `langgraph` and `langchain-core` dependencies. This also removes the minor `_update_progress` and unused-state-field issues.
- The Step 8 startup reset now applies to stale jobs.

**Done when:** collection survives a backend restart (the job resumes or fails cleanly), `--workers 2` works, and `grep -r langgraph backend/` finds nothing.

### ☑ Step 21: Improve collection · I§3 (parallel downloads, use PDFs), D§5 (SSRF, R6)
- Downloads: `asyncio.gather` with `Semaphore(4)`, one shared `httpx.AsyncClient`, a check for the `%PDF` magic bytes, and limits on size and page count.
- **SSRF guard:** allow only `http` and `https`, resolve the hostname and reject private, loopback and link-local addresses, allow at most 3 redirects and check each one.
- Extract the text with `pymupdf4llm` into `papers.full_text`, then **delete the PDF**. Don't keep files on disk (this satisfies R6).
- A search failure sets a clear `error` instead of silently returning `[]`.
- Tests: `respx` fixtures for a PDF, a non-PDF, an oversized file, and a redirect to `127.0.0.1` (must be blocked).

**Done when:** a collection run fills `full_text` for most arXiv papers, `storage/` stays empty, and the SSRF test passes.

### ☑ Step 22: Analysis runs in the browser (map-reduce) · D§3, *covers I§3 "per-paper findings" and "map-reduce", I§2 "comparison discarded", I§1 "prompt injection"*
- Backend endpoints (they store data only and never call an LLM):
  - `GET /projects/{id}/papers?with_text=true`
  - `PUT /papers/{id}/extraction`, which fills `paper_summaries` and `paper_findings`
  - `PUT /projects/{id}/analysis`, which stores the review, trends, gaps and comparison, and sets the status to `completed`
- A frontend `useResearchRun(projectId)` hook that:
  1. starts `collect` and waits until it finishes
  2. **map:** for each paper without an extraction, calls `generateJSON(extractSchema)` with the fast model, at most 3 at a time, and saves each result immediately
  3. **reduce:** calls `generateJSON(synthSchema)` with the stronger model over all extractions and saves the result
  4. can be resumed: reopening the page continues from the papers not yet processed
  5. can be cancelled, and shows real progress ("Extracting 6/15")
- Prompts wrap each paper in `<paper id="…">…</paper>`, say that paper content is data and not instructions, and require `[paper_id]` citations.
- Validate citations: drop or flag any cited id that is not in the project.

**Done when:** a full run completes with **no LLM calls from the server**, the paper findings table is populated, and closing the tab halfway then reopening it finishes the run.

### ☑ Step 23: Chat runs in the browser · D§3, *covers I§2 "chat memory", "persist order", "citations"*
- The browser builds the context (the extractions plus relevant `full_text` sections), includes the last 6–10 turns, and **streams** the answer.
- When the answer is complete, it calls `POST /projects/{id}/chat/messages` once with the question and the answer, including `citations: [{paper_id, …}]`. Nothing is saved on failure.
- `[paper_id]` markers render as links to the paper cards.

**Done when:** a follow-up question such as "what about the second one?" works, citations show up and link correctly, and the server has no chat LLM code.

### ☑ Step 24: Remove all LLM code from the server · D§0 (R2, R3)
- Delete `utils/gemini_client.py`, `agents/comprehensive/`, the `google-genai` dependency and the `GEMINI_*` settings.
- Add a startup check that fails if any `*_API_KEY` for an LLM provider is set while `APP_ENV=production`.
- Build the progress UI from the steps the server reports plus the browser phases (collect, then extract N/M, then synthesise). This replaces the Step 11 `STEPS` array.
- Add a CI check that fails if `backend/` contains `genai`, `openai` or `anthropic`.

**Done when:** that check passes and the full flow works with only a key in the browser.

> ✅ **At the end of Phase 3** the deployment goal works locally.

---

> **Phase 3 notes (2026-09-19):** 117 backend, 45 unit and 12 end-to-end tests pass. The e2e tests stub Gemini at the network layer and paper search on the e2e server, and they assert that no request to `/api` ever carries the key.
>
> Deviations from the plan, with reasons:
> - **Step 20:** there is no procrastinate job queue. The collection job runs in-process and writes progress and a **heartbeat** to `research_projects`. A job with a stale heartbeat is failed at startup and whenever the project is read, so it handles restarts and multiple instances without a separate worker process (which would mean a second paid instance).
> - **Step 21:** text is extracted with **pypdf** (BSD), not `pymupdf4llm`. PyMuPDF is AGPL, which carries obligations for a hosted service.
> - **Step 19:** Gemini is called through its REST API with `fetch` rather than the `@google/genai` SDK: smaller bundle, and full control over sending the key only in a header.
> - **Chat (Step 23):** fixed a history-ordering bug. A question and its answer share a timestamp, so history is now ordered by `(created_at, id)`.
> - **Found by e2e:** toasts moved to the bottom-right, because top-right toasts covered the header's action buttons.
> - **Production database:** migration 0004 turns old `running` projects into `failed` and drops `task_id` and `papers.pdf_path`. Remove `GEMINI_API_KEY` from any non-development `.env`, because the API now refuses to start with it.

## Phase 4: Harden and launch 🚀

### ☑ Step 25: Rate limits and quotas · I§1, D§5 (R5)
- `slowapi` per IP: register at 5/hour and login at 10/min.
- Per user: at most 1 collection job at a time, 20 projects per day, and at most 25 papers per run. Return 429 with a clear message when a limit is hit.

**Done when:** tests prove each limit.

### ☑ Step 26: Move auth to an httpOnly cookie with refresh tokens · I§1, D§6
- A short-lived access token (15 min) and a refresh token (7 days, rotated on each use) in `httpOnly; Secure; SameSite=Lax` cookies. Add a `/auth/refresh` endpoint and a logout that revokes the refresh token.
- CSRF protection: require a custom header (such as `X-Requested-With`) on requests that change data, together with SameSite.
- Remove the JWT from `localStorage`. The LLM key is the **only** thing left there, by design.

**Done when:** sessions last longer than an hour without re-login, and `localStorage` contains only `researchgpt-llm`.

### ☑ Step 27: Final security headers · D§1
- CSP `connect-src 'self' https://generativelanguage.googleapis.com` (add the OpenAI and Anthropic domains in Step 38).
- Add `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Permissions-Policy`.
- Confirm there are no third-party scripts.

**Done when:** securityheaders.com (or the Mozilla Observatory) gives an A.

### ☑ Step 28: Observability · I§5, D§6
- JSON logs with `request_id` and `project_id`, set through contextvars.
- Sentry on the backend and frontend. Scrub the `Authorization` and `Cookie` headers, and never capture request bodies or provider responses.
- `/health` runs `SELECT 1` against the database. Compose and the host platform use it as the health check.

**Done when:** a deliberately triggered error shows up in Sentry with no secrets in it.

### ☑ Step 29: Deploy · I§5 (Docker), D§6
- Backend image: multi-stage build, runs as a non-root user, runs `alembic upgrade head` as a **release step** (not on every container start).
- Postgres on Neon. The API on Fly.io, Render or Cloud Run with at least 2 instances. The frontend on Cloudflare Pages with an `/api/*` rewrite to the API, so everything is same-origin.
- Put the secrets in the platform's secret store. **No LLM key anywhere on the server.**
- Smoke test in production: sign up, save a key, run a project, chat, then check the Network tab for where the key goes.

**Done when:** the production smoke test passes.

### ☑ Step 30: Documentation and trust · I§6, D§6
- Rewrite `README.md` to describe the real architecture. Move features that don't exist yet under a "Roadmap" heading.
- Add a `/privacy` page, "How your key is used": where the key is stored, which domains it is sent to, how to delete it, and what the server does keep (projects, papers, chats).
- Update `claudeMD/architecture.md` and set D-19 in `decisions.md` to **Active**.

**Done when:** the README has no claims that the code doesn't back up. **Launch.**

---

> **Phase 4 notes (2026-09-19):** 135 backend, 47 unit and 15 end-to-end tests pass.
> - **Step 26:** refresh-token reuse revokes every session of that user, and the revocation is committed before the 401.
> - **Step 27:** headers are in both `nginx.conf.template` and `public/_headers`, and a test keeps them identical. The production build loads in Chrome with no CSP violations.
> - **Step 28:** no frontend Sentry (D-25). Also fixed log lines being dropped on Windows (UTF-8 stdout).
> - **Step 29:** verified on a local production-like stack (`APP_ENV=production`, secure cookies, no LLM key): 8/8 smoke and BYOK e2e tests pass through nginx, and the image refuses to start with `GEMINI_API_KEY` set. **Not yet deployed to a real host.** That needs your accounts; follow DEPLOY.md.
> - **Step 30:** added account deletion (`DELETE /auth/me`) and a `/privacy` page, and rewrote the README and the claudeMD docs.

## Phase 5: Find better papers

### ☑ Step 31: Better sources · D§3, I§3
- Add an **OpenAlex** client (turn its inverted-index abstracts back into text, and send a `mailto` for the polite pool). Replace PubMed with **Europe PMC**. Add a **Semantic Scholar API key**, plus NCBI and OpenAlex contact details, as server config.
- Add an **Unpaywall** lookup by DOI to find open-access PDFs.
- Put `arXiv` queries in quotes or join the terms with `AND`.
- Record the responses from each source and test the parsers against them with `respx`.

**Done when:** the same topic returns noticeably more papers with a PDF than before.

### ☑ Step 32: Deduplication, ranking and caching · I§3, D§5
- Deduplicate by DOI first, then by arXiv id, then by fuzzy title match (`rapidfuzz` ratio ≥ 92).
- Merge sources by alternating between them instead of concatenating them.
- Use `MAX_PAPERS_PER_SEARCH` and `MAX_PAPERS_TO_DOWNLOAD`, or delete them.
- Cache search results by `(source, normalized_query)` in Postgres with a 7-day TTL, and extracted text by DOI.

**Done when:** a second identical search makes no external calls, and the deduplication tests pass.

### ☑ Step 33: Query expansion and relevance screening in the browser · D§3
- Split collection into two steps. `POST /projects/{id}/search` accepts `{queries[]}` and returns candidate papers. `POST /projects/{id}/collect` accepts `{paper_ids[]}`.
- The browser first generates 3–5 queries from the topic, then screens up to about 60 candidate abstracts with the fast model (a 0–10 score and a reason), and keeps the top N.
- On NewProjectPage, add year-range and source filters.

**Done when:** the review page lists the selected papers with their relevance reasons.

### ☑ Step 34: Snowballing (optional) · D§3
Add a server endpoint that returns the references and citing papers of chosen papers (from OpenAlex or Semantic Scholar). The browser screens those candidates the same way as in Step 33.

**Done when:** a toggle adds citation-graph candidates to screening.

---

> **Phase 5 notes (2026-09-19):** 163 backend, 55 unit and 18 end-to-end tests pass.
> - **Sources:** Semantic Scholar, OpenAlex, arXiv (terms ANDed) and Europe PMC (replaces PubMed), plus Unpaywall for PDF links. Duplicates are matched by DOI, then arXiv ID, then fuzzy title, and results are interleaved across sources.
> - **Caches:** search results for 7 days, and extracted text reused by DOI or PDF URL.
> - **Screening:** query planning and relevance screening run in the browser. The server's `/search` stores up to 60 candidates, and `/collect` takes the chosen IDs plus relevance scores.
> - **Snowballing:** follows citations through OpenAlex, as an opt-in per project.
> - **Tests:** an autouse fixture now makes real search and PDF calls fail loudly, after one test fell through to the live APIs.
> - **Migrations:** 0006 to 0008.

## Phase 6: Read papers more deeply

### ☑ Step 35: Send the PDF itself to the model · D§2, D§5
- Add `GET /papers/{id}/pdf`, which fetches the PDF through the SSRF guard and streams it to the client without saving it.
- For providers that support PDF input, the map step sends the PDF itself. Otherwise it falls back to `full_text`.
- Optional: use GROBID for section-level structure and parsed references.

**Done when:** extractions for papers that contain tables include the numbers from those tables.

### ☑ Step 36: Trustworthy output and exports · D§3, I§7
- Add a citation check: each claim carries a supporting quote, and a cheap call confirms the quote supports the claim. Unsupported claims are flagged in the UI.
- Make inline `[n]` citations in the review link to the paper cards. Add a comparison table tab.
- Add **BibTeX/RIS** export of the paper list, and PDF/DOCX export of the review.

**Done when:** each claim in the review links to a paper, and the BibTeX file imports into Zotero.

### ☑ Step 37: Measure quality · I§3
- Store the prompt version, model, and token usage reported by the client for each run.
- Build a small evaluation set of 5–10 fixed topics and a script that compares review quality across prompt versions.

**Done when:** you can say whether a prompt change made results better or worse.

> **Phase 6 notes (2026-09-19):** 170 backend, 71 unit and 19 end-to-end tests pass.
> - **PDF input:** for models that accept PDFs (Gemini), the browser sends the PDF itself, fetched through `GET /papers/{project}/{paper}/pdf` (SSRF-guarded, streamed, never stored). It falls back to the extracted text if the model rejects the PDF. This is opt-in in Settings, because PDFs cost more tokens. GROBID was not added.
> - **Citation check:** not implemented as "a quote for each claim". After the review is written, every sentence that cites papers (up to 40) is checked in batches of 10 against the cited papers' extracted findings. Each claim gets a verdict of supported, partly or unsupported. The check is best effort: if it fails, the review is still saved. Results are in a *Citation check* tab, and a banner shows how many claims are flagged.
> - **Citations and exports:** `[P12]` markers render as numbered links, in order of first citation, with a References tab. The comparison table was already a tab. Exports are built in the browser: Markdown, BibTeX, RIS, and Print / Save as PDF through a print stylesheet. **DOCX was skipped**, because Markdown opens in Word and Google Docs and a DOCX library would add about 300 kB.
> - **Quality:** each review stores `run_meta`: prompt version, models, per-model token usage for the whole run (a metering wrapper around the provider), duration, and invented citations removed. `scripts/eval_reviews.py` compares prompt versions on the fixed topics in `eval/topics.json`; see `eval/README.md`. It uses no LLM judge, so evaluation costs no extra tokens.
> - **Bug found along the way:** Tailwind's `content` glob covered only `.js`/`.jsx`, so classes used only in the new `.tsx` files were missing from the CSS.
> - **Migrations:** 0009 and 0010.

---

## Phase 7: Scale and polish

### ☐ Step 38: More providers and model tiers · D§2
- Add the OpenAI and Anthropic adapters, and add their domains to the CSP `connect-src`.
- Default fast and strong model for each provider, which the user can override.
- Show a cost estimate before each run, using `estimateTokens()` and a per-model price table the user can edit.

**Done when:** a full run works with each provider.

### ☐ Step 39: RAG for large projects · D§3, I§3
- Enable pgvector. The **browser** computes embeddings with the user's key and uploads the vectors, so the key still never reaches the server.
- Add a search endpoint that combines keyword search (Postgres full-text) with vector search. Chat switches to retrieval once a project has more than about 30 papers.

**Done when:** chat on a 50-paper project answers with citations and stays within the model's context limit.

### ☐ Step 40: Product and UX · I§7, D§4
- Keep a history of runs and compare them, instead of replacing the old results.
- Manual paper control: remove a paper, add one by DOI or arXiv id, or upload a PDF, then re-run the analysis only.
- Dashboard: search, filter by status, paper count on each card.
- Use shadcn/ui components. Accessibility: ARIA roles on tabs and steps, `aria-label` on icon buttons, and full keyboard navigation.

**Done when:** a Lighthouse accessibility score of at least 95 and the listed features work.

---

## Traceability: every issue mapped to a step

| Issue | Source | Step |
|---|---|---|
| IDOR on papers, reviews and chat | I§1 | 5 |
| `/agents/status` without auth | I§1 | 6 (the route is removed in 20) |
| Default `SECRET_KEY` | I§1 | 7 |
| python-jose / passlib | I§1 | 12 |
| No input validation | I§1 | 11 |
| Error text leaked to users | I§1 | 11 |
| No rate limiting | I§1, D§5 | 25 |
| Refresh tokens, JWT in localStorage, `is_active` | I§1 | 26, 11 |
| Prompt injection | I§1 | 22, 23 |
| Compose secrets and published ports | I§1 | 7 |
| Projects stuck in `running` | I§2 | 8, then 20 |
| In-memory task state | I§2 | 20 |
| Failures shown as "Completed" | I§2 | 11, 22 |
| Structured output parsing | I§2 | 19 |
| Gemini retry and timeout | I§2 | 19 |
| `STEPS` mismatch | I§2 | 11, then 24 |
| Chat citations | I§2 | 11, 23 |
| `comparison` discarded | I§2 | 13, 22 |
| Chat memory | I§2 | 23 |
| Chat save order | I§2 | 23 |
| Transaction pattern | I§2 | 14 |
| `_update_progress` import, unused state fields | I§2 | 20 (deleted) |
| arXiv query quoting | I§2 | 31 |
| Search failures swallowed | I§2 | 21 |
| Timezones, FK indexes, cascades | I§2 | 13 |
| SQL echo tied to DEBUG | I§2 | 7 |
| PDFs downloaded but unused | I§3 | 21, 35 |
| Empty per-paper findings | I§3 | 22 |
| RAG with pgvector | I§3, D§3 | 39 |
| Map-reduce analysis | I§3, D§3 | 22 |
| Search ranking, dedup, keys, unused settings, filters | I§3 | 31, 32, 33 |
| Sequential downloads | I§3 | 21 |
| Streaming | I§3 | 19, 23 |
| Quality measurement | I§3 | 37 |
| Service layer | I§4 | 15 |
| Keep or drop LangGraph | I§4 | 20 (dropped) |
| Storage abstraction | I§4 | 21 (PDFs discarded instead) |
| Dead code | I§4 | 16 |
| requirements.txt | I§4 | 16 |
| Tests (API, agents, frontend) | I§5 | 3, 5+, 17, 19, 21 |
| CI and linting | I§5 | 2, 4 |
| `.dockerignore` | I§5 | 9 |
| Redis service, `version:` key | I§5 | 7, 16 |
| Real health check | I§5 | 28 |
| Multi-stage, non-root image | I§5 | 29 |
| Node version, `npm ci` | I§5 | 9 |
| README drift | I§6 | 30 |
| Re-run and compare runs | I§7 | 11, 40 |
| Exports | I§7 | 36 |
| Manual paper control | I§7 | 40 |
| Inline citations | I§7 | 36 |
| react-markdown | I§7, D§4 | 10 |
| Polling | I§7 | 17 |
| Dashboard, accessibility | I§7 | 40 |
| R1/R2: key never persisted or seen by the server | D§0–1 | 18, 22, 23, 24 |
| R3: no server LLM key | D§0 | 24 |
| R4: XSS / CSP | D§0–1 | 10, 27 |
| R5: abuse limits | D§0 | 25 |
| R6: temporary disks | D§0 | 21 |
| Key settings UI and onboarding | D§1, D§4 | 18 |
| Provider adapter, Zod, model tiers | D§2 | 19, 38 |
| Native PDF input | D§2 | 35 |
| Query expansion, screening, snowballing | D§3 | 33, 34 |
| OpenAlex, Europe PMC, Unpaywall | D§3 | 31 |
| Citation verification, BibTeX | D§3 | 22, 36 |
| TypeScript, TanStack Query, Vitest | D§4 | 17 |
| shadcn/ui | D§4 | 40 |
| Job runner on Postgres | D§5 | 20 |
| Caching | D§5 | 32 |
| Server-owned data-API keys | D§5 | 31 |
| SSRF guard | D§5 | 21 |
| Sentry scrubbing, JSON logs | D§6 | 28 |
| Same-origin deployment, privacy page | D§6 | 29, 30 |
