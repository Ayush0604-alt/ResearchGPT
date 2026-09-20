"""
Passage retrieval for chat: papers are split into ~1,500-character chunks and
searched with Postgres full-text search, so an answer can quote the paper
itself rather than only its extracted summary.

A project holds at most a few dozen papers, so keyword search over a GIN index
is fast and needs no embeddings (which would have to be computed with the
user's key in the browser). Chunks are built the first time a project is
searched and disappear with their paper.
"""

import re

from sqlalchemy import Text, cast, exists, func, select
from sqlalchemy.dialects.postgresql import TSQUERY, insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.db.session import AsyncSessionLocal
from app.models.models import Paper, PaperChunk

CHUNK_CHARS = 1_500
MAX_CHUNKS_PER_PAPER = 120  # ~180k characters, above the collector's text cap

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def chunk_text(text: str, size: int = CHUNK_CHARS) -> list[str]:
    """Split text into passages of about `size` characters on paragraph, then sentence, bounds."""
    pieces: list[str] = []
    for para in re.split(r"\n\s*\n", text):
        para = " ".join(para.split())
        if not para:
            continue
        if len(para) <= size:
            pieces.append(para)
            continue
        for sentence in _SENTENCE_END.split(para):
            # A "sentence" longer than a chunk (tables, references) is cut hard.
            pieces.extend(sentence[i : i + size] for i in range(0, len(sentence), size))

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if current and len(current) + 1 + len(piece) > size:
            chunks.append(current)
            current = piece
        else:
            current = f"{current} {piece}" if current else piece
    if current:
        chunks.append(current)
    return chunks[:MAX_CHUNKS_PER_PAPER]


async def ensure_chunks(db: AsyncSession, project_id: int) -> None:
    """Chunk every paper of the project that has none yet (its text, else its abstract)."""
    has_chunks = exists().where(PaperChunk.paper_id == Paper.id)
    papers = (
        await db.scalars(
            select(Paper)
            .options(undefer(Paper.full_text))
            .where(Paper.project_id == project_id, ~has_chunks)
        )
    ).all()
    rows = [
        {"paper_id": p.id, "project_id": project_id, "ord": i, "text": chunk}
        for p in papers
        # A paper with neither text nor abstract yields nothing to chunk. Store a
        # single empty row for it anyway, so it stops looking unchunked and being
        # re-read on every later search; it simply never matches a query.
        for i, chunk in enumerate(chunk_text(p.full_text or p.abstract or "") or [""])
    ]
    if rows:
        # Its own session: this is a write on behalf of a GET, and committing the
        # caller's would publish whatever else that request has pending.
        # Two concurrent first searches may both chunk; the unique (paper, ord) keeps one copy.
        async with AsyncSessionLocal() as writer:
            await writer.execute(insert(PaperChunk).values(rows).on_conflict_do_nothing())
            await writer.commit()


async def search_passages(
    db: AsyncSession, project_id: int, question: str, limit: int = 8, per_paper: int = 3
) -> list[dict]:
    """
    The passages that best match the question, at most `per_paper` from any
    one paper so a single long paper can't crowd out the rest.
    """
    await ensure_chunks(db, project_id)
    # Match ANY of the question's words (plainto_tsquery ANDs them), ranked by
    # how many match and how close together they are.
    query = cast(
        func.replace(cast(func.plainto_tsquery("english", question), Text), "&", "|"), TSQUERY
    )
    rank = func.ts_rank_cd(PaperChunk.tsv, query).label("rank")
    ranked = (
        select(
            PaperChunk.paper_id,
            PaperChunk.text,
            rank,
            func.row_number()
            .over(partition_by=PaperChunk.paper_id, order_by=rank.desc())
            .label("nth"),
        )
        .where(PaperChunk.project_id == project_id, PaperChunk.tsv.op("@@")(query))
        .subquery()
    )
    rows = await db.execute(
        select(ranked.c.paper_id, ranked.c.text)
        .where(ranked.c.nth <= per_paper)
        .order_by(ranked.c.rank.desc(), ranked.c.paper_id)
        .limit(limit)
    )
    return [{"paper_id": r.paper_id, "text": r.text} for r in rows]
