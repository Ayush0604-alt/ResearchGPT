"""
Academic search sources. Each takes a query and returns PaperRecords.

All are free. Semantic Scholar and OpenAlex accept optional API keys for higher
limits; OpenAlex and Unpaywall want a contact email (CONTACT_EMAIL).
"""

import html
import re
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional

import httpx
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.services.search.records import PaperRecord, arxiv_id_from, normalize_doi


def _transient(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and (
        exc.response.status_code == 429 or exc.response.status_code >= 500
    )


@retry(
    retry=retry_if_exception(_transient),
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=1, max=8),
    reraise=True,
)
async def _get(
    client: httpx.AsyncClient,
    url: str,
    params: Dict[str, Any],
    headers: Optional[Dict[str, str]] = None,
) -> httpx.Response:
    resp = await client.get(url, params=params, headers=headers)
    resp.raise_for_status()
    return resp


def _clean(text: Optional[str]) -> str:
    """Strip HTML tags/entities that some sources embed in abstracts."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()


# ── Semantic Scholar ─────────────────────────────────────────────────────────


async def semantic_scholar(
    client: httpx.AsyncClient,
    query: str,
    limit: int,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
) -> List[PaperRecord]:
    params: Dict[str, Any] = {
        "query": query,
        "limit": min(limit, 100),
        "fields": "title,authors,abstract,year,externalIds,openAccessPdf,url",
    }
    if year_from or year_to:
        params["year"] = f"{year_from or ''}-{year_to or ''}"
    headers = (
        {"x-api-key": settings.SEMANTIC_SCHOLAR_API_KEY}
        if settings.SEMANTIC_SCHOLAR_API_KEY
        else None
    )
    data = (
        await _get(client, "https://api.semanticscholar.org/graph/v1/paper/search", params, headers)
    ).json()

    records: List[PaperRecord] = []
    for p in data.get("data") or []:
        ids = p.get("externalIds") or {}
        records.append(
            PaperRecord(
                title=p.get("title") or "",
                authors=[a.get("name", "") for a in p.get("authors") or []],
                abstract=_clean(p.get("abstract")),
                year=p.get("year"),
                url=p.get("url") or "",
                pdf_url=(p.get("openAccessPdf") or {}).get("url") or None,
                doi=normalize_doi(ids.get("DOI")),
                arxiv_id=arxiv_id_from(ids.get("ArXiv")) if ids.get("ArXiv") else None,
                source="semantic_scholar",
                external_id=p.get("paperId") or "",
            )
        )
    return records


# ── arXiv ────────────────────────────────────────────────────────────────────

_ATOM = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}


def arxiv_query(query: str, year_from: Optional[int] = None, year_to: Optional[int] = None) -> str:
    """AND the topic's terms: `all:graph AND all:neural`. A bare multi-word
    string would be parsed loosely and match unrelated papers."""
    terms = re.findall(r"[\w-]+", query)[:8] or [query]
    q = " AND ".join(f"all:{t}" for t in terms)
    if year_from or year_to:
        start = f"{year_from or 1991}01010000"
        end = f"{year_to or 2100}12312359"
        q += f" AND submittedDate:[{start} TO {end}]"
    return q


async def arxiv(
    client: httpx.AsyncClient,
    query: str,
    limit: int,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
) -> List[PaperRecord]:
    params = {
        "search_query": arxiv_query(query, year_from, year_to),
        "start": 0,
        "max_results": min(limit, 50),
        "sortBy": "relevance",
    }
    root = ET.fromstring((await _get(client, "https://export.arxiv.org/api/query", params)).text)

    records: List[PaperRecord] = []
    for entry in root.findall("atom:entry", _ATOM):
        abs_url = entry.findtext("atom:id", default="", namespaces=_ATOM).strip()
        arxiv_id = arxiv_id_from(abs_url)
        published = entry.findtext("atom:published", default="", namespaces=_ATOM)
        pdf_link = next(
            (
                link.get("href")
                for link in entry.findall("atom:link", _ATOM)
                if link.get("title") == "pdf"
            ),
            None,
        )
        records.append(
            PaperRecord(
                title=_clean(entry.findtext("atom:title", default="", namespaces=_ATOM)),
                authors=[
                    a.findtext("atom:name", default="", namespaces=_ATOM)
                    for a in entry.findall("atom:author", _ATOM)
                ],
                abstract=_clean(entry.findtext("atom:summary", default="", namespaces=_ATOM)),
                year=int(published[:4]) if published[:4].isdigit() else None,
                url=abs_url,
                pdf_url=pdf_link or (f"https://arxiv.org/pdf/{arxiv_id}" if arxiv_id else None),
                doi=normalize_doi(entry.findtext("arxiv:doi", default="", namespaces=_ATOM)),
                arxiv_id=arxiv_id,
                source="arxiv",
                external_id=arxiv_id or abs_url,
            )
        )
    return records


# ── OpenAlex ─────────────────────────────────────────────────────────────────


def rebuild_abstract(inverted: Optional[Dict[str, List[int]]]) -> str:
    """OpenAlex ships abstracts as {word: [positions]}; put the words back in order."""
    if not inverted:
        return ""
    positions = [(pos, word) for word, places in inverted.items() for pos in places]
    return " ".join(word for _, word in sorted(positions))


def _openalex_params(**extra: Any) -> Dict[str, Any]:
    params: Dict[str, Any] = dict(extra)
    if settings.CONTACT_EMAIL:
        params["mailto"] = settings.CONTACT_EMAIL
    if settings.OPENALEX_API_KEY:
        params["api_key"] = settings.OPENALEX_API_KEY
    return params


def _openalex_record(w: Dict[str, Any]) -> PaperRecord:
    best = w.get("best_oa_location") or {}
    primary = w.get("primary_location") or {}
    doi = normalize_doi(w.get("doi"))
    return PaperRecord(
        title=_clean(w.get("display_name") or w.get("title")),
        authors=[
            (a.get("author") or {}).get("display_name", "") for a in w.get("authorships") or []
        ],
        abstract=rebuild_abstract(w.get("abstract_inverted_index")),
        year=w.get("publication_year"),
        url=primary.get("landing_page_url") or w.get("doi") or w.get("id") or "",
        pdf_url=best.get("pdf_url") or primary.get("pdf_url") or None,
        doi=doi,
        arxiv_id=arxiv_id_from(doi) if doi else None,
        source="openalex",
        external_id=(w.get("id") or "").rsplit("/", 1)[-1],
    )


async def openalex_by_doi(client: httpx.AsyncClient, doi: str) -> Optional[PaperRecord]:
    """One work, looked up by DOI. None when OpenAlex doesn't know it."""
    resp = await client.get(f"https://api.openalex.org/works/doi:{doi}", params=_openalex_params())
    return _openalex_record(resp.json()) if resp.status_code == 200 else None


