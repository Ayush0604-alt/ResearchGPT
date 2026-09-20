"""
Papers the user adds or removes by hand: by DOI or arXiv id, or by uploading a
PDF. Metadata comes from OpenAlex (DOI) or the arXiv API; the text is read the
same way collection reads it, and the PDF file itself is never stored.
"""

import json
from typing import Any, Dict, Optional

import httpx
from fastapi import HTTPException
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import Paper, ProjectStatus, ResearchProject
from app.services import collection_service
from app.services.search.records import PaperRecord, arxiv_id_from, normalize_doi, normalize_title
from app.services.search.sources import arxiv, openalex_by_doi, unpaywall_pdf
from app.utils.pdf_text import extract_pdf_text
from app.utils.safe_http import USER_AGENT

# A project is meant to be a focused review, not a library.
MAX_PAPERS_PER_PROJECT = 25


class PaperError(Exception):
    """A failure whose message is safe to show the user."""


def parse_identifier(text: str) -> tuple[str, str]:
    """'10.1000/abc', an arXiv id, or a link to either. Raises PaperError otherwise."""
    value = text.strip()
    arxiv_id = arxiv_id_from(value)
    if arxiv_id:
        return "arxiv", arxiv_id
    doi = normalize_doi(value)
    if doi:
        return "doi", doi
    raise PaperError("Enter a DOI (10.xxxx/...), an arXiv id, or a link to one.")


async def default_lookup(kind: str, value: str) -> Optional[PaperRecord]:
    """Metadata for one paper. Module-level so tests and the e2e server can patch it."""
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(20.0), headers={"User-Agent": USER_AGENT}
    ) as client:
        if kind == "arxiv":
            found = await arxiv(client, f"id:{value}", limit=1)
            return found[0] if found else None
        record = await openalex_by_doi(client, value)
        if record and not record.get("pdf_url"):
            try:
                record["pdf_url"] = await unpaywall_pdf(client, value)
            except httpx.HTTPError:
                pass
        return record


async def _guard(db: AsyncSession, project: ResearchProject) -> None:
    if collection_service.is_active(project):
        raise HTTPException(409, "Papers are still being collected. Try again in a moment.")
    count = await db.scalar(
        select(func.count()).select_from(Paper).where(Paper.project_id == project.id)
    )
    if count >= MAX_PAPERS_PER_PROJECT:
        raise PaperError(f"A project holds at most {MAX_PAPERS_PER_PROJECT} papers.")


def _needs_analysis(project: ResearchProject) -> None:
    """The papers changed, so the saved review no longer covers them."""
    if project.status != ProjectStatus.COLLECTING.value:
        project.status = ProjectStatus.COLLECTED.value
        project.error = None


async def _duplicate(db: AsyncSession, project_id: int, record: Dict[str, Any]) -> bool:
    papers = (
        await db.execute(
            select(Paper.doi, Paper.title, Paper.external_id).where(Paper.project_id == project_id)
        )
    ).all()
    doi = record.get("doi")
    title = normalize_title(record.get("title") or "")
    return any(
        (doi and p.doi == doi)
        or (record.get("external_id") and p.external_id == record.get("external_id"))
        or (title and normalize_title(p.title) == title)
        for p in papers
    )


async def _save(db: AsyncSession, project: ResearchProject, record: Dict[str, Any]) -> Paper:
    if await _duplicate(db, project.id, record):
        raise PaperError("That paper is already in this project.")
    paper = Paper(
        project_id=project.id,
        title=(record.get("title") or "Untitled")[:999],
        authors=json.dumps(record.get("authors") or []),
        abstract=record.get("abstract") or "",
        year=record.get("year"),
        url=(record.get("url") or "")[:1999],
        pdf_url=(record.get("pdf_url") or "")[:1999],
        source=record.get("source") or "manual",
        external_id=(record.get("external_id") or "")[:255],
        doi=record.get("doi") or None,
        full_text=record.get("full_text"),
        status="processed" if record.get("full_text") else "found",
    )
    db.add(paper)
    _needs_analysis(project)
    await db.commit()
    await db.refresh(paper)
    return paper


async def add_by_identifier(db: AsyncSession, project: ResearchProject, identifier: str) -> Paper:
    """Look a paper up by DOI or arXiv id, read its open-access PDF if there is one, and save it."""
    await _guard(db, project)
    kind, value = parse_identifier(identifier)
    try:
        record = await default_lookup(kind, value)
    except httpx.HTTPError as exc:
        logger.info(f"[Manual] Lookup failed for {kind} {value}: {type(exc).__name__}")
        raise PaperError(
            "The paper service couldn't be reached. Please try again shortly."
        ) from exc
    if not record or not record.get("title"):
        raise PaperError("No paper was found for that identifier.")

    data = dict(record)
    data["full_text"] = await collection_service.reuse_text(data.get("doi"), data.get("pdf_url"))
    if not data["full_text"] and data.get("pdf_url"):
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0), headers={"User-Agent": USER_AGENT}
        ) as client:
            data["full_text"] = await collection_service.default_fetch_text(client, data["pdf_url"])
    return await _save(db, project, data)


async def add_upload(
    db: AsyncSession, project: ResearchProject, content: bytes, filename: str
) -> Paper:
    """Save a paper from an uploaded PDF: its text is kept, the file itself is not."""
    await _guard(db, project)
    if len(content) > settings.MAX_PDF_SIZE_MB * 1024 * 1024:
        raise PaperError(f"PDFs must be smaller than {settings.MAX_PDF_SIZE_MB} MB.")
    text = await extract_pdf_text(content)
    if not text:
        raise PaperError("That file isn't a readable PDF (scanned pages have no text layer).")
    title = (filename or "Uploaded paper").rsplit("/", 1)[-1].removesuffix(".pdf").strip()
    return await _save(
        db,
        project,
        {
            "title": title[:999] or "Uploaded paper",
            "abstract": text[:1000],
            "source": "upload",
            "full_text": text,
        },
    )


async def remove(db: AsyncSession, project: ResearchProject, paper_id: int) -> None:
    paper = await db.scalar(
        select(Paper).where(Paper.id == paper_id, Paper.project_id == project.id)
    )
    if paper is None:
        raise HTTPException(404, "Paper not found")
    if collection_service.is_active(project):
        raise HTTPException(409, "Papers are still being collected. Try again in a moment.")
    await db.delete(paper)
    _needs_analysis(project)
    await db.commit()
