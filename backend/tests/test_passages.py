"""Passage retrieval for chat: chunking and full-text search over a project's papers."""

from sqlalchemy import func, select

from app.db.session import AsyncSessionLocal
from app.models.models import Paper, PaperChunk
from app.services.passages import CHUNK_CHARS, chunk_text


def test_chunks_follow_paragraphs_and_stay_under_the_size():
    text = "\n\n".join(f"Paragraph {i}. " + "word " * 100 for i in range(20))
    chunks = chunk_text(text)
    assert all(len(c) <= CHUNK_CHARS for c in chunks)
    assert chunks[0].startswith("Paragraph 0.")
    assert "".join(chunks).replace(" ", "") == text.replace("\n", "").replace(" ", "")


def test_a_huge_unbroken_block_is_cut_hard():
    chunks = chunk_text("x" * (CHUNK_CHARS * 3 + 10))
    assert [len(c) for c in chunks] == [CHUNK_CHARS, CHUNK_CHARS, CHUNK_CHARS, 10]


def test_blank_text_has_no_chunks():
    assert chunk_text("  \n\n  ") == []


async def _project_with_papers(make_user, make_project, papers):
    user = await make_user()
    pid = await make_project(user)
    async with AsyncSessionLocal() as db:
        for title, full_text, abstract in papers:
            db.add(Paper(project_id=pid, title=title, full_text=full_text, abstract=abstract))
        await db.commit()
        ids = {
            p.title: p.id
            for p in (await db.scalars(select(Paper).where(Paper.project_id == pid))).all()
        }
    return user, pid, ids


async def test_search_ranks_matching_passages_across_papers(client, make_user, make_project):
    methods = "\n\n".join(
        [
            "We train a graph transformer on molecular property prediction.",
            "The dataset is ogbg-molhiv with a scaffold split.",
            "Results: ROC-AUC 0.79 with Laplacian positional encodings.",
        ]
    )
    user, pid, ids = await _project_with_papers(
        make_user,
        make_project,
        [
            ("Transformers", methods, "Abstract A"),
            ("No text", None, "Message passing networks predict molecular properties."),
            ("Unrelated", "Crop yields in sub-Saharan Africa.", None),
        ],
    )
    h = user["headers"]
    resp = await client.get(
        f"/papers/{pid}/passages", params={"q": "Which molecular datasets are used?"}, headers=h
    )
    assert resp.status_code == 200, resp.text
    found = resp.json()
    paper_ids = [p["paper_id"] for p in found]
    assert ids["Unrelated"] not in paper_ids
    assert ids["No text"] in paper_ids  # abstracts are searchable too
    assert any("ogbg-molhiv" in p["text"] for p in found)

    # Chunks were built once and are reused.
    async with AsyncSessionLocal() as db:
        n = await db.scalar(select(func.count()).where(PaperChunk.project_id == pid))
    await client.get(f"/papers/{pid}/passages", params={"q": "datasets"}, headers=h)
    async with AsyncSessionLocal() as db:
        assert await db.scalar(select(func.count()).where(PaperChunk.project_id == pid)) == n


async def test_one_long_paper_cannot_crowd_out_the_rest(client, make_user, make_project):
    long_paper = "\n\n".join(f"Attention section {i}. " + "attention " * 200 for i in range(10))
    user, pid, ids = await _project_with_papers(
        make_user,
        make_project,
        [("Long", long_paper, None), ("Short", "Attention is used once here.", None)],
    )
    found = (
        await client.get(
            f"/papers/{pid}/passages", params={"q": "attention"}, headers=user["headers"]
        )
    ).json()
    assert [p["paper_id"] for p in found].count(ids["Long"]) == 3
    assert ids["Short"] in [p["paper_id"] for p in found]


async def test_passages_are_private_and_validated(client, make_user, make_project):
    owner, pid, _ = await _project_with_papers(
        make_user, make_project, [("Paper", "Secret findings.", None)]
    )
    other = await make_user()
    resp = await client.get(
        f"/papers/{pid}/passages", params={"q": "findings"}, headers=other["headers"]
    )
    assert resp.status_code == 404
    resp = await client.get(f"/papers/{pid}/passages", params={"q": ""}, headers=owner["headers"])
    assert resp.status_code == 422
    resp = await client.get(
        f"/papers/{pid}/passages", params={"q": "the of and"}, headers=owner["headers"]
    )
    assert resp.json() == []  # only stop words: nothing to match


async def test_chunks_go_with_their_paper(client, make_user, make_project):
    user, pid, ids = await _project_with_papers(
        make_user, make_project, [("Paper", "Graph findings.", None)]
    )
    await client.get(f"/papers/{pid}/passages", params={"q": "graph"}, headers=user["headers"])
    async with AsyncSessionLocal() as db:
        await db.delete(await db.get(Paper, ids["Paper"]))
        await db.commit()
        assert await db.scalar(select(func.count()).where(PaperChunk.project_id == pid)) == 0
