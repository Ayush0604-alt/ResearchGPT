"""
Combine results from several sources and queries into one ranked, de-duplicated list.
"""

from itertools import zip_longest
from typing import Dict, List, Optional

from rapidfuzz import fuzz

from app.services.search.records import PaperRecord, has_usable_abstract, normalize_title

TITLE_MATCH = 92  # rapidfuzz ratio on normalized titles


def interleave(lists: List[List[PaperRecord]]) -> List[PaperRecord]:
    """Round-robin: the top result of each list, then the second of each, …

    Each source (and query) orders its own results by relevance, so taking turns
    keeps the best of every source near the top instead of filling up from one.
    """
    return [r for row in zip_longest(*lists) for r in row if r is not None]


def _same_paper(a: PaperRecord, b: PaperRecord) -> bool:
    if a.get("doi") and a.get("doi") == b.get("doi"):
        return True
    if a.get("arxiv_id") and a.get("arxiv_id") == b.get("arxiv_id"):
        return True
    ta, tb = normalize_title(a.get("title") or ""), normalize_title(b.get("title") or "")
    return bool(ta and tb) and fuzz.ratio(ta, tb) >= TITLE_MATCH


def _absorb(kept: PaperRecord, dup: PaperRecord) -> None:
    """Fill gaps in the kept record from a duplicate found in another source."""
    for field in ("doi", "arxiv_id", "pdf_url", "year", "url"):
        if not kept.get(field) and dup.get(field):
            kept[field] = dup[field]  # type: ignore[literal-required]
    if len(dup.get("abstract") or "") > len(kept.get("abstract") or ""):
        kept["abstract"] = dup.get("abstract", "")
    if not kept.get("authors") and dup.get("authors"):
        kept["authors"] = dup["authors"]


def deduplicate(records: List[PaperRecord]) -> List[PaperRecord]:
    """Keep the first occurrence of each paper (by DOI, arXiv id, or near-identical
    title), enrich it from later duplicates, and drop papers without an abstract."""
    kept: List[PaperRecord] = []
    by_doi: Dict[str, PaperRecord] = {}
    by_arxiv: Dict[str, PaperRecord] = {}
    for record in records:
        match: Optional[PaperRecord] = None
        if record.get("doi"):
            match = by_doi.get(record["doi"])  # type: ignore[index]
        if match is None and record.get("arxiv_id"):
            match = by_arxiv.get(record["arxiv_id"])  # type: ignore[index]
        if match is None:
            match = next((k for k in kept if _same_paper(k, record)), None)
        if match is None:
            match = dict(record)  # type: ignore[assignment]
            kept.append(match)
        else:
            _absorb(match, record)
        if match.get("doi"):
            by_doi[match["doi"]] = match  # type: ignore[index]
        if match.get("arxiv_id"):
            by_arxiv[match["arxiv_id"]] = match  # type: ignore[index]
    return [r for r in kept if has_usable_abstract(r) and r.get("title")]
