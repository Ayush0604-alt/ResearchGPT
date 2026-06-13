"""
Chat Routes: /api/chat
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

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
    result = await db.execute(
        select(ChatMessage).where(ChatMessage.project_id == project_id)
    )
    for msg in result.scalars().all():
        await db.delete(msg)
