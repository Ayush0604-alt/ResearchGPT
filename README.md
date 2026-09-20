<div align="center">

# 🔬 ResearchGPT

**AI literature reviews with your own API key**

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/postgresql-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Gemini](https://img.shields.io/badge/Gemini-%238E75B2.svg?style=for-the-badge&logo=googlebard&logoColor=white)](https://aistudio.google.com/)
[![Claude](https://img.shields.io/badge/Claude-%23D97757.svg?style=for-the-badge&logo=anthropic&logoColor=white)](https://console.anthropic.com/)
[![OpenAI](https://img.shields.io/badge/OpenAI-%23412991.svg?style=for-the-badge&logo=openai&logoColor=white)](https://platform.openai.com/)

*Give it a research topic. It finds papers, reads the open-access ones, and writes a cited literature review you can chat with.*

</div>

---

## 📖 How it works

1. **You add your own API key** — Gemini, Claude or OpenAI. It is stored only in your browser and sent only to that provider. The ResearchGPT server never sees it and holds no LLM key of its own.
2. **Your browser plans the search and screens the results.** It turns the topic into queries, then rates each candidate the server found for relevance and picks the best ones (optionally following their citations too).
3. **The server collects the chosen papers.** It searches Semantic Scholar, OpenAlex, arXiv, Europe PMC and Unpaywall, downloads open-access PDFs through an SSRF-safe fetcher, and extracts their text. PDFs are read in memory and never stored.
4. **Your browser analyses them** with your key, as a map-reduce:
   - **Map:** one structured extraction per paper (summary, method, models, data, results, limitations, verbatim quotes), three at a time — the PDF itself where the model reads PDFs. Each is saved as soon as it finishes, so an interrupted run resumes where it stopped.
   - **Reduce:** one review over all the extractions (introduction, thematic survey, comparison table, trends, gaps, discussion), where every claim cites a paper as `[P12]`. Citations to papers that don't exist are removed.
   - **Check:** every cited sentence is checked against what was extracted from the papers it cites, and anything unsupported is flagged.
5. **You read and export it.** Numbered references, a citation-check tab, Markdown, BibTeX, RIS and print/PDF, plus the history of earlier runs to compare against.
6. **You chat with the papers.** Answers stream in, quote the passages that match your question, cite their sources, and remember the conversation.

You can also add a paper the search missed by DOI or arXiv id, upload a PDF, or remove one, and then update the review.

---

## 🏗️ Architecture

```text
Browser (React + TypeScript)
 ├── /api/*  ──────────────▶  FastAPI  ──▶  PostgreSQL
 │     auth cookies, projects,   │  search (cached) · collection job: fetch PDFs → text
 │     papers, saved results,    │  passage search for chat · run history
 │     passages                  └─▶  Semantic Scholar · OpenAlex · arXiv · Europe PMC
 │
 └── user's key ───────────▶  Gemini · Claude · OpenAI   (screening, extraction, review, chat)
```

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind, TanStack Query, Zod |
| Backend | FastAPI (async), SQLAlchemy 2 (async), Alembic, pypdf |
| LLM | Gemini and OpenAI over REST, Claude through the official SDK — all called from the browser with the user's key |
| Database | PostgreSQL |
| Tests | pytest (API), Vitest (UI and LLM layer), Playwright (end to end, incl. axe accessibility) |

### Design decisions

- **Bring your own key, in the browser.** Hosting costs don't depend on LLM usage, users control their own spending, and the key can't leak from our servers because it never reaches them. The trade-off is that the analysis runs in the tab, so it's resumable by design.
- **From 10 LangGraph nodes to map-reduce.** The first version ran a 10-node LangGraph pipeline on the server. It was slow and costly and kept hitting rate limits, so it became three batched nodes, and finally a browser-side map-reduce. That version reads full papers (not just abstracts), fills structured findings per paper, and is resumable.
- **A heartbeat instead of a job queue.** The collection job writes progress and a heartbeat to Postgres. Dead jobs are detected by a stale heartbeat, which works across restarts and multiple instances without a separate worker.
- **Keyword retrieval, not embeddings.** A project holds at most 25 papers, so chat finds the passages it needs with Postgres full-text search over the papers' text. Embeddings would have to be computed in the browser with the user's key for a corpus small enough that keywords answer it.
- **Every run is measured and kept.** Each review records its prompt version, models and token usage; the last ten runs stay comparable in a History tab, and `backend/scripts/eval_reviews.py` compares prompt versions over a fixed set of topics.
- **Security for a key-in-the-browser app:**
  - a strict CSP (scripts only from our own origin; connections only to our API and the three LLM providers)
  - sessions in httpOnly cookies with rotating refresh tokens
  - a CSRF header check, and all Markdown rendered through sanitisation

The full reasoning is in [`claudeMD/decisions.md`](claudeMD/decisions.md), and the code map is in [`claudeMD/architecture.md`](claudeMD/architecture.md).

---

## ⚡ Local development

**Prerequisites:** Python 3.11+, Node 22+, Docker (for Postgres), and an API key from [Google](https://aistudio.google.com/app/apikey), [Anthropic](https://console.anthropic.com/settings/keys) or [OpenAI](https://platform.openai.com/api-keys), which you enter in the app, not in a file.

```bash
# 1. Database
cp .env.example .env                  # set POSTGRES_PASSWORD
docker compose up -d db

# 2. Backend
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                  # set DATABASE_URL / SYNC_DATABASE_URL to the db above
alembic upgrade head
uvicorn main:app --reload --port 8000

# 3. Frontend (new terminal)
cd frontend
npm ci
npm run dev                           # http://localhost:5173 (proxies /api to :8000)
```

Sign up, paste your key in **Settings**, create a project and click **Run analysis**.

Full stack in Docker: `docker compose up --build`, then open http://localhost:5173.

### Tests

```bash
docker compose -f docker-compose.test.yml up -d   # throwaway Postgres on :55432

cd backend  && pytest                          # API, collection job, security, migrations
cd frontend && npm test                        # UI, LLM layer, analysis orchestration
cd frontend && npm run e2e                     # Playwright: real browser, real API, stubbed providers
```

CI runs all three, plus linting, type-checking and an `alembic check` for model and migration drift.

---

## 🚀 Deployment

See [DEPLOY.md](DEPLOY.md): two containers plus Postgres, the environment checklist, migrations as a release step, and how to verify a deployment. The server refuses to start in production with a weak `SECRET_KEY`, insecure cookies, or any LLM key configured.

## 🔐 Privacy

The in-app **How your key and data are used** page (`/privacy`) explains exactly what is stored and what is sent where. Accounts can be deleted, along with all their data, from Settings.

---

## 🗺️ What's next

Everything in [`claudeMD/fix-plan.md`](claudeMD/fix-plan.md) is done — five paper sources with
relevance screening and citation following, full PDFs to the model, claim-level citation checks,
BibTeX/RIS export, three providers with model tiers and cost estimates, retrieval for chat, run
history and manual paper control.

Still open, and deliberately so:
- **DOCX export** (Markdown opens in Word and Google Docs) and **GROBID** section parsing.
- **pgvector**, if projects ever hold hundreds of papers instead of dozens.
- A **Lighthouse** run: accessibility is checked by axe in the e2e suite instead.

---

## 👤 Author

Built by [Ayush](https://github.com/Ayush0604-alt).
