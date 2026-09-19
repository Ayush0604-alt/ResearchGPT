"""
Papers Routes: /api/papers
"""

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_owned_project
from app.db.session import get_db
from app.models.models import Paper, PaperFindings, PaperSummary, ResearchProject
from app.schemas.schemas import FindingsOut, PaperOut, SummaryOut

router = APIRouter()


@router.get("/{project_id}", response_model=List[PaperOut])
async def list_papers(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Paper).where(Paper.project_id == project.id).order_by(Paper.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{project_id}/summaries", response_model=List[SummaryOut])
async def list_summaries(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PaperSummary).join(Paper).where(Paper.project_id == project.id)
    )
    return result.scalars().all()


@router.get("/{project_id}/findings", response_model=List[FindingsOut])
async def list_findings(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(PaperFindings).join(Paper).where(Paper.project_id == project.id)
    )
    return result.scalars().all()