async def openalex_neighbours(
    client: httpx.AsyncClient, dois: List[str], limit: int
) -> List[PaperRecord]:
    """Snowballing: highly cited works that the seed papers reference, plus the
    most-cited works that cite them. Seeds are identified by DOI."""
    works_url = "https://api.openalex.org/works"
    seeds = []
    for doi in dois[:5]:
        try:
            seeds.append((await _get(client, f"{works_url}/doi:{doi}", _openalex_params())).json())
        except httpx.HTTPError:
            continue  # unknown to OpenAlex
    if not seeds:
        return []

    referenced = [w.rsplit("/", 1)[-1] for s in seeds for w in s.get("referenced_works") or []]
    seed_ids = [(s.get("id") or "").rsplit("/", 1)[-1] for s in seeds if s.get("id")]
    queries = []
    if referenced:
        queries.append(f"openalex:{'|'.join(dict.fromkeys(referenced[:100]))},has_abstract:true")
    if seed_ids:
        queries.append(f"cites:{'|'.join(seed_ids)},has_abstract:true")

    records: List[PaperRecord] = []
    for filter_ in queries:
        params = _openalex_params(
            filter=filter_, sort="cited_by_count:desc", **{"per-page": min(limit, 50)}
        )
        data = (await _get(client, works_url, params)).json()
        records.extend(_openalex_record(w) for w in data.get("results") or [])
    return records


