"""
Paper collection: the only long-running job left on the server.

    search -> download open-access PDFs (SSRF-guarded, in memory) -> extract text -> save

It needs no LLM key. Progress and a heartbeat go to research_projects, so any
API instance can report on it, and a job that dies (restart, crash) is detected
by its stale heartbeat instead of hanging in 'collecting' forever.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

import httpx
from loguru import logger
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.models import LiteratureReview, Paper, ProjectStatus, ResearchProject
from app.services.search import search_papers
from app.utils.pdf_text import extract_pdf_text
from app.utils.safe_http import USER_AGENT, fetch_public

HEARTBEAT_EVERY = timedelta(seconds=15)
STALE_AFTER = timedelta(seconds=90)
DOWNLOAD_CONCURRENCY = 4
INTERRUPTED_MESSAGE = "Collecting papers was interrupted. Please run it again."
UNEXPECTED_MESSAGE = "Collecting papers failed unexpectedly. Please try again."

SearchFn = Callable[[str, int], Awaitable[List[Dict[str, Any]]]]
FetchTextFn = Callable[[httpx.AsyncClient, str], Awaitable[Optional[str]]]


class CollectionError(Exception):
    """A collection failure whose message is safe to show to the user."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Job state ────────────────────────────────────────────────────────────────


def is_active(project: ResearchProject) -> bool:
    """A collection is running and its heartbeat is fresh."""
    return (
        project.status == ProjectStatus.COLLECTING.value
        and project.heartbeat_at is not None
        and _now() - project.heartbeat_at < STALE_AFTER
    )


def start(project: ResearchProject) -> None:
    project.status = ProjectStatus.COLLECTING.value
    project.progress = 0
    project.current_step = "Starting"
    project.error = None
    project.started_at = project.heartbeat_at = _now()
    project.finished_at = None


def expire_if_stale(project: ResearchProject) -> bool:
    """Mark a dead collection as failed (on the loaded object; caller commits)."""
    if project.status == ProjectStatus.COLLECTING.value and not is_active(project):
        project.status = ProjectStatus.FAILED.value
        project.error = INTERRUPTED_MESSAGE
        project.current_step = None
        project.finished_at = _now()
        return True
    return False


async def fail_stale_collections(db: AsyncSession) -> int:
    """Fail every collection whose heartbeat is stale. Safe with several instances."""
    cutoff = _now() - STALE_AFTER
    result = await db.execute(
        update(ResearchProject)
        .where(
            ResearchProject.status == ProjectStatus.COLLECTING.value,
            or_(ResearchProject.heartbeat_at.is_(None), ResearchProject.heartbeat_at < cutoff),
        )
        .values(
            status=ProjectStatus.FAILED.value,
            error=INTERRUPTED_MESSAGE,
            current_step=None,
            finished_at=_now(),
        )
    )
    return result.rowcount


async def _set(project_id: int, **values: Any) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(ResearchProject)
            .where(ResearchProject.id == project_id)
            .values(heartbeat_at=_now(), **values)
        )
        await db.commit()


async def _heartbeat(project_id: int) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_EVERY.total_seconds())
        await _set(project_id)


# ── Steps ────────────────────────────────────────────────────────────────────


async def default_search(topic: str, max_papers: int) -> List[Dict[str, Any]]:
    return list(await search_papers([topic], max_papers))


async def default_fetch_text(client: httpx.AsyncClient, url: str) -> Optional[str]:
    """Download a PDF (public URLs only) and return its text, or None."""
    try:
        data, _ = await fetch_public(client, url, max_bytes=settings.MAX_PDF_SIZE_MB * 1024 * 1024)
    except Exception as exc:  # unreachable, unsafe, too large, 4xx/5xx…
        logger.info(f"[Collect] Skipping PDF {url[:120]}: {type(exc).__name__}")
        return None
    return await extract_pdf_text(data)


async def reuse_text(doi: Optional[str], pdf_url: Optional[str]) -> Optional[str]:
    """Text already extracted for the same paper (in any project), if any.
    Saves downloading and parsing a PDF that was read before."""
    conditions = []
    if doi:
        conditions.append(Paper.doi == doi)
    if pdf_url:
        conditions.append(Paper.pdf_url == pdf_url[:1999])
    if not conditions:
        return None
    async with AsyncSessionLocal() as db:
        return await db.scalar(
            select(Paper.full_text).where(or_(*conditions), Paper.full_text.is_not(None)).limit(1)
        )


