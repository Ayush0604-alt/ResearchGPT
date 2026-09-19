"""
Agents Routes: /api/agents
Starts the research workflow as a background task and reports its progress.
Persistence and run bookkeeping live in app.services.research_service.
"""

import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.workflow import run_research_workflow
from app.api.deps import load_owned_project
from app.core.security import get_current_user_id
from app.core.task_store import _task_store
from app.db.session import AsyncSessionLocal, get_db
from app.models.models import ProjectStatus
from app.schemas.schemas import AgentRunRequest, AgentStatusResponse
from app.services import research_service

router = APIRouter()


async def fail_interrupted_runs() -> int:
    """Mark projects left RUNNING by a previous process as FAILED.

    Task progress lives in this process's memory, so after a restart no run can
    still be alive. Call once at startup (single-process deployments only).
    """
    async with AsyncSessionLocal() as db:
        count = await research_service.fail_interrupted_runs(db)
        await db.commit()
    if count:
        logger.warning(f"[Startup] Marked {count} interrupted run(s) as failed")
    return count


@router.post("/run", response_model=AgentStatusResponse)
async def run_agents(
    body: AgentRunRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    project = await load_owned_project(db, body.project_id, user_id)

    # Only block if CURRENTLY running — allow re-runs of failed/completed projects.
    # A RUNNING project whose task isn't in memory is stale (the process restarted).
    task = _task_store.get(project.task_id or "")
    if project.status == ProjectStatus.RUNNING.value and task is not None:
        task_id = project.task_id
        progress = task.get("progress", 0)
        return AgentStatusResponse(
            task_id=task_id,
            status="running",
            progress=progress,
            current_agent="Already running",
        )

    task_id = f"task_{body.project_id}_{user_id}_{int(time.time())}"
    _task_store[task_id] = {
        "user_id": user_id,
        "status": "running",
        "progress": 0,
        "current_agent": "Starting",
    }

    research_service.start_run(project, task_id)
    await db.flush()

    background_tasks.add_task(
        _run_workflow_background,
        task_id=task_id,
        project_id=body.project_id,
        topic=project.topic,
        max_papers=body.max_papers,
    )

    return AgentStatusResponse(
        task_id=task_id, status="running", progress=0, current_agent="Starting"
    )


@router.get("/status/{task_id}", response_model=AgentStatusResponse)
async def get_status(task_id: str, user_id: int = Depends(get_current_user_id)):
    task = _task_store.get(task_id)
    if not task or task.get("user_id") != user_id:
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
        # Raises before touching the DB, so a bad run keeps the previous results.
        research_service.validate_results(final_state)

        async with AsyncSessionLocal() as db:
            await research_service.replace_results(db, project_id, final_state)
            await research_service.mark_completed(db, project_id)
            await db.commit()

        _task_store.setdefault(task_id, {}).update(
            {"status": "completed", "progress": 100, "current_agent": "Done"}
        )
        logger.info(f"[Background] {task_id} completed")

    except Exception as e:
        logger.exception(f"[Background] {task_id} failed: {e}")
        message = research_service.user_facing_error(e)
        _task_store.setdefault(task_id, {}).update(
            {"status": "failed", "progress": 0, "current_agent": None, "error": message}
        )
        try:
            async with AsyncSessionLocal() as db:
                await research_service.mark_failed(db, project_id, message)
                await db.commit()
        except Exception as inner_exc:
            logger.error(f"[Background] Failed to update project status: {inner_exc}")
