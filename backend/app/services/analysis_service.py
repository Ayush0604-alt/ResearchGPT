"""
Storing analysis results that the browser computed with the user's own key.
The server never calls an LLM. Functions take a session and never commit.
"""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.models import (
    LiteratureReview,
    Paper,
    PaperFindings,
    PaperSummary,
    ProjectStatus,
    ResearchProject,
    ReviewRun,
)
from app.schemas.schemas import AnalysisIn, PaperExtractionIn, PaperForAnalysis

READY = {ProjectStatus.COLLECTED.value, ProjectStatus.COMPLETED.value}


def require_collected(project: ResearchProject) -> None:
    if project.status not in READY:
        raise HTTPException(409, "Collect papers for this project before analysing them.")


async def papers_for_analysis(db: AsyncSession, project_id: int) -> list[PaperForAnalysis]:
    papers = (
        await db.scalars(
            select(Paper)
            .where(Paper.project_id == project_id)
            .options(undefer(Paper.full_text))
            .order_by(Paper.id)
        )
    ).all()
    extracted = set(
        (
            await db.scalars(
                select(PaperSummary.paper_id).join(Paper).where(Paper.project_id == project_id)
            )
        ).all()
    )
    return [
        PaperForAnalysis(
            id=p.id,
            title=p.title,
            authors=p.authors,
            year=p.year,
            abstract=p.abstract,
            full_text=p.full_text,
            url=p.url,
            has_pdf=bool(p.pdf_url),
            has_extraction=p.id in extracted,
        )
        for p in papers
    ]


async def save_extraction(
    db: AsyncSession, project: ResearchProject, paper_id: int, data: PaperExtractionIn
) -> None:
    paper = await db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.project_id == project.id)
    )
    if paper is None:
        raise HTTPException(404, "Paper not found")

    summary = await db.scalar(select(PaperSummary).where(PaperSummary.paper_id == paper_id))
    if summary is None:
        summary = PaperSummary(paper_id=paper_id)
        db.add(summary)
    summary.summary = data.summary
    summary.methodology = data.methodology
    summary.conclusion = data.conclusion

    findings = await db.scalar(select(PaperFindings).where(PaperFindings.paper_id == paper_id))
    if findings is None:
        findings = PaperFindings(paper_id=paper_id)
        db.add(findings)
    findings.model_used = data.model_used
    findings.dataset_used = data.dataset_used
    findings.accuracy = data.metrics[:255]
    findings.contributions = data.contributions
    findings.limitations = data.limitations
    findings.raw_json = data.model_dump()


# How many earlier reviews a project keeps.
MAX_VERSIONS = 10
REVIEW_SECTIONS = (
    "introduction",
    "body",
    "discussion",
    "conclusion",
    "trends",
    "gaps",
    "comparison",
)


async def _record_version(
    db: AsyncSession, project: ResearchProject, review: LiteratureReview
) -> None:
    """Keep this review as a version, and drop the oldest beyond MAX_VERSIONS."""
    titles = (
        await db.scalars(
            select(Paper.title).where(Paper.project_id == project.id).order_by(Paper.id)
        )
    ).all()
    db.add(
        ReviewRun(
            project_id=project.id,
            sections={f: getattr(review, f) for f in REVIEW_SECTIONS},
            citation_checks=review.citation_checks,
            run_meta=review.run_meta,
            papers=list(titles),
        )
    )
    await db.flush()
    keep = (
        select(ReviewRun.id)
        .where(ReviewRun.project_id == project.id)
        .order_by(ReviewRun.created_at.desc(), ReviewRun.id.desc())
        .limit(MAX_VERSIONS)
        .scalar_subquery()
    )
    await db.execute(
        delete(ReviewRun).where(ReviewRun.project_id == project.id, ReviewRun.id.not_in(keep))
    )


async def save_analysis(db: AsyncSession, project: ResearchProject, data: AnalysisIn) -> None:
    review = await db.scalar(
        select(LiteratureReview).where(LiteratureReview.project_id == project.id)
    )
    if review is None:
        review = LiteratureReview(project_id=project.id)
        db.add(review)
    for field in REVIEW_SECTIONS:
        setattr(review, field, getattr(data, field))
    review.citation_checks = [c.model_dump() for c in data.citation_checks] or None
    review.run_meta = data.run.model_dump() if data.run else None
    await _record_version(db, project, review)
    project.status = ProjectStatus.COMPLETED.value
    project.error = None
    project.finished_at = datetime.now(timezone.utc)
