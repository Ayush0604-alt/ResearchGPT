"""
Agent 3: Document Processing Agent
Extracts text from PDFs, chunks it, generates embeddings, stores in ChromaDB.
Uses the application-wide singleton ChromaDB collection.

Fix: ChromaDB `where` filter now uses `{"$eq": value}` syntax required by
     ChromaDB >= 0.4.x for non-string metadata comparisons.
"""
import re
from pathlib import Path
from typing import List, Dict, Any

import pdfplumber
from loguru import logger

from app.db.chroma import get_chroma_collection


class DocumentProcessingAgent:
    """
    1. Extract text from PDF (or abstract as fallback)
    2. Clean and chunk text
    3. Embed via Gemini embedding-004 (handled by ChromaDB embedding function)
    4. Upsert chunks into ChromaDB
    """

    CHUNK_SIZE    = 800
    CHUNK_OVERLAP = 150

    # ── Public entry ──────────────────────────────────────────────────────────

    async def run(
        self,
        paper: Dict[str, Any],
        paper_db_id: int,
        project_id: int,
    ) -> Dict[str, Any]:
        text = self._extract_text(paper)
        if not text:
            logger.warning(f"[ProcessingAgent] No text for paper_id={paper_db_id}")
            paper["chunk_count"] = 0
            return paper

        chunks = self._chunk_text(text)
        self._upsert_chunks(chunks, paper_db_id, project_id, paper)

        paper["chunk_count"] = len(chunks)
        logger.info(f"[ProcessingAgent] paper_id={paper_db_id} → {len(chunks)} chunks")
        return paper

    # ── Text Extraction ───────────────────────────────────────────────────────

    def _extract_text(self, paper: Dict) -> str:
        pdf_path = paper.get("pdf_path")
        if pdf_path and Path(pdf_path).exists():
            extracted = self._extract_from_pdf(pdf_path)
            if extracted:
                return extracted

        # Fallback: title + abstract
        title    = paper.get("title", "")
        abstract = paper.get("abstract", "") or ""
        return f"{title}\n\n{abstract}".strip()

    def _extract_from_pdf(self, pdf_path: str) -> str:
        text_parts = []
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text_parts.append(page_text)
        except Exception as e:
            logger.warning(f"[ProcessingAgent] PDF extraction error: {e}")
            return ""

        raw = "\n".join(text_parts)
        return self._clean_text(raw)

    def _clean_text(self, text: str) -> str:
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"[ \t]{2,}", " ", text)
        return text.strip()

    # ── Chunking ──────────────────────────────────────────────────────────────

    def _chunk_text(self, text: str) -> List[str]:
        chunks = []
        start  = 0
        length = len(text)
        while start < length:
            end   = start + self.CHUNK_SIZE
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            start = end - self.CHUNK_OVERLAP
            if start >= length:
                break
        return chunks

    # ── ChromaDB Upsert ───────────────────────────────────────────────────────

    def _upsert_chunks(
        self,
        chunks: List[str],
        paper_db_id: int,
        project_id: int,
        paper: Dict,
    ):
        collection = get_chroma_collection()
        ids       = [f"paper_{paper_db_id}_chunk_{i}" for i in range(len(chunks))]
        # ChromaDB metadata values must be str/int/float/bool — no None allowed
        metadatas = [
            {
                "paper_id":    paper_db_id,
                "project_id":  project_id,
                "title":       (paper.get("title") or "")[:500],
                "source":      paper.get("source") or "",
                "chunk_index": i,
            }
            for i in range(len(chunks))
        ]
        collection.upsert(ids=ids, documents=chunks, metadatas=metadatas)

    # ── Query (used by RAG) ───────────────────────────────────────────────────

    def query(
        self,
        question: str,
        project_id: int,
        n_results: int = 5,
    ) -> List[Dict[str, Any]]:
        """Retrieve top-k relevant chunks filtered by project."""
        collection = get_chroma_collection()

        # Guard: ChromaDB raises if n_results > collection size
        count = collection.count()
        if count == 0:
            return []
        n_results = min(n_results, count)

        # FIX: use {"$eq": value} operator syntax required by ChromaDB >= 0.4
        results = collection.query(
            query_texts=[question],
            n_results=n_results,
            where={"project_id": {"$eq": project_id}},
            include=["documents", "metadatas", "distances"],
        )

        docs      = (results.get("documents") or [[]])[0]
        metas     = (results.get("metadatas")  or [[]])[0]
        distances = (results.get("distances")  or [[]])[0]

        chunks = []
        for doc, meta, dist in zip(docs, metas, distances):
            chunks.append({
                "text":     doc,
                "paper_id": meta.get("paper_id"),
                "title":    meta.get("title", ""),
                "score":    round(1.0 - float(dist), 4),
            })

        return chunks