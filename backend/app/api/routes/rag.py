"""
RAG Routes: /api/rag
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models.models import ResearchProject, ChatMessage
from app.schemas.schemas import RAGQuery, RAGResponse
from app.core.security import get_current_user_id
from app.rag.pipeline import RAGPipeline
from loguru import logger

router = APIRouter()

_rag = RAGPipeline()


@router.post("/query", response_model=RAGResponse)
async def rag_query(
    body: RAGQuery,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    # Verify project ownership
    result = await db.execute(
        select(ResearchProject).where(
            ResearchProject.id == body.project_id,
            ResearchProject.user_id == user_id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    try:
        rag_result = await _rag.query(
            question=body.question,
            project_id=body.project_id,
        )
    except Exception as e:
        logger.error(f"[RAG route] Error: {e}")
        raise HTTPException(500, f"RAG query failed: {str(e)}")

    # Persist chat messages
    db.add(ChatMessage(project_id=body.project_id, role="user",      content=body.question))
    db.add(ChatMessage(
        project_id=body.project_id,
        role="assistant",
        content=rag_result["answer"],
        citations={"sources": rag_result["citations"]},
    ))
    await db.flush()

    return RAGResponse(
        answer=rag_result["answer"],
        citations=rag_result["citations"],
        question=body.question,
    )
