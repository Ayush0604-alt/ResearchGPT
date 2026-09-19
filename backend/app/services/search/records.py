"""
The common paper record every source returns, and identifier helpers.
"""

import re
from typing import List, Optional, TypedDict


class PaperRecord(TypedDict, total=False):
    title: str
    authors: List[str]
    abstract: str
    year: Optional[int]
    url: str
    pdf_url: Optional[str]
    doi: Optional[str]  # lower-case, without https://doi.org/
    arxiv_id: Optional[str]  # e.g. "2106.01234", without version
    source: str  # semantic_scholar | arxiv | openalex | europepmc
    external_id: str


_DOI = re.compile(r"10\.\d{4,9}/\S+", re.IGNORECASE)
_ARXIV_NEW = re.compile(r"(\d{4}\.\d{4,5})(v\d+)?")
_ARXIV_OLD = re.compile(r"([a-z\-]+(\.[A-Z]{2})?/\d{7})(v\d+)?", re.IGNORECASE)


def normalize_doi(value: Optional[str]) -> Optional[str]:
    """'https://doi.org/10.1000/ABC' -> '10.1000/abc'. None if there's no DOI."""
    if not value:
        return None
    match = _DOI.search(value)
    return match.group(0).rstrip(".").lower() if match else None


def arxiv_id_from(value: Optional[str]) -> Optional[str]:
    """Extract an arXiv id from a URL, id or arXiv DOI (10.48550/arXiv.XXXX)."""
    if not value:
        return None
    if "arxiv" not in value.lower() and not _ARXIV_NEW.fullmatch(value.strip()):
        return None
    match = _ARXIV_NEW.search(value) or _ARXIV_OLD.search(value.split("arxiv.org/")[-1])
    return match.group(1) if match else None


def normalize_title(title: str) -> str:
    """Lower-case, punctuation removed, whitespace collapsed: for duplicate matching."""
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", title.lower())).strip()


def has_usable_abstract(record: PaperRecord) -> bool:
    return len((record.get("abstract") or "").strip()) >= 20
