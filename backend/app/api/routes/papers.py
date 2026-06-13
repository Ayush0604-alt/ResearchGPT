"""
Papers Routes: /api/papers
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models.models import Paper, PaperSummary, PaperFindings
from app.schemas.schemas import PaperOut, SummaryOut, FindingsOut
from app.core.security import get_current_user_id

router = APIRouter()


@router.get("/{project_id}", response_model=List[PaperOut])
async def list_papers(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(Paper).where(Paper.project_id == project_id)
        .order_by(Paper.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{project_id}/summaries", response_model=List[SummaryOut])
async def list_summaries(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(PaperSummary)
        .join(Paper)
        .where(Paper.project_id == project_id)
    )
    return result.scalars().all()


@router.get("/{project_id}/findings", response_model=List[FindingsOut])
async def list_findings(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(PaperFindings)
        .join(Paper)
        .where(Paper.project_id == project_id)
    )
    return result.scalars().all()
