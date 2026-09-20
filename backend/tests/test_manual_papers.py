"""Papers added by hand: by DOI or arXiv id, by PDF upload, and removal."""

import pytest
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.models import Paper, ResearchProject
from app.services import manual_papers
from app.services.manual_papers import PaperError, parse_identifier

from .pdf_fixture import make_pdf

RECORD = {
    "title": "Graph Transformers for Molecules",
    "authors": ["Ada Lovelace"],
    "abstract": "A study of attention on molecular graphs.",
    "year": 2024,
    "url": "https://example.org/paper",
    "pdf_url": "https://example.org/paper.pdf",
    "doi": "10.1000/graphs",
    "source": "openalex",
    "external_id": "W123",
}


@pytest.fixture
def stub_lookup(monkeypatch):
    """Never call OpenAlex/arXiv in tests; record what was looked up."""
    calls = []

    async def lookup(kind, value, record=RECORD):
        calls.append((kind, value))
        return dict(record) if record else None

    monkeypatch.setattr(manual_papers, "default_lookup", lookup)

    async def no_text(client, url):
        return None

    monkeypatch.setattr(manual_papers.collection_service, "default_fetch_text", no_text)
    return calls


def test_parse_identifier():
    assert parse_identifier(" 10.1000/ABC ") == ("doi", "10.1000/abc")
    assert parse_identifier("https://doi.org/10.1000/abc") == ("doi", "10.1000/abc")
    assert parse_identifier("arXiv:2106.01234v2") == ("arxiv", "2106.01234")
    assert parse_identifier("https://arxiv.org/abs/2106.01234") == ("arxiv", "2106.01234")
    with pytest.raises(PaperError):
        parse_identifier("graph neural networks")


async def test_add_by_doi_saves_the_paper_and_asks_for_a_new_review(
    client, make_user, make_project, stub_lookup
):
    user = await make_user()
    pid = await make_project(user)
    async with AsyncSessionLocal() as db:
        project = await db.get(ResearchProject, pid)
        project.status = "completed"
        await db.commit()

    resp = await client.post(
        f"/projects/{pid}/papers", json={"identifier": "10.1000/graphs"}, headers=user["headers"]
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["title"] == RECORD["title"]
    assert stub_lookup == [("doi", "10.1000/graphs")]

    project = (await client.get(f"/projects/{pid}", headers=user["headers"])).json()
    assert project["status"] == "collected"  # the saved review no longer covers the papers

    # The same paper twice is refused.
    again = await client.post(
        f"/projects/{pid}/papers", json={"identifier": "10.1000/graphs"}, headers=user["headers"]
    )
    assert again.status_code == 422
    assert "already in this project" in again.json()["detail"]


async def test_add_reuses_text_read_before(client, make_user, make_project, stub_lookup):
    user = await make_user()
    other_project = await make_project(user)
    async with AsyncSessionLocal() as db:
        db.add(
            Paper(
                project_id=other_project,
                title="Same paper elsewhere",
                doi="10.1000/graphs",
                full_text="Text extracted earlier.",
            )
        )
        await db.commit()

    pid = await make_project(user)
    await client.post(
        f"/projects/{pid}/papers", json={"identifier": "10.1000/graphs"}, headers=user["headers"]
    )
    texts = (await client.get(f"/papers/{pid}/texts", headers=user["headers"])).json()
    assert texts[0]["full_text"] == "Text extracted earlier."


async def test_unknown_identifier_is_reported(client, make_user, make_project, monkeypatch):
    async def nothing(kind, value):
        return None

    monkeypatch.setattr(manual_papers, "default_lookup", nothing)
    user = await make_user()
    pid = await make_project(user)

    resp = await client.post(
        f"/projects/{pid}/papers", json={"identifier": "10.9999/nope"}, headers=user["headers"]
    )
    assert resp.status_code == 422
    assert "No paper was found" in resp.json()["detail"]

    bad = await client.post(
        f"/projects/{pid}/papers", json={"identifier": "just a topic"}, headers=user["headers"]
    )
    assert bad.status_code == 422


async def test_upload_keeps_the_text_but_not_the_file(client, make_user, make_project):
    user = await make_user()
    pid = await make_project(user)
    # Long enough to pass the "scanned page with no text layer" check.
    pdf = make_pdf(
        ["Uploaded findings about graphs.", "Accuracy was 0.91."] + ["Detail line."] * 20
    )

    resp = await client.post(
        f"/projects/{pid}/papers/upload",
        files={"file": ("My Paper.pdf", pdf, "application/pdf")},
        headers=user["headers"],
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["title"] == "My Paper"
    assert resp.json()["has_full_text"] is True

    texts = (await client.get(f"/papers/{pid}/texts", headers=user["headers"])).json()
    assert "Uploaded findings" in texts[0]["full_text"]
    assert texts[0]["has_pdf"] is False  # nothing to re-download: the file isn't stored

    not_a_pdf = await client.post(
        f"/projects/{pid}/papers/upload",
        files={"file": ("notes.pdf", b"plain text", "application/pdf")},
        headers=user["headers"],
    )
    assert not_a_pdf.status_code == 422
    assert "readable PDF" in not_a_pdf.json()["detail"]


async def test_remove_paper(client, make_user, make_project, stub_lookup):
    user = await make_user()
    pid = await make_project(user)
    added = (
        await client.post(
            f"/projects/{pid}/papers",
            json={"identifier": "10.1000/graphs"},
            headers=user["headers"],
        )
    ).json()

    other = await make_user()
    assert (
        await client.delete(f"/projects/{pid}/papers/{added['id']}", headers=other["headers"])
    ).status_code == 404

    resp = await client.delete(f"/projects/{pid}/papers/{added['id']}", headers=user["headers"])
    assert resp.status_code == 204
    assert (await client.get(f"/papers/{pid}", headers=user["headers"])).json() == []
    assert (
        await client.delete(f"/projects/{pid}/papers/{added['id']}", headers=user["headers"])
    ).status_code == 404


async def test_project_paper_limit(client, make_user, make_project, stub_lookup):
    user = await make_user()
    pid = await make_project(user)
    async with AsyncSessionLocal() as db:
        for i in range(manual_papers.MAX_PAPERS_PER_PROJECT):
            db.add(Paper(project_id=pid, title=f"Paper {i}"))
        await db.commit()

    resp = await client.post(
        f"/projects/{pid}/papers", json={"identifier": "10.1000/graphs"}, headers=user["headers"]
    )
    assert resp.status_code == 422
    assert "at most" in resp.json()["detail"]


async def test_papers_cannot_change_while_collecting(client, make_user, make_project, stub_lookup):
    user = await make_user()
    pid = await make_project(user)
    async with AsyncSessionLocal() as db:
        project = await db.get(ResearchProject, pid)
        db.add(Paper(project_id=pid, title="Being collected"))
        project.status = "collecting"
        from datetime import datetime, timezone

        project.heartbeat_at = datetime.now(timezone.utc)
        await db.commit()
        paper_id = await db.scalar(select(Paper.id).where(Paper.project_id == pid))

    add = await client.post(
        f"/projects/{pid}/papers", json={"identifier": "10.1000/graphs"}, headers=user["headers"]
    )
    remove = await client.delete(f"/projects/{pid}/papers/{paper_id}", headers=user["headers"])
    assert add.status_code == remove.status_code == 409
