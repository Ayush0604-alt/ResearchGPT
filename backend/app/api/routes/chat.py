"""
Chat Routes: /api/chat
"""

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_owned_project, load_owned_project
from app.core.security import get_current_user_id
from app.db.session import get_db
from app.models.models import ChatMessage, Paper, ResearchProject
from app.schemas.schemas import ChatHistoryOut
from app.utils.gemini_client import RateLimitError, ask_gemini

router = APIRouter()


class ChatQuery(BaseModel):
    project_id: int
    question: str = Field(min_length=1, max_length=4000)


@router.get("/history/{project_id}", response_model=ChatHistoryOut)
async def get_chat_history(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.project_id == project.id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()
    return ChatHistoryOut(messages=list(messages), total=len(messages))


@router.delete("/history/{project_id}", status_code=204)
async def clear_chat_history(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(ChatMessage).where(ChatMessage.project_id == project.id))


@router.post("/query")
async def chat_query(
    body: ChatQuery,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    await load_owned_project(db, body.project_id, user_id)

    # Fetch papers for context
    result = await db.execute(select(Paper).where(Paper.project_id == body.project_id))
    papers = result.scalars().all()

    context = ""
    for i, p in enumerate(papers[:15]):
        context += f"[{i+1}] {p.title} ({p.year})\nAbstract: {p.abstract}\n\n"

    prompt = f"""You are an expert AI research assistant. Answer the user's question based ONLY on the following paper abstracts. If the answer is not in the papers, say so.

Context Papers:
{context}

Question: {body.question}"""

    # On failure nothing is stored: a question without an answer isn't history.
    try:
        answer = await ask_gemini(prompt, max_tokens=2048)
    except RateLimitError:
        raise HTTPException(
            429, "The Gemini API rate limit was reached. Wait a minute and ask again."
        ) from None
    except Exception:
        logger.exception(f"[Chat] Gemini call failed for project {body.project_id}")
        raise HTTPException(502, "Couldn't get an answer right now. Please try again.") from None

    # Both messages are committed together by get_db.
    db.add(ChatMessage(project_id=body.project_id, role="user", content=body.question))
    db.add(ChatMessage(project_id=body.project_id, role="assistant", content=answer))

    return {"answer": answer, "citations": []}
