"""
Reviews Routes: /api/reviews
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi.responses import PlainTextResponse

from app.db.session import get_db
from app.models.models import LiteratureReview
from app.schemas.schemas import LiteratureReviewOut
from app.core.security import get_current_user_id

router = APIRouter()


@router.get("/{project_id}", response_model=LiteratureReviewOut)
async def get_review(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(LiteratureReview).where(LiteratureReview.project_id == project_id)
    )
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(404, "Literature review not found")
    return review


@router.get("/{project_id}/markdown", response_class=PlainTextResponse)
async def get_review_markdown(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """Return the full literature review as plain Markdown text."""
    result = await db.execute(
        select(LiteratureReview).where(LiteratureReview.project_id == project_id)
    )
    review = result.scalar_one_or_none()
    if not review:
        raise HTTPException(404, "Literature review not found")

    md = f"# Literature Review\n\n## Introduction\n{review.introduction or ''}\n\n"
    md += f"## Survey\n{review.body or ''}\n\n"
    md += f"## Discussion\n{review.discussion or ''}\n\n"
    md += f"## Trends\n{review.trends or ''}\n\n"
    md += f"## Research Gaps\n{review.gaps or ''}\n\n"
    md += f"## Conclusion\n{review.conclusion or ''}\n"
    return md
