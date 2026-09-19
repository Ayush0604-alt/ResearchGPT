"""
Papers Routes: /api/papers
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_owned_project
from app.db.session import get_db
from app.models.models import Paper, PaperFindings, PaperSummary, ResearchProject
from app.schemas.schemas import FindingsOut, PaperForAnalysis, PaperOut, SummaryOut
from app.services import analysis_service, collection_service

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


@router.get("/{project_id}/texts", response_model=List[PaperForAnalysis])
async def list_paper_texts(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    """Papers with their extracted full text, for the browser to analyse."""
    return await analysis_service.papers_for_analysis(db, project.id)


@router.get("/{project_id}/{paper_id}/pdf", response_class=Response)
async def get_paper_pdf(
    paper_id: int,
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    """The paper's open-access PDF, fetched through the SSRF guard for the browser
    to send to the model. Streamed through, never stored."""
    pdf_url = await db.scalar(
        select(Paper.pdf_url).where(Paper.id == paper_id, Paper.project_id == project.id)
    )
    if not pdf_url:
        raise HTTPException(404, "No PDF for this paper")
    data = await collection_service.default_fetch_pdf(pdf_url)
    if data is None:
        raise HTTPException(404, "The PDF couldn't be downloaded")
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline", "Cache-Control": "no-store"},
    )
