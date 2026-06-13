"""
Chat Routes: /api/chat

Fix: delete route was missing `await db.commit()` — deletions were being
     rolled back by the session context manager's exception handler path,
     so clearing chat history appeared to work but messages reappeared on reload.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.db.session import get_db
from app.models.models import ChatMessage
from app.schemas.schemas import ChatHistoryOut
from app.core.security import get_current_user_id

router = APIRouter()


@router.get("/history/{project_id}", response_model=ChatHistoryOut)
async def get_chat_history(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.project_id == project_id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()
    return ChatHistoryOut(messages=list(messages), total=len(messages))


@router.delete("/history/{project_id}", status_code=204)
async def clear_chat_history(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    # FIX: use bulk DELETE instead of load-then-delete, and ensure commit runs.
    # The original code fetched all rows then called db.delete() per row but
    # never committed — get_db() only commits on the yield path when no
    # exception is raised, but 204 responses have no body so some ASGI paths
    # skipped the commit.
    await db.execute(
        delete(ChatMessage).where(ChatMessage.project_id == project_id)
    )
    # Explicit commit ensures the bulk delete is persisted regardless of
    # how the response is finalized.
    await db.commit()