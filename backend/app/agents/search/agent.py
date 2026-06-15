"""
Agent 1: Paper Search Agent
Searches Semantic Scholar, ArXiv, and PubMed for relevant papers.
"""
import asyncio
from typing import List, Dict, Any, Optional
import httpx
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings


class PaperSearchAgent:
    """
    Searches multiple academic sources and returns paper metadata.
    Returns a unified list of PaperMetadata dicts.
    """

    def __init__(self):
        self.timeout = httpx.Timeout(30.0)
        self.headers = {"User-Agent": "ResearchGPT/1.0 (mailto:contact@researchgpt.ai)"}

    # ── Public entry ──────────────────────────────────────────────────────────

    async def run(self, topic: str, max_results: int = 10) -> List[Dict[str, Any]]:
        """Run all three search sources concurrently and deduplicate."""
        logger.info(f"[SearchAgent] Searching for topic='{topic}' max={max_results}")

        results = await asyncio.gather(
            self._search_semantic_scholar(topic, max_results),
            self._search_arxiv(topic, max_results),
            self._search_pubmed(topic, max_results),
            return_exceptions=True,
        )

        all_papers: List[Dict[str, Any]] = []
        for r in results:
            if isinstance(r, Exception):
                logger.warning(f"[SearchAgent] Source error: {r}")
            else:
                all_papers.extend(r)

        deduped = self._deduplicate(all_papers)
        logger.info(f"[SearchAgent] Found {len(deduped)} unique papers")
        return deduped[:max_results]

    # ── Semantic Scholar ───────────────────────────────────────────────────────

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    async def _search_semantic_scholar(self, topic: str, limit: int) -> List[Dict]:
        url = "https://api.semanticscholar.org/graph/v1/paper/search"
        params = {
            "query": topic,
            "limit": min(limit, 10),
            "fields": "title,authors,abstract,year,externalIds,openAccessPdf,url",
        }
        async with httpx.AsyncClient(timeout=self.timeout, headers=self.headers) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for p in data.get("data", []):
            pdf_url = None
            if p.get("openAccessPdf"):
                pdf_url = p["openAccessPdf"].get("url")
            papers.append({
                "title":       p.get("title", ""),
                "authors":     [a["name"] for a in p.get("authors", [])],
                "abstract":    p.get("abstract", ""),
                "year":        p.get("year"),
                "url":         p.get("url", ""),
                "pdf_url":     pdf_url,
                "source":      "semantic_scholar",
                "external_id": p.get("paperId", ""),
            })
        logger.debug(f"[Semantic Scholar] {len(papers)} papers")
        return papers

    # ── ArXiv ─────────────────────────────────────────────────────────────────

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    async def _search_arxiv(self, topic: str, limit: int) -> List[Dict]:
        import xml.etree.ElementTree as ET

        url = "https://export.arxiv.org/api/query"
        params = {
            "search_query": f"all:{topic}",
            "start": 0,
            "max_results": min(limit, 10),
            "sortBy": "relevance",
        }
        async with httpx.AsyncClient(timeout=self.timeout, headers=self.headers) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()

        ns = {"atom": "http://www.w3.org/2005/Atom"}
        root = ET.fromstring(resp.text)
        papers = []

        for entry in root.findall("atom:entry", ns):
            title   = entry.findtext("atom:title", default="", namespaces=ns).strip()
            summary = entry.findtext("atom:summary", default="", namespaces=ns).strip()
            pub_date = entry.findtext("atom:published", default="", namespaces=ns)
            year    = int(pub_date[:4]) if pub_date else None

            authors = [
                a.findtext("atom:name", default="", namespaces=ns)
                for a in entry.findall("atom:author", ns)
            ]

            arxiv_id = entry.findtext("atom:id", default="", namespaces=ns)
            pdf_url  = arxiv_id.replace("/abs/", "/pdf/") + ".pdf" if "/abs/" in arxiv_id else None

            papers.append({
                "title":       title,
                "authors":     authors,
                "abstract":    summary,
                "year":        year,
                "url":         arxiv_id,
                "pdf_url":     pdf_url,
                "source":      "arxiv",
                "external_id": arxiv_id,
            })

        logger.debug(f"[ArXiv] {len(papers)} papers")
        return papers

    # ── PubMed ────────────────────────────────────────────────────────────────

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    async def _search_pubmed(self, topic: str, limit: int) -> List[Dict]:
        import xml.etree.ElementTree as ET
        base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

        async with httpx.AsyncClient(timeout=self.timeout, headers=self.headers) as client:
            # Step 1: get IDs
            search_resp = await client.get(
                f"{base}/esearch.fcgi",
                params={"db": "pubmed", "term": topic, "retmax": min(limit, 10), "retmode": "json"},
            )
            search_resp.raise_for_status()
            ids = search_resp.json().get("esearchresult", {}).get("idlist", [])

            if not ids:
                return []

            # Step 2: fetch XML abstracts
            fetch_resp = await client.get(
                f"{base}/efetch.fcgi",
                params={"db": "pubmed", "id": ",".join(ids), "retmode": "xml"},
            )
            fetch_resp.raise_for_status()
            root = ET.fromstring(fetch_resp.text)

        papers = []
        for article in root.findall(".//PubmedArticle"):
            pmid = article.findtext(".//PMID", default="")
            title = article.findtext(".//ArticleTitle", default="")
            
            # Combine all abstract text parts
            abstract_texts = article.findall(".//AbstractText")
            abstract = " ".join([a.text for a in abstract_texts if a.text])
            
            # Authors
            authors = []
            for author in article.findall(".//Author"):
                last = author.findtext("LastName", default="")
                init = author.findtext("Initials", default="")
                if last:
                    authors.append(f"{last} {init}".strip())
                    
            year_elem = article.findtext(".//PubDate/Year")
            year = int(year_elem) if year_elem and year_elem.isdigit() else None
            
            if title and abstract:
                papers.append({
                    "title":       title,
                    "authors":     authors,
                    "abstract":    abstract,
                    "year":        year,
                    "url":         f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                    "pdf_url":     None,
                    "source":      "pubmed",
                    "external_id": pmid,
                })

        logger.debug(f"[PubMed] {len(papers)} papers")
        return papers

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _deduplicate(self, papers: List[Dict]) -> List[Dict]:
        """Remove duplicates by normalised title and filter out papers without abstracts."""
        seen = set()
        unique = []
        for p in papers:
            if not p.get("abstract") or len(p["abstract"].strip()) < 20:
                continue
            key = p.get("title", "").lower().strip()[:80]
            if key and key not in seen:
                seen.add(key)
                unique.append(p)
        return unique
