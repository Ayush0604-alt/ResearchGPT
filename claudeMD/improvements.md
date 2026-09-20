# ResearchGPT — Improvements

> **Status (2026-09-20): every item is fixed or superseded**, §7 included (re-run, readable review,
> exports, polling, privacy, run history, manual paper control, accessibility). This document is kept
> as the record of what was wrong. For where each item was fixed, see the traceability table in
> [fix-plan.md](fix-plan.md), whose phase notes also list what was skipped on purpose.

These come from a full read of the codebase at `1446fba`. File paths below are
as they were at that commit: several no longer exist, because the server-side
Gemini and agent code was deleted and the pages were moved to TypeScript. Those
appear as plain `paths` rather than links.

Items are grouped by theme and tagged with a priority:

- **P0**: a bug or security hole; fix it before anyone else uses the app
- **P1**: correctness or reliability; users will run into it
- **P2**: a feature or quality gain
- **P3**: polish, developer experience or hygiene

Effort estimates: **S** is under 1 hour, **M** is half a day, **L** is 1–3 days.

> This file covers fixes to the **current** design. The redesign for the deployment
> goal (a public app where users bring their own LLM key, kept only in `localStorage`)
> and the better-results pipeline are in [design-improvements.md](design-improvements.md).
> Under that goal, the §1 security items become required before launch.

---

## Quick wins (do these first)

| # | Item | Pri | Effort |
|---|---|---|---|
| 1 | Add project-ownership checks to the papers, reviews and chat routes | P0 | S |
| 2 | Require auth on `/agents/status` and check the task belongs to the user | P0 | S |
| 3 | Refuse to start when `SECRET_KEY` is the default outside dev | P0 | S |
| 4 | Recover projects stuck in `running` after a restart | P0 | S |
| 5 | Fix the `STEPS` array on ProjectPage to match the 3-node pipeline | P1 | S |
| 6 | Fix the chat citation key mismatch (`sources` vs `citations`) | P1 | S |
| 7 | Mark the run FAILED, not COMPLETED, when analysis returns nothing | P1 | S |
| 8 | Add `.dockerignore` files (and stop git-ignoring them) | P1 | S |
| 9 | Update the README so it matches the code | P1 | S |

---

## 1. Security

### P0: Missing ownership checks (IDOR)
[papers.py](../backend/app/api/routes/papers.py), [reviews.py](../backend/app/api/routes/reviews.py)
and [chat.py](../backend/app/api/routes/chat.py) accept any `project_id` without
checking that the project belongs to the caller. Any logged-in user can:
- read another user's papers, review and chat history
- **delete** another user's chat history
- post chat messages into another user's project

A non-existent `project_id` on `/chat/query` causes a 500 error (FK violation).

The README says ownership is "enforced server-side", which is not currently true.

**Fix:** Add one reusable dependency and use it on every project-scoped route:
```python
async def get_owned_project(project_id: int, db=Depends(get_db),
                            user_id: int = Depends(get_current_user_id)) -> ResearchProject:
    project = await db.scalar(select(ResearchProject).where(
        ResearchProject.id == project_id, ResearchProject.user_id == user_id))
    if not project:
        raise HTTPException(404, "Project not found")
    return project
```
For `/chat/query`, `project_id` is in the request body, so check it inside the handler.

### P0: `/agents/status/{task_id}` has no authentication
`agents.py:80`. Task ids can be guessed
(`task_{project}_{user}_{unix_ts}`). **Fix:** Require the JWT, and store `user_id` in
the task entry so the route can compare them. Or drop task ids and serve status
from `GET /projects/{id}` (this becomes natural once §2 moves status into the database).

