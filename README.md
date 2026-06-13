# ResearchGPT 🔬

> Production-grade AI Research Assistant Platform — automates the full research workflow from paper discovery to literature review and presentation generation.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TailwindCSS |
| Backend | FastAPI + Python 3.11 |
| AI Orchestration | LangGraph |
| LLM | Gemini 2.5 Flash |
| Database | PostgreSQL |
| Vector DB | ChromaDB (Pinecone-ready) |
| Storage | Local (S3-ready) |
| Migrations | Alembic |
| ORM | SQLAlchemy |

---

## Project Structure

```
ResearchGPT/
├── backend/
│   ├── app/
│   │   ├── api/routes/          # FastAPI route handlers
│   │   ├── agents/              # 10 LangGraph agents
│   │   ├── core/                # Config, security, logging
│   │   ├── db/                  # DB session, base
│   │   ├── models/              # SQLAlchemy ORM models
│   │   ├── schemas/             # Pydantic schemas
│   │   ├── services/            # Business logic layer
│   │   ├── rag/                 # RAG pipeline
│   │   └── utils/               # Helpers
│   ├── alembic/                 # DB migrations
│   ├── storage/pdfs/            # Downloaded PDFs
│   ├── .env                     # Environment variables
│   ├── requirements.txt
│   └── main.py
├── frontend/
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   ├── pages/               # Route-level pages
│   │   ├── hooks/               # Custom React hooks
│   │   ├── services/            # API client functions
│   │   ├── store/               # Zustand state management
│   │   └── styles/              # Global CSS
│   ├── package.json
│   └── vite.config.js
└── docker-compose.yml
```

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- PostgreSQL 15+
- Google Gemini API Key → https://aistudio.google.com/app/apikey

---

## Quick Start

### 1. Clone & Navigate

```bash
git clone <your-repo-url>
cd ResearchGPT
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment file and fill in values
cp .env.example .env
# Edit .env with your API keys and DB credentials

# Create PostgreSQL database
createdb researchgpt
# Or via psql: CREATE DATABASE researchgpt;

# Run migrations
alembic upgrade head

# Start backend
uvicorn main:app --reload --port 8000
```

Backend runs at: http://localhost:8000
API Docs at: http://localhost:8000/docs

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend runs at: http://localhost:5173

### 4. Docker (Optional — All-in-One)

```bash
# From project root
docker-compose up --build
```

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in:

```env
# Required
GEMINI_API_KEY=your_gemini_api_key_here
DATABASE_URL=postgresql://user:password@localhost:5432/researchgpt
SECRET_KEY=your_jwt_secret_key_here_min_32_chars

# Optional — leave defaults for local dev
CHROMA_PERSIST_DIR=./storage/chroma
PDF_STORAGE_DIR=./storage/pdfs
CORS_ORIGINS=["http://localhost:5173"]

# Future: AWS S3
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_S3_BUCKET=

# Future: Pinecone
# PINECONE_API_KEY=
# PINECONE_ENVIRONMENT=
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register user |
| POST | /api/auth/login | Login, get JWT |
| GET | /api/projects | List projects |
| POST | /api/projects | Create project |
| GET | /api/projects/{id} | Get project |
| POST | /api/agents/run | Run full workflow |
| GET | /api/agents/status/{task_id} | Poll task status |
| GET | /api/papers/{project_id} | List papers |
| POST | /api/rag/query | Ask RAG question |
| GET | /api/reviews/{project_id} | Get lit review |
| GET | /api/presentations/{project_id}/download | Download PPTX |
| GET | /api/chat/history/{project_id} | Chat history |

Full interactive docs: http://localhost:8000/docs

---

## Agent Pipeline

```
Research Topic
     │
     ▼
[Agent 1] Paper Search      ── Semantic Scholar + ArXiv + PubMed
     │
     ▼
[Agent 2] Paper Collection  ── Download PDFs, store metadata
     │
     ▼
[Agent 3] Doc Processing    ── Extract text, chunk, embed → ChromaDB
     │
     ▼
[Agent 4] Summarization     ── Per-paper summaries via Gemini
     │
     ▼
[Agent 5] Key Findings      ── Structured JSON extraction
     │
     ▼
[Agent 6] Comparison        ── Cross-paper comparison tables
     │
     ▼
[Agent 7] Trend Analysis    ── Emerging models/datasets/trends
     │
     ▼
[Agent 8] Research Gaps     ── Limitations + future directions
     │
     ▼
[Agent 9] Literature Review ── Full Markdown survey
     │
     ▼
[Agent 10] Presentation     ── PPTX export
```

---

## Features

- 🔐 JWT Authentication
- 📄 Multi-source paper search (Semantic Scholar, ArXiv, PubMed)
- 🤖 10-agent LangGraph workflow
- 💬 RAG-powered conversational Q&A with citations
- 📊 Literature review generation
- 📑 PowerPoint export
- 🔄 Async task processing with status polling
- 📦 Modular, production-ready codebase
