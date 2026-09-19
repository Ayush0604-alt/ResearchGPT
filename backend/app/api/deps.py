"""
Shared route dependencies.
"""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user_id
from app.db.session import get_db
from app.models.models import ResearchProject


async def load_owned_project(db: AsyncSession, project_id: int, user_id: int) -> ResearchProject:
    """Return the project if `user_id` owns it, else 404.

    Missing and foreign projects both return 404 so callers can't probe which ids exist.
    """
    project = await db.scalar(
        select(ResearchProject).where(
            ResearchProject.id == project_id,
            ResearchProject.user_id == user_id,
        )
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def get_owned_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
) -> ResearchProject:
    """Dependency for routes with a `{project_id}` path parameter."""
    return await load_owned_project(db, project_id, user_id)
