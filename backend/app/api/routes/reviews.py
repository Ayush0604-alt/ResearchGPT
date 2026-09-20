"""
Reviews Routes: /api/reviews
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_owned_project
from app.db.session import get_db
from app.models.models import LiteratureReview, ResearchProject, ReviewRun
from app.schemas.schemas import LiteratureReviewOut, ReviewVersionOut
from app.services.review_metrics import review_metrics

router = APIRouter()


async def _load_review(db: AsyncSession, project_id: int) -> LiteratureReview:
    review = await db.scalar(
        select(LiteratureReview).where(LiteratureReview.project_id == project_id)
    )
    if not review:
        raise HTTPException(404, "Literature review not found")
    return review


@router.get("/{project_id}", response_model=LiteratureReviewOut)
async def get_review(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    return await _load_review(db, project.id)


@router.get("/{project_id}/versions", response_model=List[ReviewVersionOut])
async def list_versions(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    """Earlier reviews of this project, newest first, with their metrics."""
    runs = (
        await db.scalars(
            select(ReviewRun)
            .where(ReviewRun.project_id == project.id)
            .order_by(ReviewRun.created_at.desc(), ReviewRun.id.desc())
        )
    ).all()
    return [
        ReviewVersionOut(
            id=run.id,
            created_at=run.created_at,
            sections=run.sections,
            citation_checks=run.citation_checks,
            run_meta=run.run_meta,
            papers=run.papers or [],
            metrics=review_metrics(
                {**run.sections, "citation_checks": run.citation_checks},
                len(run.papers or []),
                run.run_meta,
            ),
            current=index == 0,
        )
        for index, run in enumerate(runs)
    ]


@router.get("/{project_id}/markdown", response_class=PlainTextResponse)
async def get_review_markdown(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    """Return the full literature review as plain Markdown text."""
    review = await _load_review(db, project.id)

    md = f"# Literature Review\n\n## Introduction\n{review.introduction or ''}\n\n"
    md += f"## Survey\n{review.body or ''}\n\n"
    md += f"## Discussion\n{review.discussion or ''}\n\n"
    md += f"## Comparison\n{review.comparison or ''}\n\n"
    md += f"## Trends\n{review.trends or ''}\n\n"
    md += f"## Research Gaps\n{review.gaps or ''}\n\n"
    md += f"## Conclusion\n{review.conclusion or ''}\n"
    return md
