"""
Agents Routes: /api/agents
Triggers the full LangGraph workflow as a background task.

Fixes:
- _task_store moved to app.core.task_store to break circular import with workflow.py
- task_id includes timestamp so re-runs get a fresh task
- Duplicate-run guard only blocks RUNNING status, not FAILED/COMPLETED
- Old data deleted before re-run to avoid unique-constraint violations
"""
import asyncio
import json
import time
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db, AsyncSessionLocal
from app.models.models import (
    ResearchProject, Paper, PaperSummary, PaperFindings,
    LiteratureReview, Presentation, ProjectStatus,
)
from app.schemas.schemas import AgentRunRequest, AgentStatusResponse
from app.core.security import get_current_user_id
from app.core.task_store import _task_store
from app.agents.workflow import run_research_workflow
from loguru import logger

router = APIRouter()


@router.post("/run", response_model=AgentStatusResponse)
async def run_agents(
    body: AgentRunRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(ResearchProject).where(
            ResearchProject.id      == body.project_id,
            ResearchProject.user_id == user_id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Only block if CURRENTLY running — allow re-runs of failed/completed projects
    if project.status == ProjectStatus.RUNNING.value:
        task_id = project.task_id or ""
        progress = _task_store.get(task_id, {}).get("progress", 0)
        return AgentStatusResponse(
            task_id=task_id,
            status="running",
            progress=progress,
            current_agent="Already running",
        )

    task_id = f"task_{body.project_id}_{user_id}_{int(time.time())}"
    _task_store[task_id] = {"status": "running", "progress": 0, "current_agent": "Starting"}

    project.status  = ProjectStatus.RUNNING.value
    project.task_id = task_id
    await db.flush()

    background_tasks.add_task(
        _run_workflow_background,
        task_id=task_id,
        project_id=body.project_id,
        topic=project.topic,
        max_papers=body.max_papers or 10,
    )

    return AgentStatusResponse(task_id=task_id, status="running", progress=0, current_agent="Starting")


@router.get("/status/{task_id}", response_model=AgentStatusResponse)
async def get_status(task_id: str):
    task = _task_store.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return AgentStatusResponse(
        task_id=task_id,
        status=task.get("status", "unknown"),
        progress=task.get("progress", 0),
        current_agent=task.get("current_agent"),
        error=task.get("error"),
    )


# ── Background worker ─────────────────────────────────────────────────────────

async def _run_workflow_background(
    task_id: str,
    project_id: int,
    topic: str,
    max_papers: int,
):
    try:
        final_state = await run_research_workflow(
            topic=topic,
            project_id=project_id,
            max_papers=max_papers,
            task_id=task_id,
        )

        async with AsyncSessionLocal() as db:
            # ── Delete old data so re-runs don't hit unique-constraint violations ──
            old_papers_result = await db.execute(
                select(Paper).where(Paper.project_id == project_id)
            )
            for old_paper in old_papers_result.scalars().all():
                await db.delete(old_paper)

            old_review_result = await db.execute(
                select(LiteratureReview).where(LiteratureReview.project_id == project_id)
            )
            old_review = old_review_result.scalar_one_or_none()
            if old_review:
                await db.delete(old_review)

            old_pres_result = await db.execute(
                select(Presentation).where(Presentation.project_id == project_id)
            )
            old_pres = old_pres_result.scalar_one_or_none()
            if old_pres:
                await db.delete(old_pres)

            await db.flush()

            # ── Persist papers ────────────────────────────────────────────────
            for paper_data in final_state.get("papers", []):
                authors_raw = paper_data.get("authors", [])
                authors_str = (
                    json.dumps(authors_raw)
                    if isinstance(authors_raw, list)
                    else str(authors_raw)
                )

                paper = Paper(
                    project_id  = project_id,
                    title       = (paper_data.get("title") or "")[:999],
                    authors     = authors_str,
                    abstract    = paper_data.get("abstract", ""),
                    year        = paper_data.get("year"),
                    url         = (paper_data.get("url")     or "")[:1999],
                    pdf_url     = (paper_data.get("pdf_url") or "")[:1999],
                    pdf_path    = paper_data.get("pdf_path"),
                    source      = paper_data.get("source", ""),
                    external_id = paper_data.get("external_id", ""),
                    status      = "processed",
                )
                db.add(paper)
                await db.flush()   # get paper.id

                if paper_data.get("summary"):
                    db.add(PaperSummary(
                        paper_id    = paper.id,
                        summary     = paper_data.get("summary"),
                        methodology = paper_data.get("methodology"),
                        conclusion  = paper_data.get("conclusion"),
                    ))

                findings = paper_data.get("findings") or {}
                if any(v for v in findings.values() if v is not None):
                    db.add(PaperFindings(
                        paper_id      = paper.id,
                        model_used    = findings.get("model_used"),
                        dataset_used  = findings.get("dataset_used"),
                        accuracy      = findings.get("accuracy"),
                        contributions = findings.get("contributions"),
                        limitations   = findings.get("limitations"),
                        raw_json      = findings,
                    ))

            # ── Literature review ─────────────────────────────────────────────
            lit = final_state.get("literature_review") or {}
            logger.info(f"[Background] literature_review keys: {list(lit.keys())}")
            if lit:
                db.add(LiteratureReview(
                    project_id   = project_id,
                    introduction = lit.get("introduction"),
                    body         = lit.get("body"),
                    discussion   = lit.get("discussion"),
                    conclusion   = lit.get("conclusion"),
                    trends       = final_state.get("trends"),
                    gaps         = final_state.get("gaps"),
                ))

            # ── Presentation ──────────────────────────────────────────────────
            pres = final_state.get("presentation") or {}
            logger.info(f"[Background] presentation keys: {list(pres.keys())}, file_path={pres.get('file_path')}")
            if pres.get("file_path"):
                db.add(Presentation(
                    project_id = project_id,
                    file_path  = pres["file_path"],
                    slide_data = pres.get("slide_data"),
                ))

            # ── Mark project complete ─────────────────────────────────────────
            proj_result = await db.execute(
                select(ResearchProject).where(ResearchProject.id == project_id)
            )
            proj = proj_result.scalar_one_or_none()
            if proj:
                proj.status = ProjectStatus.COMPLETED.value
            await db.commit()

        _task_store[task_id] = {"status": "completed", "progress": 100, "current_agent": "Done"}
        logger.info(f"[Background] {task_id} completed")

    except Exception as e:
        logger.exception(f"[Background] {task_id} failed: {e}")
        _task_store[task_id] = {"status": "failed", "progress": 0, "error": str(e)}

        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(
                    select(ResearchProject).where(ResearchProject.id == project_id)
                )
                proj = res.scalar_one_or_none()
                if proj:
                    proj.status = ProjectStatus.FAILED.value
                await db.commit()
        except Exception as inner_exc:
            logger.error(f"[Background] Failed to update project status: {inner_exc}")