### P0: Insecure default `SECRET_KEY`
[config.py:28](../backend/app/core/config.py#L28) sets a readable default. If `.env`
leaves it unset, anyone who knows the default can forge tokens.
**Fix:** Remove the default, or add a startup check that raises when `APP_ENV != "development"` and the key is the default value or shorter than 32 characters.

### P1: Unmaintained auth libraries
python-jose has known CVEs and is no longer maintained. passlib is abandoned, which
is why `bcrypt==3.2.0` has to be pinned. **Fix:** Switch to `PyJWT`, and to `bcrypt`
directly or `pwdlib[bcrypt]`.

### P1: No password or input rules
`UserRegister.password` and `username` accept any string, including an empty one.
`ProjectCreate.topic` has no length limit, and `AgentRunRequest.max_papers` is not
bounded, so it could be 10,000. **Fix:** Add Pydantic `Field(min_length=…, max_length=…, ge=1, le=…)` constraints.

### P1: Error text sent to users
Two places send raw exception text to clients:
- [chat.py:95](../backend/app/api/routes/chat.py#L95) saves `f"Sorry, I encountered an error: {e}"` as the assistant message, which can expose internal details.
- The task `error` field returns `str(e)` to the UI.

**Fix:** Log the full error and return a generic message.

### P2: No rate limiting
A logged-in user can start as many pipeline runs and chat calls as they like, and
every one costs Gemini quota. **Fix:** Use `slowapi` or a simple per-user limit.
Limit concurrent runs per user to one, which the database status already makes possible.

### P2: Token handling
- There is no refresh token, so users are logged out every 60 minutes.
- The token sits in localStorage.
- Deactivated users keep access until their token expires, because `get_current_user_id` never loads the user.

**Fix:** Add refresh tokens, stored in an httpOnly cookie. Check `is_active` in the dependency.

### P2: Prompt injection through paper abstracts
The analysis and chat prompts paste untrusted abstracts and user questions straight
in. **Fix:** Put the paper content inside clear delimiters, such as `<paper id=…>…</paper>`.
Tell the model to treat that content as data. Keep the system instructions in `system_instruction`.

### P3: Docker Compose secrets
- The Postgres password `password` is hard-coded.
- Postgres (5432) and Redis (6379) are published on the host.

**Fix:** Read the password from `.env`, and don't publish the database ports outside dev.

---

## 2. Reliability and correctness

### P0: Projects stuck in `running` after a restart
When the process restarts, `_task_store` is emptied but the project row keeps
`status = running`:
- `POST /agents/run` answers "Already running".
- The UI polls a task id that now returns 404. `ProjectPage.jsx:104` ignores polling errors, so the spinner runs forever.
- The Run button is hidden while the status is `running`.

**Fix (minimal):**
- On startup, set every `running` project to `failed` (in `lifespan`).
- In `run_agents`, treat a `running` project whose `task_id` is not in `_task_store` as stale.
- In the UI, stop polling after a 404.

**Fix (proper):** See the next item.

### P1: Move task state out of process memory
The in-memory dict prevents running more than one worker and loses all progress on
restart. Two options:
- **Option A (small change):** Add `progress`, `current_agent`, `error` and `started_at` columns to `research_projects`, write progress to the database, and poll `GET /projects/{id}`.
- **Option B (scales):** Use arq, or Celery with the Redis container that already exists, as the job runner, and store progress in Redis.

Option A alone fixes most problems.

### P1: Failures reported as "Completed"
`comprehensive/agent.py:72-84`
returns an empty result when the JSON cannot be parsed or Gemini fails. The worker
then marks the project **Completed** with no review, and the review page says "Run
the pipeline first". The UI hides that button on completed projects, so the user is stuck.

The same happens when the search finds zero papers.

**Fix:**
- Raise an error when the result is empty, or add a `completed_with_warnings` status that carries a reason.
- Let completed projects be re-run from the UI.

### P1: Parse structured output properly
The agent asks for a `response_schema` but then cuts the text from `{` to `}` and calls
`json.loads`. **Fix:** Use `response.parsed` from google-genai, or `ComprehensiveAnalysisSchema.model_validate_json(text)`.
Check `finish_reason == MAX_TOKENS` so a response cut off by the 8,000-token limit
is detected and retried, perhaps with fewer papers.

### P1: Gemini client has no retry and no timeout
`gemini_client.py` has no timeout and no
retry on 5xx or temporary 429 errors, and it detects 429 by matching the error
text. **Fix:**
- Check `google.genai.errors.APIError.code == 429`.
- Retry with tenacity: exponential backoff with jitter, 2–3 attempts.
- Set an `http_options` timeout.

### P1: Frontend progress UI does not match the backend
`ProjectPage.jsx:11-15` lists the 9
steps of the old pipeline. The backend reports `Paper Search`, `Paper Collection`
and `Comprehensive Analysis`. The last one is not in the list, so `findIndex` returns
−1 and the step dots stop during the longest step.

**Fix:** Set `STEPS = ['Paper Search', 'Paper Collection', 'Comprehensive Analysis']`.
Better still, have the backend return the list of steps.

### P1: Chat citations never render
The backend returns `{answer, sources: []}`. `ChatPage.jsx:50`
reads `data.citations`. **Fix:** Agree on one name. Return real sources, at least the
paper numbers `[n]` the model cited, mapped back to paper ids, and save them in `ChatMessage.citations`.

### P1: `comparison` is generated and thrown away
Gemini writes a comparison section on every run. `node_comprehensive_analysis`
returns it, but the worker never saves it and the UI has no tab for it. **Fix:** Save
it (add a column on `literature_reviews`) and show it, or remove it from the schema to save output tokens.

### P2: Chat has no conversation memory
Each question is sent on its own. Follow-up questions like "what about the second
one?" fail. **Fix:** Include the last *N* messages in the Gemini `contents` list.

### P2: Chat saves the user message before the answer
The user message is committed first. If Gemini fails, the database holds a question
with an error string as its answer. Meanwhile the frontend removes the user message
from the screen and puts it back in the input. **Fix:** Save both messages together
after the answer arrives, or save a `failed` flag.

### P2: One transaction pattern
Choose one approach. Either `get_db` owns the commit and routes only `flush`, or
routes commit and `get_db` only closes. Then remove the per-route workarounds (decisions.md D-12).

### P3: Smaller correctness issues
- `_update_progress` imports `_task_store` from `app.api.routes.agents`, a route module. Import it from `app.core.task_store`.
- `ResearchState.presentation` and `errors` are never used. Either fill `errors` and show it in the UI, or remove both fields.
- The arXiv query `all:{topic}` is not quoted, so multi-word topics are treated as OR/AND terms in odd ways. Use `all:"{topic}"`, or split the topic into `AND`-joined terms.
- `node_paper_search` swallows all exceptions. A total search failure then looks like "no papers".
- `DateTime` columns have no timezone. Use `DateTime(timezone=True)`.
- Add indexes on the `project_id` and `paper_id` foreign keys, and use `ondelete="CASCADE"` so deletes that bypass the ORM also work.
- `echo=settings.DEBUG`, and `DEBUG` defaults to `True`, so every SQL statement is logged by default.

---

## 3. Pipeline quality (the AI part)

### P1: Use the PDFs, or stop downloading them
Every run downloads up to 10 PDFs, and nothing reads them. Choose one:
- **Stop:** Remove the collection step. It saves time, bandwidth and disk.
- **Use:** Extract the text with `pypdf` or `pymupdf`. Pass a trimmed version (for example abstract, methods and conclusion, or the first *N* thousand tokens per paper) to the analysis step. Gemini 2.5 Flash has a 1M-token context, so 10 full papers fit without any RAG.

The **Use** option is the best improvement in quality per hour of work.

### P1: Bring per-paper findings back, cheaply
The `paper_summaries` and `paper_findings` tables and their endpoints are still
there but never filled. Add a `papers: list[PaperFinding]` field (summary,
methodology, model, dataset, accuracy, limitations) to `ComprehensiveAnalysisSchema`.
One call then fills them too, with no extra requests, and the D-5 cost goal still holds.
Show them in a table on the project page.

### P2: Bring real RAG back for chat, when it's needed
Once full text is in use (above), putting all 10 papers into every chat call gets
expensive. Store chunks and embeddings in **pgvector**, in the Postgres database you
already run, rather than adding ChromaDB back. Embed with `gemini-embedding-001`,
retrieve the top-k chunks, and return chunk-level citations. This keeps the stack
at one database and avoids the Windows install problems that probably led to
removing Chroma (decisions.md D-7).

### P2: Split the analysis into two calls with a map-reduce shape
Consider a middle ground between 10 calls and 1:
1. **Map:** Extract structured findings per paper. Run these with `asyncio.gather` under a semaphore, cache them, and skip them on re-runs.
2. **Reduce:** Make one synthesis call over the extracted findings.

This gives cheaper retries, better grounding, and real progress updates. LangGraph's
`Send` API can fan out the map step, which gives D-4 a real reason to use LangGraph.

### P2: Improve search ranking and deduplication
- Deduplicate on DOI or arXiv id first, and use the title only as a fallback. Semantic Scholar returns `externalIds.DOI` / `ArXiv`, which the code already requests.
- Merge the sources by alternating between them, or rank them. The current approach fills the list from Semantic Scholar first, then arXiv.
- Add optional API keys: `SEMANTIC_SCHOLAR_API_KEY` and NCBI `api_key` / `email`. Keyless Semantic Scholar is heavily rate-limited.
- Use the currently unused `MAX_PAPERS_PER_SEARCH` / `MAX_PAPERS_TO_DOWNLOAD` settings, or delete them.
- Let the user set year ranges and a source filter on NewProjectPage.

### P2: Download PDFs in parallel
`workflow.py:72-78` downloads PDFs one
at a time. Use `asyncio.gather` with `asyncio.Semaphore(4)` and one shared
`httpx.AsyncClient`. The collection agent also opens a new client for each request.
Validate the `%PDF` header, not just the content-type.

### P2: Stream Gemini output
The analysis call can take 20–60 s with no feedback. Use `generate_content_stream`
and send progress to the UI through Server-Sent Events. Do the same for chat answers,
which makes the chat feel much faster.

### P3: Measure quality
Save the prompt version, model, token usage (`response.usage_metadata`) and cost
for each run. Add a small set of test topics to check whether a prompt change helps or hurts.

---

## 4. Architecture and code structure

- **P2: Fill `services/`.** Routes contain business logic, for example the ~130-line persistence code in `_run_workflow_background`. Move it into `services/research_service.py` (run and persist), `services/chat_service.py` and so on. Routes then only handle HTTP.
- **P2: Keep LangGraph only if you use it.** Either use its features (conditional edges such as "no papers → end early with a clear status", checkpointing to resume after a crash, the `Send` fan-out from §3), or replace it with three plain `await` calls and drop the dependency.
- **P2: Add a storage abstraction.** Define `Storage` with `LocalStorage` and `S3Storage` implementations chosen by `USE_S3`. This makes the "S3-ready" claim in D-16 true. Treat vector storage the same way if RAG comes back.
- **P3: Delete dead code and configuration:**
  - `CHROMA_*` settings, and the `storage/chroma` and `storage/presentations` directories created at startup
  - `Presentation` handling in the worker
  - the `RAGQuery`, `CitationSource`, `RAGResponse`, `PresentationOut`, `ChatMessageIn` and `PaperMetadata` schemas
  - `MappedColumn`, `Integer` and `mapped_column` imports in `db/base.py`
  - the `Presentation` icon import in ProjectPage
  - the empty `hooks/`, `utils/` and `services/` folders, unless you fill them
- **P3: Keep `requirements.txt` accurate.** Remove the unused `pandas`, `numpy` and `aiohttp`. Pin `google-genai` to a real version range; `>=0.1.2` allows any version. Remove the out-of-date comment about "0.8.x / chromadb". Consider `uv` with a lockfile.

---

## 5. Testing, CI and developer experience

`pytest` is in `requirements.txt` but there are **no tests**. Suggested order:

1. **P1: API tests** (pytest-asyncio + httpx `AsyncClient` + a throwaway Postgres or testcontainers):
   - auth
   - project CRUD
   - **ownership tests for every project-scoped route**, to stop the IDOR from coming back
2. **P1: Agent unit tests.** Use `respx` to fake the HTTP calls and test search parsing and deduplication against recorded arXiv, PubMed and Semantic Scholar responses. Fake `ask_gemini` to test the empty, truncated and 429 cases.
3. **P2: Frontend tests.** Vitest + Testing Library for `renderMd` (it's an easy target for XSS mistakes) and the polling logic.
4. **P2: CI.** A GitHub Actions workflow that runs `ruff`, `pytest`, `npm ci`, `npm run build` and `eslint`.
5. **P3: Tooling:**
   - add `ruff` + `black` (or `ruff format`) and `pre-commit`
   - add ESLint + Prettier to the frontend (neither is set up now)
   - check that the Alembic models match the migrations (`alembic check`)

### Docker and deployment
- **P1:** There is no `.dockerignore`, and the root `.gitignore` ignores `.dockerignore` itself (line 39). As a result, `COPY . .` copies the local **Windows `venv/`, `storage/` and `.env`** into the backend image, and the Windows **`node_modules/`** into the frontend build. Windows `node_modules` can break the esbuild binary on Alpine. Add both `.dockerignore` files and remove that line from `.gitignore`.
- **P2:** Remove the unused `redis` service, or start using it (see §2). Remove the obsolete `version:` key.
- **P2:** Add a real health check. `/health` should confirm the database is reachable, and Compose should wait on it before starting the frontend.
- **P3:** Multi-stage backend image, running as a non-root user.
- **P3:** Upgrade `node:18` (end of life) to `node:20` or `22`, and use `npm ci` instead of `npm install`.

---

## 6. Documentation drift

The **uncommitted** `README.md` changes currently describe features that were
removed in `26966f6`. Update the README, or build those features back:

| README says | Code reality |
|---|---|
| "Vector DB: ChromaDB (Pinecone-ready)" | No vector database. Chroma was removed. |
| Collection "extracts text, chunks it, and indexes it into ChromaDB" | It only downloads PDFs. No text extraction or indexing happens. |
| "RAG-powered Conversational Q&A … with exact citations" | Abstracts are pasted into the prompt, and there are no citations. |
| Analysis "extracts structured JSON … for each paper" | The schema has no per-paper fields, and `paper_findings` stays empty. |
| "📑 PowerPoint Export" | Removed. |
| Endpoints `/api/v1/...`, `/rag/query`, `/presentations/.../download` | The prefix is `/api`, and neither endpoint exists. The real chat endpoint is `/chat/query`. |
| "Ownership checks: every … resource is scoped … server-side" | Only true for projects and agents (see §1). |
| "Async Task Processing" | True, but in-process only (see §2). |
| `ChatMessage` "citations linking back to ChromaDB chunks" | `citations` is always null. |
| `hooks/`, `utils/`, `services/` directories with contents | They are empty. |

Suggested fix: Keep one honest "Architecture" section that links to
[architecture.md](architecture.md). Put removed features under a "Roadmap" heading
instead of listing them as features.

---

## 7. Product and UX ideas (P2–P3)

- **Re-run and refresh** a completed project, and **compare runs** (keep history instead of replacing it).
- **Export options:** PDF/DOCX review export, and BibTeX/RIS export of the paper list. BibTeX is very useful to researchers and cheap to build.
- **Manual paper control:** remove irrelevant papers, add a paper by DOI or arXiv id, or upload your own PDF, and then re-run the analysis only.
- **Inline citations in the review:** keep the model's `[n]` markers and link them to the paper cards.
- **Use a real Markdown library** (`react-markdown` + `remark-gfm` + `rehype-sanitize`) in place of `renderMd`. It adds links, code blocks and nested lists safely, and render the chat answers as Markdown too.
- **Better polling:** back off, pause while the tab is hidden, and stop on 404. Or switch to SSE (§3).
- **Dashboard:** search, sort by status, and a paper count on each card.
- **Accessibility:** the step dots and tabs have no ARIA roles, and the icon-only buttons need `aria-label`s.