async def replace_papers(db: AsyncSession, project_id: int, papers: List[Dict[str, Any]]) -> None:
    """Swap in freshly collected papers. The old review no longer matches them."""
    await db.execute(delete(Paper).where(Paper.project_id == project_id))
    await db.execute(delete(LiteratureReview).where(LiteratureReview.project_id == project_id))
    for data in papers:
        authors = data.get("authors") or []
        db.add(
            Paper(
                project_id=project_id,
                title=(data.get("title") or "Untitled")[:999],
                authors=json.dumps(authors) if isinstance(authors, list) else str(authors),
                abstract=data.get("abstract") or "",
                year=data.get("year"),
                url=(data.get("url") or "")[:1999],
                pdf_url=(data.get("pdf_url") or "")[:1999],
                source=data.get("source") or "",
                external_id=(data.get("external_id") or "")[:255],
                doi=(data.get("doi") or None),
                full_text=data.get("full_text"),
                status="processed" if data.get("full_text") else "found",
            )
        )


async def run(
    project_id: int,
    topic: str,
    max_papers: int,
    *,
    search: Optional[SearchFn] = None,
    fetch_text: Optional[FetchTextFn] = None,
) -> None:
    """Run one collection job to completion, recording success or failure."""
    # Resolved at call time so tests can patch the module-level defaults.
    search = search or default_search
    fetch_text = fetch_text or default_fetch_text
    with logger.contextualize(project_id=project_id):
        await _run(project_id, topic, max_papers, search, fetch_text)


async def _run(
    project_id: int, topic: str, max_papers: int, search: SearchFn, fetch_text: FetchTextFn
) -> None:
    logger.info(f"[Collect] Started: max_papers={max_papers}")
    beat = asyncio.create_task(_heartbeat(project_id))
    try:
        await _set(project_id, current_step="Searching for papers", progress=5)
        try:
            papers = await search(topic, max_papers)
        except Exception as exc:
            logger.exception(f"[Collect] Search failed for project {project_id}")
            raise CollectionError(
                "The paper search services couldn't be reached. Please try again shortly."
            ) from exc
        if not papers:
            raise CollectionError(
                "No papers with abstracts were found for this topic. "
                "Try a broader or differently worded topic."
            )

        total = len(papers)
        await _set(project_id, current_step=f"Reading {total} papers", progress=25)
        done = 0
        semaphore = asyncio.Semaphore(DOWNLOAD_CONCURRENCY)

        async def read(paper: Dict[str, Any], client: httpx.AsyncClient) -> None:
            nonlocal done
            paper["full_text"] = await reuse_text(paper.get("doi"), paper.get("pdf_url"))
            if not paper["full_text"] and paper.get("pdf_url"):
                async with semaphore:
                    paper["full_text"] = await fetch_text(client, paper["pdf_url"])
            done += 1
            await _set(project_id, progress=25 + int(65 * done / total))

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0), headers={"User-Agent": USER_AGENT}
        ) as client:
            await asyncio.gather(*(read(p, client) for p in papers))

        with_text = sum(1 for p in papers if p.get("full_text"))
        logger.info(f"[Collect] Project {project_id}: {total} papers, {with_text} with full text")

        async with AsyncSessionLocal() as db:
            await replace_papers(db, project_id, papers)
            await db.execute(
                update(ResearchProject)
                .where(ResearchProject.id == project_id)
                .values(
                    status=ProjectStatus.COLLECTED.value,
                    progress=100,
                    current_step=None,
                    finished_at=_now(),
                    heartbeat_at=_now(),
                )
            )
            await db.commit()
    except Exception as exc:
        if isinstance(exc, CollectionError):
            logger.info(f"[Collect] Failed: {exc}")
        else:
            logger.exception(f"[Collect] Project {project_id} failed")
        message = str(exc) if isinstance(exc, CollectionError) else UNEXPECTED_MESSAGE
        try:
            await _set(
                project_id,
                status=ProjectStatus.FAILED.value,
                error=message,
                current_step=None,
                finished_at=_now(),
            )
        except Exception:
            logger.exception(f"[Collect] Could not record failure for project {project_id}")
    finally:
        beat.cancel()
