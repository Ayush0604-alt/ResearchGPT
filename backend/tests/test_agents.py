import pytest

from app.api.routes import agents as agents_route
from app.api.routes.agents import fail_interrupted_runs
from app.core.task_store import _task_store
from app.db.session import AsyncSessionLocal
from app.models.models import ResearchProject
from app.utils.gemini_client import RateLimitError


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
            "comparison": "A vs B",
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
    assert review.json()["comparison"] == "A vs B"

    project = (await client.get(f"/projects/{pid}", headers=alice["headers"])).json()
    assert project["error"] is None
    assert project["started_at"] and project["finished_at"]


async def _set_status(pid, status, task_id=None):
    async with AsyncSessionLocal() as db:
        project = await db.get(ResearchProject, pid)
        project.status = status
        project.task_id = task_id
        await db.commit()


async def test_restart_fails_interrupted_runs(client, make_user, make_project):
    alice = await make_user()
    running = await make_project(alice)
    done = await make_project(alice)
    await _set_status(running, "running", "task_gone")
    await _set_status(done, "completed")

    assert await fail_interrupted_runs() == 1

    h = alice["headers"]
    interrupted = (await client.get(f"/projects/{running}", headers=h)).json()
    assert interrupted["status"] == "failed"
    assert "restart" in interrupted["error"]
    assert (await client.get(f"/projects/{done}", headers=h)).json()["status"] == "completed"


async def test_stale_running_project_can_be_rerun(client, make_user, make_project, fake_workflow):
    alice = await make_user()
    pid = await make_project(alice)
    await _set_status(pid, "running", "task_lost_in_restart")  # not in _task_store

    run = await client.post("/agents/run", json={"project_id": pid}, headers=alice["headers"])

    assert run.json()["task_id"] != "task_lost_in_restart"
    assert fake_workflow == [pid]


async def test_live_run_blocks_second_run(client, make_user, make_project, fake_workflow):
    alice = await make_user()
    pid = await make_project(alice)
    await _set_status(pid, "running", "task_live")
    _task_store["task_live"] = {"user_id": alice["id"], "status": "running", "progress": 40}

    run = await client.post("/agents/run", json={"project_id": pid}, headers=alice["headers"])

    assert run.json()["current_agent"] == "Already running"
    assert run.json()["progress"] == 40
    assert fake_workflow == []


async def test_app_startup_fails_interrupted_runs(client, make_user, make_project):
    from main import app

    alice = await make_user()
    pid = await make_project(alice)
    await _set_status(pid, "running", "task_gone")

    async with app.router.lifespan_context(app):
        pass

    project = await client.get(f"/projects/{pid}", headers=alice["headers"])
    assert project.json()["status"] == "failed"


def _workflow_returning(monkeypatch, result=None, exc=None):
    async def _fake(topic, project_id, max_papers, task_id):
        if exc:
            raise exc
        return result

    monkeypatch.setattr(agents_route, "run_research_workflow", _fake)


async def _run_and_status(client, user, pid):
    run = await client.post("/agents/run", json={"project_id": pid}, headers=user["headers"])
    status = await client.get(f"/agents/status/{run.json()['task_id']}", headers=user["headers"])
    project = await client.get(f"/projects/{pid}", headers=user["headers"])
    _task_store.clear()
    return status.json(), project.json()


async def test_run_with_no_papers_fails_with_reason(client, make_user, make_project, monkeypatch):
    _workflow_returning(monkeypatch, {"papers": [], "literature_review": {}})
    user = await make_user()
    pid = await make_project(user)

    status, project = await _run_and_status(client, user, pid)

    assert status["status"] == "failed"
    assert "No papers" in status["error"]
    assert project["status"] == "failed"
    assert "No papers" in project["error"]  # survives a reload
    assert project["finished_at"] is not None


async def test_run_with_empty_review_fails_and_keeps_old_results(
    client, make_user, make_project, monkeypatch, fake_workflow
):
    user = await make_user()
    pid = await make_project(user)
    await _run_and_status(client, user, pid)  # first run succeeds (fake_workflow)

    _workflow_returning(monkeypatch, {"papers": [{"title": "p"}], "literature_review": {}})
    status, project = await _run_and_status(client, user, pid)

    assert status["status"] == "failed"
    assert "no review" in status["error"]
    review = await client.get(f"/reviews/{pid}", headers=user["headers"])
    assert review.json()["introduction"] == "intro"  # previous results survive


async def test_run_error_message_hides_internals(client, make_user, make_project, monkeypatch):
    _workflow_returning(monkeypatch, exc=RuntimeError("password=hunter2 at db-host:5432"))
    user = await make_user()
    pid = await make_project(user)

    status, _ = await _run_and_status(client, user, pid)

    assert status["status"] == "failed"
    assert "hunter2" not in status["error"] and "db-host" not in status["error"]


async def test_run_rate_limit_message(client, make_user, make_project, monkeypatch):
    _workflow_returning(monkeypatch, exc=RateLimitError("429 ResourceExhausted"))
    user = await make_user()
    pid = await make_project(user)

    status, _ = await _run_and_status(client, user, pid)

    assert "rate limit" in status["error"]
