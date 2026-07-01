# ResearchGPT

An AI-powered research assistant that lets you query, summarize, and reason over research papers and documents through a conversational interface — built with a FastAPI backend, a LangGraph-orchestrated agent pipeline, and a React frontend.

---

## Overview

ResearchGPT takes unstructured research content (papers, documents, queries) and runs it through a retrieval-augmented, multi-step LLM pipeline to produce grounded, cited answers rather than raw model guesses. The system is built as a full-stack app: a Python backend that owns the retrieval/agent logic, and a React frontend for interaction.

## Features

- Conversational Q&A over uploaded research documents
- Retrieval-augmented generation backed by a vector store (ChromaDB)
- Multi-step reasoning pipeline orchestrated with LangGraph
- Ownership-scoped access — users can only read/query their own documents
- Structured error handling throughout the API (no silent failures / raw stack traces to the client)

## Architecture

The core agent pipeline is built with **LangGraph**. It was originally designed as a 10-node graph (separate nodes for query parsing, retrieval, re-ranking, summarization, citation extraction, etc.), but was deliberately simplified down to a **3-node pipeline with batched Gemini calls**.

This wasn't a shortcut — it was a trade-off made after the 10-node version showed diminishing returns: more nodes meant more round-trips to the LLM, higher latency, and more surface area for state-management bugs, without a meaningful quality improvement over batching the same work into fewer, denser calls. The 3-node version:

1. **Ingest & retrieve** — parses the query, pulls relevant chunks from ChromaDB
2. **Reason & generate** — a single batched Gemini call that handles synthesis + citation grounding together, instead of splitting these across separate nodes
3. **Post-process & respond** — formats the response, attaches sources, returns to the client

```
User Query
   │
   ▼
[1] Ingest & Retrieve  ──►  ChromaDB (vector search)
   │
   ▼
[2] Reason & Generate  ──►  Gemini (batched call)
   │
   ▼
[3] Post-process & Respond
   │
   ▼
Client (React)
```

## Tech Stack

**Backend**
- FastAPI (async)
- LangGraph — agent orchestration
- Google Gemini — LLM
- ChromaDB — vector store for embeddings/retrieval
- SQLAlchemy (async) — relational data (users, documents, ownership)

**Frontend**
- React
- (add your bundler/styling — e.g. Vite, TailwindCSS — if applicable)

## Project Structure

```
ResearchGPT/
├── backend/
│   ├── app/
│   │   ├── api/            # FastAPI route handlers
│   │   ├── agents/          # LangGraph pipeline (3-node graph)
│   │   ├── models/           # SQLAlchemy models
│   │   ├── services/         # ChromaDB, Gemini client wrappers
│   │   └── main.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── App.jsx
│   ├── package.json
│   └── .env.example
└── README.md
```
*(adjust to match your actual folder names)*

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+
- A Gemini API key

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file:

```
GEMINI_API_KEY=your_gemini_api_key
DATABASE_URL=your_database_url
CHROMA_DB_PATH=./chroma_data
```

Run the backend:

```bash
uvicorn app.main:app --reload
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The app should now be running at `http://localhost:5173` (or your configured port), talking to the backend at `http://localhost:8000`.

## API Overview

*(fill in with your actual routes — example shape below)*

| Method | Endpoint            | Description                          |
|--------|----------------------|---------------------------------------|
| POST   | `/api/documents`     | Upload a document for indexing        |
| POST   | `/api/query`         | Submit a query, get a grounded answer |
| GET    | `/api/documents/{id}`| Fetch document metadata               |

## Design Decisions

- **3 nodes over 10**: prioritized lower latency and simpler state management over granular pipeline observability, since batched Gemini calls handled synthesis + citation grounding well enough together.
- **Async SQLAlchemy**: chosen to keep the API non-blocking under concurrent document uploads/queries, matching FastAPI's async model end-to-end.
- **Ownership checks at the API layer**: every document/query resource is scoped to its owning user, enforced server-side rather than trusted from the client.


## Author

Built by [Ayush](https://github.com/Ayush0604-alt).

## License
