"""
Quality metrics for a finished literature review, used to compare prompt
versions (see scripts/eval_reviews.py and eval/README.md).

All metrics are computed from what is already stored: the review text, its
claim-level citation checks, and the run metadata the browser reported. None
of them needs a model call.
"""

import re
from collections import defaultdict
from statistics import mean
from typing import Any, Iterable, Mapping, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import LiteratureReview, Paper, PaperSummary, ResearchProject

PROSE_SECTIONS = ("introduction", "body", "discussion", "trends", "gaps", "conclusion")
ALL_SECTIONS = PROSE_SECTIONS + ("comparison",)

_CITE = re.compile(r"\[P(\d+)\]")
_WORD = re.compile(r"[^\W_][\w'-]*")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\[(])")


def _sentences(text: str) -> list[str]:
    out: list[str] = []
    for line in text.splitlines():
        line = re.sub(r"^\s*([-*]|\d+\.)\s+", "", line).strip()
        if line and not line.startswith("#"):
            out.extend(s for s in _SENTENCE_END.split(line) if len(s.strip()) >= 20)
    return out


def review_metrics(
    review: Mapping[str, Any], papers_available: int, run_meta: Optional[Mapping] = None
) -> dict[str, Optional[float]]:
    """
    Metrics for one review. Higher is better except `unsupported_rate`,
    `removed_citations` and `tokens`.

    - sections_filled: non-empty sections out of 7
    - words: words in the prose sections
    - citation_density: share of prose sentences citing at least one paper
    - coverage: share of the project's usable papers the review cites
    - supported_rate / unsupported_rate: citation-check verdicts over checked claims
    - removed_citations: citations to papers that don't exist, stripped before saving
    - tokens: input + output tokens for the whole run
    """
    prose = [str(review.get(s) or "") for s in PROSE_SECTIONS]
    sentences = [s for text in prose for s in _sentences(text)]
    cited = [s for s in sentences if _CITE.search(s)]
    all_text = " ".join(str(review.get(s) or "") for s in ALL_SECTIONS)
    papers_cited = {int(m) for m in _CITE.findall(all_text)}

    checks = review.get("citation_checks") or []
    verdicts = [c.get("verdict") for c in checks]
    usage = (run_meta or {}).get("usage") or {}

    def share(part: int, whole: int) -> Optional[float]:
        return round(part / whole, 3) if whole else None

    return {
        "sections_filled": sum(1 for s in ALL_SECTIONS if str(review.get(s) or "").strip()),
        "words": sum(len(_WORD.findall(_CITE.sub("", text))) for text in prose),
        "citation_density": share(len(cited), len(sentences)),
        "coverage": share(len(papers_cited), papers_available),
        "supported_rate": share(verdicts.count("supported"), len(verdicts)),
        "unsupported_rate": share(verdicts.count("unsupported"), len(verdicts)),
        "removed_citations": (run_meta or {}).get("removed_citations"),
        "tokens": (
            sum(u.get("input_tokens", 0) + u.get("output_tokens", 0) for u in usage.values())
            if usage
            else None
        ),
    }


def compare(rows: Iterable[tuple[str, Mapping[str, Optional[float]]]]) -> dict[str, dict]:
    """Average each metric per group (e.g. prompt version), ignoring missing values."""
    groups: dict[str, list[Mapping[str, Optional[float]]]] = defaultdict(list)
    for key, metrics in rows:
        groups[key].append(metrics)
    out: dict[str, dict] = {}
    for key, items in sorted(groups.items()):
        summary: dict[str, Any] = {"reviews": len(items)}
        for name in items[0]:
            values = [m[name] for m in items if m.get(name) is not None]
            summary[name] = round(mean(values), 3) if values else None
        out[key] = summary
    return out


async def load_rows(db: AsyncSession, topics: Optional[set[str]] = None) -> list[dict[str, Any]]:
    """Every stored review (optionally only for the given topics) with its metrics."""
    analysed = (
        select(Paper.project_id, func.count(PaperSummary.id).label("n"))
        .join(PaperSummary, PaperSummary.paper_id == Paper.id)
        .group_by(Paper.project_id)
        .subquery()
    )
    query = (
        select(LiteratureReview, ResearchProject.topic, func.coalesce(analysed.c.n, 0))
        .join(ResearchProject, ResearchProject.id == LiteratureReview.project_id)
        .outerjoin(analysed, analysed.c.project_id == LiteratureReview.project_id)
        .order_by(LiteratureReview.id)
    )
    rows = []
    for review, topic, n_analysed in (await db.execute(query)).all():
        if topics is not None and topic.strip().lower() not in topics:
            continue
        fields = {s: getattr(review, s) for s in ALL_SECTIONS}
        fields["citation_checks"] = review.citation_checks
        meta = review.run_meta or {}
        rows.append(
            {
                "project_id": review.project_id,
                "topic": topic,
                "prompt_version": meta.get("prompt_version", "unknown"),
                "models": meta.get("models", {}),
                "metrics": review_metrics(fields, n_analysed, meta),
            }
        )
    return rows
