"""
Presentations Routes: /api/presentations
"""
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models.models import Presentation
from app.schemas.schemas import PresentationOut
from app.core.security import get_current_user_id

router = APIRouter()


@router.get("/{project_id}", response_model=PresentationOut)
async def get_presentation(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(Presentation).where(Presentation.project_id == project_id)
    )
    pres = result.scalar_one_or_none()
    if not pres:
        raise HTTPException(404, "Presentation not found")
    return pres


@router.get("/{project_id}/download")
async def download_presentation(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(Presentation).where(Presentation.project_id == project_id)
    )
    pres = result.scalar_one_or_none()
    if not pres or not pres.file_path:
        raise HTTPException(404, "Presentation file not found")

    file_path = Path(pres.file_path)
    if not file_path.exists():
        raise HTTPException(404, "Presentation file not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=f"research_presentation_project_{project_id}.pptx",
    )
