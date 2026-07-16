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
