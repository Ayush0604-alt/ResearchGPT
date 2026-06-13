"""
RAG Pipeline
Retrieves relevant chunks from the singleton ChromaDB collection
and generates grounded answers with Gemini.
"""
from typing import List, Dict, Any
from loguru import logger

from app.agents.processing.agent import DocumentProcessingAgent
from app.utils.gemini_client import ask_gemini

# Module-level single instance — shares the singleton ChromaDB collection
_processor = DocumentProcessingAgent()


class RAGPipeline:
    async def query(
        self,
        question: str,
        project_id: int,
        n_results: int = 5,
    ) -> Dict[str, Any]:
        logger.info(f"[RAG] project_id={project_id} question='{question[:80]}'")

        chunks = _processor.query(question, project_id, n_results=n_results)

        if not chunks:
            return {
                "answer":    "I don't have enough information to answer based on the analyzed papers.",
                "citations": [],
                "question":  question,
            }

        context_parts = [
            f"[Source {i}] From: \"{c['title']}\"\n{c['text']}"
            for i, c in enumerate(chunks, 1)
        ]
        context = "\n\n---\n\n".join(context_parts)

        prompt = f"""You are a research assistant. Answer the question using ONLY the paper excerpts below.

Question: {question}

Paper Excerpts:
{context}

Rules:
- Cite sources as [Source N]
- Be factual and concise
- If not in sources, say "The reviewed papers do not address this directly"

Answer:"""

        answer = await ask_gemini(prompt, max_tokens=1500)

        citations = [
            {
                "paper_title":     c["title"],
                "paper_id":        c["paper_id"],
                "chunk_text":      c["text"][:300],
                "relevance_score": c["score"],
            }
            for c in chunks
        ]

        logger.info(f"[RAG] Answer generated with {len(citations)} citations")
        return {"answer": answer, "citations": citations, "question": question}
