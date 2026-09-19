"""
Paper search across Semantic Scholar, OpenAlex, arXiv and Europe PMC.

    search_papers(["graph transformers", ...], limit=40)

Every (query, source) pair runs concurrently. Results are interleaved so each
source's best hits stay near the top, de-duplicated by DOI, arXiv id or title,
and papers with a DOI but no PDF link get one from Unpaywall when it exists.
"""

import asyncio
from typing import Iterable, List, Optional

import httpx
from loguru import logger

from app.services.search.merge import deduplicate, interleave
from app.services.search.records import PaperRecord
from app.services.search.sources import SOURCES, unpaywall_pdf
from app.utils.safe_http import USER_AGENT

PER_QUERY_LIMIT = 15
UNPAYWALL_LOOKUPS = 20


class SearchUnavailable(Exception):
    """Every source failed; nothing could be searched."""


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
            *(SOURCES[name](client, q, per_query, year_from, year_to) for name, q in pairs),
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
