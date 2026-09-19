"""
Research-run lifecycle and persistence: starting a run, storing its results,
and recording success or failure on the project.

Functions take a session and never commit; the caller owns the transaction.
"""

import json
from datetime import datetime, timezone
from typing import Any, Dict

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import (
    LiteratureReview,
    Paper,
    PaperFindings,
    PaperSummary,
    Presentation,
    ProjectStatus,
    ResearchProject,
)
from app.utils.gemini_client import RateLimitError

INTERRUPTED_MESSAGE = "This run was interrupted by a server restart. Please run it again."


class PipelineError(Exception):
    """A run failure whose message is safe to show to the user."""


def user_facing_error(exc: Exception) -> str:
    if isinstance(exc, PipelineError):
        return str(exc)
    if isinstance(exc, RateLimitError):
        return "The Gemini API rate limit was reached. Wait a minute, then run again."
    return "The pipeline failed unexpectedly. Please try again."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def start_run(project: ResearchProject, task_id: str) -> None:
    project.status = ProjectStatus.RUNNING.value
    project.task_id = task_id
    project.error = None
    project.started_at = _now()
    project.finished_at = None


async def mark_completed(db: AsyncSession, project_id: int) -> None:
    await db.execute(
        update(ResearchProject)
        .where(ResearchProject.id == project_id)
        .values(status=ProjectStatus.COMPLETED.value, error=None, finished_at=_now())
    )


async def mark_failed(db: AsyncSession, project_id: int, message: str) -> None:
    await db.execute(
        update(ResearchProject)
        .where(ResearchProject.id == project_id)
        .values(status=ProjectStatus.FAILED.value, error=message, finished_at=_now())
    )


async def fail_interrupted_runs(db: AsyncSession) -> int:
    """Mark every RUNNING project as FAILED. Returns how many were changed."""
    result = await db.execute(
        update(ResearchProject)
        .where(ResearchProject.status == ProjectStatus.RUNNING.value)
        .values(status=ProjectStatus.FAILED.value, error=INTERRUPTED_MESSAGE, finished_at=_now())
    )
    return result.rowcount


def validate_results(final_state: Dict[str, Any]) -> None:
    """Refuse to report an empty run as completed."""
    if not final_state.get("papers"):
        raise PipelineError(
            "No papers with abstracts were found for this topic. "
            "Try a broader or differently worded topic."
        )
    if not final_state.get("literature_review"):
        raise PipelineError("The analysis step returned no review. Please run again.")


def _paper_from_dict(project_id: int, data: Dict[str, Any]) -> Paper:
    authors = data.get("authors", [])
    return Paper(
        project_id=project_id,
        title=(data.get("title") or "")[:999],
        authors=json.dumps(authors) if isinstance(authors, list) else str(authors),
        abstract=data.get("abstract", ""),
        year=data.get("year"),
        url=(data.get("url") or "")[:1999],
        pdf_url=(data.get("pdf_url") or "")[:1999],
        pdf_path=data.get("pdf_path"),
        source=data.get("source", ""),
        external_id=data.get("external_id", ""),
        status="processed",
    )


async def replace_results(db: AsyncSession, project_id: int, final_state: Dict[str, Any]) -> None:
    """Swap the project's papers and review for a run's results, in one transaction."""
    # Summaries and findings go with their papers via ON DELETE CASCADE.
    for model in (Paper, LiteratureReview, Presentation):
        await db.execute(delete(model).where(model.project_id == project_id))

    for data in final_state.get("papers", []):
        paper = _paper_from_dict(project_id, data)
        db.add(paper)
        await db.flush()  # assigns paper.id

        if data.get("summary"):
            db.add(
                PaperSummary(
                    paper_id=paper.id,
                    summary=data.get("summary"),
                    methodology=data.get("methodology"),
                    conclusion=data.get("conclusion"),
                )
            )
        findings = data.get("findings") or {}
        if any(v is not None for v in findings.values()):
            db.add(
                PaperFindings(
                    paper_id=paper.id,
                    model_used=findings.get("model_used"),
                    dataset_used=findings.get("dataset_used"),
                    accuracy=findings.get("accuracy"),
                    contributions=findings.get("contributions"),
                    limitations=findings.get("limitations"),
                    raw_json=findings,
                )
            )

    review = final_state.get("literature_review") or {}
    db.add(
        LiteratureReview(
            project_id=project_id,
            introduction=review.get("introduction"),
            body=review.get("body"),
            discussion=review.get("discussion"),
            conclusion=review.get("conclusion"),
            trends=final_state.get("trends"),
            gaps=final_state.get("gaps"),
            comparison=final_state.get("comparison"),
        )
    )
