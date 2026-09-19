"""The server-side collection job: search -> read PDFs -> store text."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.models import LiteratureReview, Paper, ResearchProject
from app.services import collection_service

PAPERS = [
    {
        "title": "Graph transformers",
        "authors": ["A. Author"],
        "abstract": "We study graph transformers in depth.",
        "year": 2024,
        "url": "https://arxiv.org/abs/1",
        "pdf_url": "https://arxiv.org/pdf/1",
        "source": "arxiv",
        "external_id": "1",
    },
    {
        "title": "No PDF paper",
        "authors": [],
        "abstract": "Only an abstract is available here.",
        "year": 2023,
        "url": "https://pubmed.ncbi.nlm.nih.gov/2/",
        "pdf_url": None,
        "source": "pubmed",
        "external_id": "2",
    },
]


@pytest.fixture
def fake_sources(monkeypatch):
    """Stub the network: canned search results and PDF texts."""
    state = {"search": list(PAPERS), "texts": {"https://arxiv.org/pdf/1": "Full text " * 50}}

    async def search(topic, max_papers):
        if isinstance(state["search"], Exception):
            raise state["search"]
        return [dict(p) for p in state["search"]][:max_papers]

    async def fetch_text(client, url):
        return state["texts"].get(url)

    monkeypatch.setattr(collection_service, "default_search", search)
    monkeypatch.setattr(collection_service, "default_fetch_text", fetch_text)
    return state


async def _project(client, user, pid):
    return (await client.get(f"/projects/{pid}", headers=user["headers"])).json()


async def _set_project(pid, **values):
    async with AsyncSessionLocal() as db:
        project = await db.get(ResearchProject, pid)
        for k, v in values.items():
            setattr(project, k, v)
        await db.commit()


async def test_collect_stores_papers_and_text(client, make_user, make_project, fake_sources):
    user = await make_user()
    pid = await make_project(user)

    resp = await client.post(
        f"/projects/{pid}/collect", json={"max_papers": 5}, headers=user["headers"]
    )
    assert resp.status_code == 202
    assert resp.json()["status"] == "collecting"

    # The background job ran after the response (ASGITransport waits for it).
    project = await _project(client, user, pid)
    assert project["status"] == "collected"
    assert project["progress"] == 100
    assert project["error"] is None

    papers = (await client.get(f"/papers/{pid}", headers=user["headers"])).json()
    by_title = {p["title"]: p for p in papers}
    assert by_title["Graph transformers"]["has_full_text"] is True
    assert by_title["No PDF paper"]["has_full_text"] is False
    assert "full_text" not in by_title["Graph transformers"]  # listings stay light

    async with AsyncSessionLocal() as db:
        texts = (await db.scalars(select(Paper.full_text).where(Paper.project_id == pid))).all()
    assert any(t and t.startswith("Full text") for t in texts)


async def test_recollecting_replaces_papers_and_drops_the_stale_review(
    client, make_user, make_project, fake_sources
):
    user = await make_user()
    pid = await make_project(user)
    await client.post(f"/projects/{pid}/collect", json={}, headers=user["headers"])
    async with AsyncSessionLocal() as db:
        db.add(LiteratureReview(project_id=pid, introduction="old"))
        await db.commit()

    await client.post(f"/projects/{pid}/collect", json={}, headers=user["headers"])

    assert len((await client.get(f"/papers/{pid}", headers=user["headers"])).json()) == 2
    assert (await client.get(f"/reviews/{pid}", headers=user["headers"])).status_code == 404


@pytest.mark.parametrize(
    "search_result,message",
    [([], "No papers"), (RuntimeError("S2 down"), "couldn't be reached")],
)
async def test_failed_collection_explains_why(
    client, make_user, make_project, fake_sources, search_result, message
):
    fake_sources["search"] = search_result
    user = await make_user()
    pid = await make_project(user)

    await client.post(f"/projects/{pid}/collect", json={}, headers=user["headers"])

    project = await _project(client, user, pid)
    assert project["status"] == "failed"
    assert message in project["error"]
    assert "S2 down" not in project["error"]


async def test_unexpected_errors_are_not_shown_to_users(
    client, make_user, make_project, fake_sources, monkeypatch
):
    async def broken(db, project_id, papers):
        raise RuntimeError("password=hunter2")

    monkeypatch.setattr(collection_service, "replace_papers", broken)
    user = await make_user()
    pid = await make_project(user)

    await client.post(f"/projects/{pid}/collect", json={}, headers=user["headers"])

    project = await _project(client, user, pid)
    assert project["status"] == "failed"
    assert "hunter2" not in project["error"]


async def test_active_collection_blocks_a_second_one(client, make_user, make_project):
    user = await make_user()
    pid = await make_project(user)
    await _set_project(pid, status="collecting", heartbeat_at=datetime.now(timezone.utc))

    resp = await client.post(f"/projects/{pid}/collect", json={}, headers=user["headers"])

    assert resp.status_code == 409


async def test_dead_collection_is_failed_on_read_and_can_be_restarted(
    client, make_user, make_project, fake_sources
):
    user = await make_user()
    pid = await make_project(user)
    stale = datetime.now(timezone.utc) - timedelta(minutes=10)
    await _set_project(pid, status="collecting", heartbeat_at=stale)

    project = await _project(client, user, pid)
    assert project["status"] == "failed"
    assert "interrupted" in project["error"]

    resp = await client.post(f"/projects/{pid}/collect", json={}, headers=user["headers"])
    assert resp.status_code == 202
    assert (await _project(client, user, pid))["status"] == "collected"


async def test_startup_fails_only_stale_collections(client, make_user, make_project):
    from main import app

    user = await make_user()
    stale_pid = await make_project(user)
    live_pid = await make_project(user)
    now = datetime.now(timezone.utc)
    await _set_project(stale_pid, status="collecting", heartbeat_at=now - timedelta(minutes=10))
    await _set_project(live_pid, status="collecting", heartbeat_at=now)  # another instance

    async with app.router.lifespan_context(app):
        pass

    async with AsyncSessionLocal() as db:
        stale = await db.get(ResearchProject, stale_pid)
        live = await db.get(ResearchProject, live_pid)
    assert stale.status == "failed"
    assert live.status == "collecting"


async def test_listing_projects_expires_dead_collections(client, make_user, make_project):
    user = await make_user()
    pid = await make_project(user)
    stale = datetime.now(timezone.utc) - timedelta(minutes=10)
    await _set_project(pid, status="collecting", heartbeat_at=stale)

    listed = (await client.get("/projects", headers=user["headers"])).json()["projects"]

    assert listed[0]["status"] == "failed"
