"""Abuse limits: per-IP auth limits and per-user quotas."""

from datetime import datetime, timezone

import pytest

from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import AsyncSessionLocal
from app.models.models import ResearchProject


@pytest.fixture
def rate_limits():
    limiter.reset()
    limiter.enabled = True
    yield
    limiter.enabled = False
    limiter.reset()


async def test_login_is_limited_per_ip(client, make_user, rate_limits):
    user = await make_user()
    limiter.reset()  # make_user logged in once; start counting from zero
    bad = {"email": user["email"], "password": "wrong-password"}
    statuses = [(await client.post("/auth/login", json=bad)).status_code for _ in range(11)]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429
    blocked = await client.post("/auth/login", json=bad)
    assert blocked.json()["detail"].startswith("Too many attempts")
    assert blocked.headers["retry-after"] == "60"


async def test_registration_is_limited_per_ip(client, rate_limits):
    def body(i):
        return {"email": f"r{i}@example.com", "username": f"r{i}_user", "password": "x" * 12}

    statuses = [(await client.post("/auth/register", json=body(i))).status_code for i in range(6)]
    assert statuses == [201] * 5 + [429]


async def test_projects_per_day_quota(client, make_user, make_project, monkeypatch):
    monkeypatch.setattr(settings, "MAX_PROJECTS_PER_DAY", 2)
    user = await make_user()
    await make_project(user)
    await make_project(user)

    third = await client.post("/projects", json={"topic": "third"}, headers=user["headers"])

    assert third.status_code == 429
    assert "2 projects" in third.json()["detail"]


async def test_one_collection_at_a_time_per_user(client, make_user, make_project):
    user = await make_user()
    busy = await make_project(user, topic="busy topic")
    idle = await make_project(user)
    async with AsyncSessionLocal() as db:
        project = await db.get(ResearchProject, busy)
        project.status = "collecting"
        project.heartbeat_at = datetime.now(timezone.utc)
        await db.commit()

    resp = await client.post(f"/projects/{idle}/collect", json={}, headers=user["headers"])

    assert resp.status_code == 429
    assert "busy topic" in resp.json()["detail"]
