"""
Reviews Routes: /api/reviews
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_owned_project
from app.db.session import get_db
from app.models.models import LiteratureReview, ResearchProject
from app.schemas.schemas import LiteratureReviewOut

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
    md += f"## Trends\n{review.trends or ''}\n\n"
    md += f"## Research Gaps\n{review.gaps or ''}\n\n"
    md += f"## Conclusion\n{review.conclusion or ''}\n"
    return md
