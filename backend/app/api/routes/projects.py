"""
Projects Routes: /api/projects
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_owned_project
from app.core.security import get_current_user_id
from app.db.session import get_db
from app.models.models import ResearchProject
from app.schemas.schemas import CollectRequest, ProjectCreate, ProjectList, ProjectOut
from app.services import collection_service

router = APIRouter()


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    title = body.title or f"Research: {body.topic}"
    project = ResearchProject(
        user_id=user_id,
        topic=body.topic,
        title=title,
        description=body.description,
    )
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project


@router.get("", response_model=ProjectList)
async def list_projects(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(ResearchProject)
        .where(ResearchProject.user_id == user_id)
        .order_by(ResearchProject.created_at.desc())
    )
    projects = result.scalars().all()
    expired = [p for p in projects if collection_service.expire_if_stale(p)]
    if expired:
        await db.flush()
        for p in expired:
            await db.refresh(p)
    return ProjectList(projects=list(projects), total=len(projects))


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project: ResearchProject = Depends(get_owned_project)):
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    await db.delete(project)


@router.post("/{project_id}/collect", response_model=ProjectOut, status_code=202)
async def collect_papers(
    body: CollectRequest,
    background_tasks: BackgroundTasks,
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    """Start the server-side job: search, read open-access PDFs, store the text."""
    if collection_service.is_active(project):
        raise HTTPException(409, "Papers are already being collected for this project.")
    collection_service.start(project)
    await db.flush()
    await db.refresh(project)
    # get_db commits the new status before the response goes out, and the job
    # runs after that, so it always sees a committed 'collecting' row.
    background_tasks.add_task(collection_service.run, project.id, project.topic, body.max_papers)
    return project