async def openalex(
    client: httpx.AsyncClient,
    query: str,
    limit: int,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
) -> List[PaperRecord]:
    filters = ["has_abstract:true"]
    if year_from:
        filters.append(f"from_publication_date:{year_from}-01-01")
    if year_to:
        filters.append(f"to_publication_date:{year_to}-12-31")
    params = _openalex_params(
        search=query, filter=",".join(filters), **{"per-page": min(limit, 50)}
    )
    data = (await _get(client, "https://api.openalex.org/works", params)).json()

    return [_openalex_record(w) for w in data.get("results") or []]


# ── Europe PMC (covers PubMed, adds open-access full-text links) ────────────

# Characters Europe PMC reads as query syntax. Queries are planned by a model,
# so an unbalanced bracket or a stray colon would make the whole search 400 and
# silently drop this source. The API offers no escape, so drop them and keep the
# words — which is what the query meant anyway.
_EPMC_SYNTAX = re.compile(r'[()\[\]{}":*?^~\\/]+')
# Bare booleans left in the text would combine with the filter below.
_EPMC_BOOLEANS = {"and", "or", "not"}


def _epmc_terms(query: str) -> str:
    cleaned = _EPMC_SYNTAX.sub(" ", query)
    words = [w for w in cleaned.split() if w.lower() not in _EPMC_BOOLEANS]
    return " ".join(words) or "research"


async def europepmc(
    client: httpx.AsyncClient,
    query: str,
    limit: int,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
) -> List[PaperRecord]:
    q = f"({_epmc_terms(query)}) AND HAS_ABSTRACT:y"
    if year_from or year_to:
        q += f" AND PUB_YEAR:[{year_from or 1800} TO {year_to or 2100}]"
    params = {"query": q, "format": "json", "resultType": "core", "pageSize": min(limit, 100)}
    data = (
        await _get(client, "https://www.ebi.ac.uk/europepmc/webservices/rest/search", params)
    ).json()

    records: List[PaperRecord] = []
    for r in (data.get("resultList") or {}).get("result") or []:
        links = ((r.get("fullTextUrlList") or {}).get("fullTextUrl")) or []
        pdf = next(
            (
                u.get("url")
                for u in links
                if u.get("documentStyle") == "pdf" and u.get("availabilityCode") in ("OA", "F")
            ),
            None,
        )
        year = r.get("pubYear")
        records.append(
            PaperRecord(
                title=_clean(r.get("title")),
                authors=[a.strip() for a in (r.get("authorString") or "").rstrip(".").split(",")]
                if r.get("authorString")
                else [],
                abstract=_clean(r.get("abstractText")),
                year=int(year) if str(year or "").isdigit() else None,
                url=f"https://europepmc.org/article/{r.get('source', 'MED')}/{r.get('id', '')}",
                pdf_url=pdf,
                doi=normalize_doi(r.get("doi")),
                arxiv_id=None,
                source="europepmc",
                external_id=str(r.get("id") or ""),
            )
        )
    return records


# ── Unpaywall (finds a free PDF for a DOI) ───────────────────────────────────


async def unpaywall_pdf(client: httpx.AsyncClient, doi: str) -> Optional[str]:
    if not settings.CONTACT_EMAIL:
        return None  # Unpaywall requires an email address
    resp = await client.get(
        f"https://api.unpaywall.org/v2/{doi}", params={"email": settings.CONTACT_EMAIL}
    )
    if resp.status_code != 200:
        return None
    best = resp.json().get("best_oa_location") or {}
    return best.get("url_for_pdf") or None


SOURCES = {
    "semantic_scholar": semantic_scholar,
    "openalex": openalex,
    "arxiv": arxiv,
    "europepmc": europepmc,
}
