"""
Chat Routes: /api/chat

Answers are generated in the browser with the user's own key; the server only
stores finished exchanges. It never calls an LLM.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_owned_project
from app.db.session import get_db
from app.models.models import ChatMessage, Paper, ResearchProject
from app.schemas.schemas import ChatExchangeIn, ChatHistoryOut

router = APIRouter()


async def _history(db: AsyncSession, project_id: int) -> ChatHistoryOut:
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.project_id == project_id)
        # A question and its answer share a timestamp (same transaction): id breaks the tie.
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
    )
    messages = result.scalars().all()
    return ChatHistoryOut(messages=list(messages), total=len(messages))


@router.get("/history/{project_id}", response_model=ChatHistoryOut)
async def get_chat_history(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    return await _history(db, project.id)


@router.delete("/history/{project_id}", status_code=204)
async def clear_chat_history(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(ChatMessage).where(ChatMessage.project_id == project.id))


@router.post("/{project_id}/messages", response_model=ChatHistoryOut, status_code=201)
async def save_exchange(
    body: ChatExchangeIn,
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    """Store a question and the answer the browser generated for it, together."""
    # Keep only citations of papers that really belong to this project.
    cited = [c.paper_id for c in body.citations]
    rows = (
        await db.execute(
            select(Paper.id, Paper.title).where(Paper.project_id == project.id, Paper.id.in_(cited))
        )
    ).all()
    titles = {pid: title for pid, title in rows}
    citations = [
        {"paper_id": pid, "title": titles[pid]} for pid in dict.fromkeys(cited) if pid in titles
    ]

    db.add(ChatMessage(project_id=project.id, role="user", content=body.question))
    db.add(
        ChatMessage(
            project_id=project.id,
            role="assistant",
            content=body.answer,
            citations={"papers": citations} if citations else None,
        )
    )
    await db.flush()
    return await _history(db, project.id)
