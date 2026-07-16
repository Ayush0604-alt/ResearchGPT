<div align="center">
  
# 🔬 ResearchGPT

**Production-grade AI Research Assistant Platform**

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/vite-%23646CFF.svg?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/postgresql-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![Gemini](https://img.shields.io/badge/Gemini-%238E75B2.svg?style=for-the-badge&logo=googlebard&logoColor=white)](https://aistudio.google.com/)

*An AI-powered research assistant that lets you query, summarize, and reason over research papers and documents through a conversational interface.*

</div>

---

## 📖 Overview

ResearchGPT takes unstructured research content (papers, documents, queries) and runs it through a retrieval-augmented, multi-step LLM pipeline to produce grounded, cited answers rather than raw model guesses. The system is built as a full-stack app: a Python backend that owns the retrieval/agent logic, and a React frontend for interaction.

---

## 🚀 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + Vite + TailwindCSS |
| **Backend** | FastAPI (async) + Python 3.11 |
| **AI Orchestration** | LangGraph |
| **LLM** | Google Gemini 2.5 Flash |
| **Database** | PostgreSQL |
| **Vector DB** | ChromaDB (Pinecone-ready) |
| **Storage** | Local (S3-ready) |
| **Migrations** | Alembic |
| **ORM** | SQLAlchemy (async) |

---

## 🧠 Architecture & Agent Pipeline

### The Agentic Workflow Deep Dive

The core agent pipeline is built with **LangGraph**. It was originally designed as a 10-node graph, but was deliberately simplified down to a **3-node pipeline with batched Gemini calls**.

This wasn't a shortcut — it was a trade-off made after the 10-node version showed diminishing returns: more nodes meant more round-trips to the LLM, higher latency, and more surface area for state-management bugs, without a meaningful quality improvement over batching the same work into fewer, denser calls.

The optimized 3-node version manages a state dictionary (`ResearchState`) containing the topic, papers list, extracted trends, gaps, and literature review.

1. **Paper Search (`PaperSearchAgent`)**
   - Parses the user's research topic.
   - Concurrently searches academic databases (Semantic Scholar, ArXiv, PubMed) via APIs.
   - Returns a deduplicated list of top matching paper metadata.
2. **Paper Collection (`PaperCollectionAgent`)**
   - Iterates through the discovered papers.
   - Downloads the raw PDFs to the local storage layer (`/storage/pdfs`).
   - Extracts text, chunks it, and indexes it into ChromaDB for RAG conversational queries.
3. **Comprehensive Analysis (`ComprehensiveAnalysisAgent`)**
   - A single batched Gemini call that handles multiple reasoning steps concurrently.
   - Extracts structured JSON representing the methodology, datasets, accuracy, contributions, and limitations for each paper.
   - Synthesizes cross-paper trends, identifies research gaps, and drafts a comprehensive literature review.

```text
Research Topic
     │
     ▼
[Agent 1] Paper Search              ── Semantic Scholar + ArXiv + PubMed
     │
     ▼
[Agent 2] Paper Collection          ── Download PDFs, store metadata & chunk to Vector DB
     │
     ▼
[Agent 3] Comprehensive Analysis    ── Batch processing via Gemini (Summarization, Trends, Gaps, Review)
```

---

## 💾 Database Schema

The PostgreSQL database is managed via Alembic migrations and SQLAlchemy ORM. The core relational models include:

- **Users**: Core authentication table (`id`, `email`, `username`, `hashed_password`).
- **ResearchProject**: Represents a specific research topic initialized by a user. Tracks progress status (`PENDING`, `RUNNING`, `COMPLETED`, `FAILED`).
- **Paper**: Stores metadata for each discovered paper (title, authors, year, abstract, PDF URLs, local paths).
- **PaperSummary & PaperFindings**: Stores the model-generated structured outputs (methodology, models used, accuracy, limitations) linked to each paper.
- **LiteratureReview**: A 1-to-1 relationship with `ResearchProject` storing the synthesized introduction, body, discussion, trends, and gaps.
- **Presentation**: Stores the generated slide deck path and underlying JSON slide data.
- **ChatMessage**: Stores the conversational Q&A history with citations linking back to ChromaDB chunks.

---

## ✨ Features

- 🔐 **JWT Authentication**: Secure user sessions and project isolation.
- 📄 **Multi-source Paper Search**: Integrates with Semantic Scholar, ArXiv, and PubMed.
- 🤖 **3-agent LangGraph Workflow**: Optimized autonomous batch processing for robustness.
- 💬 **RAG-powered Conversational Q&A**: Ask questions and get answers with exact citations.
- 📊 **Literature Review Generation**: Auto-generates detailed markdown surveys of the topic.
- 📑 **PowerPoint Export**: Automatically build presentation decks from the research.
- 🔄 **Async Task Processing**: Polling setup for heavy background AI generation tasks.
- 🛡️ **Ownership Checks**: Every document/query resource is scoped to its owning user, enforced server-side.

---

## 📂 Project Structure

```text
ResearchGPT/
├── backend/
│   ├── app/
│   │   ├── api/                 # FastAPI route handlers (auth, projects, agents, chat)
│   │   ├── agents/              # LangGraph agents (workflow.py, search, collection, comprehensive)
│   │   ├── core/                # App config, CORS, JWT security settings, logging
│   │   ├── db/                  # DB session initialization and base declarations
│   │   ├── models/              # SQLAlchemy ORM models (models.py)
│   │   ├── schemas/             # Pydantic models for request/response validation
│   │   ├── services/            # Business logic (e.g. Gemini client wrappers, Chroma interaction)
│   │   └── utils/               # Helpers
│   ├── alembic/                 # Alembic migration scripts
│   ├── storage/                 # Data storage (PDFs, presentations, Chroma)
│   ├── .env.example             # Environment variables template
│   ├── requirements.txt
│   └── main.py                  # FastAPI Application Entry Point
├── frontend/
│   ├── src/
│   │   ├── components/          # Reusable React components (buttons, modals, layout)
│   │   ├── pages/               # Route-level views (Dashboard, Project View, Chat)
│   │   ├── hooks/               # Custom React hooks
│   │   ├── services/            # Axios API client functions
│   │   ├── store/               # Zustand state management (authStore.js)
│   │   ├── styles/              # Global Tailwind CSS directives
│   │   └── utils/               # Frontend formatting utilities
│   ├── package.json
│   ├── tailwind.config.js       # Tailwind CSS configuration
│   └── vite.config.js           # Vite configuration
└── docker-compose.yml           # Docker setup for full stack
```

---

## 📋 Prerequisites

- **Python** 3.11+
- **Node.js** 18+
- **PostgreSQL** 15+
- **Google Gemini API Key** → [Get it here](https://aistudio.google.com/app/apikey)

---

## ⚡ Quick Start

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

- **Backend runs at:** [http://localhost:8000](http://localhost:8000)
- **API Docs at:** [http://localhost:8000/docs](http://localhost:8000/docs)

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

- **Frontend runs at:** [http://localhost:5173](http://localhost:5173)

### 4. Docker (Optional — All-in-One)

You can run the entire stack including the database with Docker Compose.

```bash
# From project root
docker-compose up --build
```

---

## ⚙️ Environment Variables

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

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| **POST** | `/api/v1/auth/register` | Register user |
| **POST** | `/api/v1/auth/login` | Login, get JWT |
| **GET** | `/api/v1/projects` | List projects |
| **POST** | `/api/v1/projects` | Create project |
| **GET** | `/api/v1/projects/{id}` | Get project |
| **POST** | `/api/v1/agents/run` | Run full workflow |
| **GET** | `/api/v1/agents/status/{task_id}` | Poll task status |
| **GET** | `/api/v1/papers/{project_id}` | List papers |
| **POST** | `/api/v1/rag/query` | Ask RAG question |
| **GET** | `/api/v1/reviews/{project_id}` | Get lit review |
| **GET** | `/api/v1/presentations/{project_id}/download` | Download PPTX |
| **GET** | `/api/v1/chat/history/{project_id}` | Chat history |

> Full interactive docs available via Swagger UI at `/docs` when the backend is running.

---

## 🛠️ Design Decisions

- **3 nodes over 10**: prioritized lower latency and simpler state management over granular pipeline observability, since batched Gemini calls handled synthesis + citation grounding well enough together.
- **Async SQLAlchemy**: chosen to keep the API non-blocking under concurrent document uploads/queries, matching FastAPI's async model end-to-end.
- **Ownership checks at the API layer**: every document/query resource is scoped to its owning user, enforced server-side rather than trusted from the client.

---

## 👤 Author

Built by [Ayush](https://github.com/Ayush0604-alt).
