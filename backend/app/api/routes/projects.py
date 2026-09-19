"""
Projects Routes: /api/projects
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_owned_project
from app.core.config import settings
from app.core.security import get_current_user_id
from app.db.session import get_db
from app.models.models import ResearchProject
from app.schemas.schemas import (
    AnalysisIn,
    Candidate,
    CollectRequest,
    PaperExtractionIn,
    ProjectCreate,
    ProjectList,
    ProjectOut,
    SearchOut,
    SearchRequest,
)
from app.services import analysis_service, collection_service
from app.services.search import SearchUnavailable

router = APIRouter()


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    since = datetime.now(timezone.utc) - timedelta(days=1)
    created_today = await db.scalar(
        select(func.count())
        .select_from(ResearchProject)
        .where(ResearchProject.user_id == user_id, ResearchProject.created_at >= since)
    )
    if created_today >= settings.MAX_PROJECTS_PER_DAY:
        raise HTTPException(
            429,
            f"You've created {settings.MAX_PROJECTS_PER_DAY} projects in the last 24 hours. "
            "Please try again later.",
        )

    title = body.title or f"Research: {body.topic}"
    project = ResearchProject(
        user_id=user_id,
        topic=body.topic,
        title=title,
        description=body.description,
        year_from=body.year_from,
        year_to=body.year_to,
        sources=body.sources,
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
    """Start the server-side job: read open-access PDFs and store the text.

    With `candidate_ids` (chosen by screening in the browser) only those papers
    are read; without, the topic is searched directly.
    """
    if collection_service.is_active(project):
        raise HTTPException(409, "Papers are already being collected for this project.")
    selected = None
    if body.candidate_ids is not None:
        await db.refresh(project, ["candidates"])
        by_id = {c["id"]: c for c in project.candidates or []}
        missing = [i for i in body.candidate_ids if i not in by_id]
        if missing:
            raise HTTPException(409, "Those papers aren't in this project's latest search.")
        relevance = {r.id: r for r in body.relevance}
        selected = []
        for cid in body.candidate_ids:
            paper = dict(by_id[cid])
            if cid in relevance:
                paper["relevance_score"] = relevance[cid].score
                paper["relevance_reason"] = relevance[cid].reason
            selected.append(paper)
    # One collection per user at a time: each one fans out to several APIs.
    others = (
        await db.scalars(
            select(ResearchProject).where(
                ResearchProject.user_id == project.user_id,
                ResearchProject.id != project.id,
                ResearchProject.status == "collecting",
            )
        )
    ).all()
    busy = next((p for p in others if collection_service.is_active(p)), None)
    if busy:
        raise HTTPException(
            429,
            f'Papers are still being collected for "{busy.title}". '
            "Please wait for that to finish.",
        )
    collection_service.start(project)
    await db.flush()
    await db.refresh(project)
    # get_db commits the new status before the response goes out, and the job
    # runs after that, so it always sees a committed 'collecting' row.
    background_tasks.add_task(
        collection_service.run, project.id, project.topic, body.max_papers, selected=selected
    )
    return project


MAX_CANDIDATES = 60


@router.post("/{project_id}/search", response_model=SearchOut)
async def search_candidates(
    body: SearchRequest,
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    """Search every source with the project's topic plus the planned queries and
    keep the results as candidates for screening in the browser."""
    if collection_service.is_active(project):
        raise HTTPException(409, "Papers are already being collected for this project.")
    queries = list(dict.fromkeys([project.topic, *body.queries]))  # topic first, no repeats
    try:
        records = await collection_service.default_candidates(
            queries,
            MAX_CANDIDATES,
            year_from=project.year_from,
            year_to=project.year_to,
            sources=project.sources,
        )
    except SearchUnavailable:
        raise HTTPException(
            503, "The paper search services couldn't be reached. Please try again shortly."
        ) from None
    candidates = [{"id": i, **record} for i, record in enumerate(records)]
    project.candidates = candidates
    await db.flush()
    return SearchOut(
        candidates=[
            Candidate(
                id=c["id"],
                title=c.get("title") or "",
                authors=c.get("authors") or [],
                abstract=c.get("abstract") or "",
                year=c.get("year"),
                source=c.get("source") or "",
                doi=c.get("doi"),
                has_pdf=bool(c.get("pdf_url")),
            )
            for c in candidates
        ]
    )


@router.put("/{project_id}/papers/{paper_id}/extraction", status_code=204)
async def save_paper_extraction(
    paper_id: int,
    body: PaperExtractionIn,
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    """Store one paper's findings, extracted in the browser. Saved per paper so a
    closed tab can resume from the papers that aren't done yet."""
    analysis_service.require_collected(project)
    await analysis_service.save_extraction(db, project, paper_id, body)


@router.put("/{project_id}/analysis", response_model=ProjectOut)
async def save_project_analysis(
    body: AnalysisIn,
    project: ResearchProject = Depends(get_owned_project),
    db: AsyncSession = Depends(get_db),
):
    """Store the literature review written in the browser; the project is complete."""
    analysis_service.require_collected(project)
    await analysis_service.save_analysis(db, project, body)
    await db.flush()
    await db.refresh(project)
    return project
