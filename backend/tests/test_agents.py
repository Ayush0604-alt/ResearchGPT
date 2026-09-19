import pytest

from app.api.routes import agents as agents_route
from app.core.task_store import _task_store


@pytest.fixture
def fake_workflow(monkeypatch):
    """Replace the real pipeline (network + Gemini) with a canned result."""
    calls = []

    async def _fake(topic, project_id, max_papers, task_id):
        calls.append(project_id)
        return {
            "papers": [{"title": "A paper", "abstract": "An abstract long enough.", "authors": []}],
            "literature_review": {"introduction": "intro"},
            "trends": "t",
            "gaps": "g",
        }

    monkeypatch.setattr(agents_route, "run_research_workflow", _fake)
    yield calls
    _task_store.clear()


async def test_status_requires_auth(client):
    _task_store["t1"] = {"user_id": 1, "status": "running", "progress": 5}
    try:
        assert (await client.get("/agents/status/t1")).status_code == 401
    finally:
        _task_store.clear()


async def test_status_hidden_from_other_users(client, make_user, make_project, fake_workflow):
    alice = await make_user()
    bob = await make_user()
    pid = await make_project(alice)

    run = await client.post("/agents/run", json={"project_id": pid}, headers=alice["headers"])
    assert run.status_code == 200
    task_id = run.json()["task_id"]

    other = await client.get(f"/agents/status/{task_id}", headers=bob["headers"])
    assert other.status_code == 404

    mine = await client.get(f"/agents/status/{task_id}", headers=alice["headers"])
    assert mine.status_code == 200
    assert mine.json()["status"] == "completed"  # background task ran after the response
    assert fake_workflow == [pid]

    review = await client.get(f"/reviews/{pid}", headers=alice["headers"])
    assert review.json()["introduction"] == "intro"
