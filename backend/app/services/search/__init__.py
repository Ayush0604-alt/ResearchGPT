"""
Paper search across Semantic Scholar, OpenAlex, arXiv and Europe PMC.

    search_papers(["graph transformers", ...], limit=40)

Every (query, source) pair runs concurrently. Results are interleaved so each
source's best hits stay near the top, de-duplicated by DOI, arXiv id or title,
and papers with a DOI but no PDF link get one from Unpaywall when it exists.
"""

import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional

import httpx
from loguru import logger

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.models import SearchCache
from app.services.search.merge import deduplicate, interleave
from app.services.search.records import PaperRecord
from app.services.search.sources import SOURCES, unpaywall_pdf
from app.utils.safe_http import USER_AGENT

PER_QUERY_LIMIT = 15
UNPAYWALL_LOOKUPS = 20


class SearchUnavailable(Exception):
    """Every source failed; nothing could be searched."""


def _cache_key(name: str, query: str, limit: int, year_from, year_to) -> str:
    request = [name, " ".join(query.lower().split()), limit, year_from, year_to]
    return hashlib.sha256(json.dumps(request).encode()).hexdigest()


async def _cached_search(
    client: httpx.AsyncClient,
    name: str,
    query: str,
    limit: int,
    year_from: Optional[int],
    year_to: Optional[int],
) -> List[PaperRecord]:
    """One source call, answered from the search cache when a fresh copy exists.
    Cache problems never fail a search: they fall back to the live source."""
    key = _cache_key(name, query, limit, year_from, year_to)
    ttl = timedelta(days=settings.SEARCH_CACHE_DAYS)
    try:
        async with AsyncSessionLocal() as db:
            row = await db.get(SearchCache, key)
            if row and datetime.now(timezone.utc) - row.created_at < ttl:
                return row.results
    except Exception:
        logger.exception("[Search] cache read failed")

    results = await SOURCES[name](client, query, limit, year_from, year_to)

    if settings.SEARCH_CACHE_DAYS > 0:
        try:
            async with AsyncSessionLocal() as db:
                await db.merge(
                    SearchCache(key=key, results=results, created_at=datetime.now(timezone.utc))
                )
                await db.commit()
        except Exception:
            logger.exception("[Search] cache write failed")
    return results


async def _add_open_access_pdfs(client: httpx.AsyncClient, records: List[PaperRecord]) -> None:
    missing = [r for r in records if not r.get("pdf_url") and r.get("doi")][:UNPAYWALL_LOOKUPS]
    semaphore = asyncio.Semaphore(5)

    async def lookup(record: PaperRecord) -> None:
        async with semaphore:
            try:
                pdf = await unpaywall_pdf(client, record["doi"])  # type: ignore[arg-type]
            except httpx.HTTPError:
                return
            if pdf:
                record["pdf_url"] = pdf

    await asyncio.gather(*(lookup(r) for r in missing))


async def search_papers(
    queries: Iterable[str],
    limit: int,
    *,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
    sources: Optional[Iterable[str]] = None,
    per_query: int = PER_QUERY_LIMIT,
) -> List[PaperRecord]:
    queries = [q.strip() for q in queries if q and q.strip()]
    names = [s for s in (sources or SOURCES) if s in SOURCES]
    if not queries or not names:
        return []

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(20.0), headers={"User-Agent": USER_AGENT}
    ) as client:
        pairs = [(name, q) for name in names for q in queries]
        results = await asyncio.gather(
            *(_cached_search(client, name, q, per_query, year_from, year_to) for name, q in pairs),
            return_exceptions=True,
        )
        lists: List[List[PaperRecord]] = []
        for (name, query), result in zip(pairs, results, strict=False):
            if isinstance(result, BaseException):
                logger.warning(f"[Search] {name} failed for {query!r}: {type(result).__name__}")
            else:
                lists.append(result)
        if not lists:
            raise SearchUnavailable("All paper sources failed")

        merged = deduplicate(interleave(lists))[:limit]
        await _add_open_access_pdfs(client, merged)

    with_pdf = sum(1 for r in merged if r.get("pdf_url"))
    logger.info(f"[Search] {len(merged)} papers ({with_pdf} with a PDF link) from {names}")
    return merged
