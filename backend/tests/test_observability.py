"""Request ids, health checks, log context and Sentry scrubbing."""

import json

from loguru import logger

import main
from app.core.logging import scrub_event
from app.services import collection_service


async def test_every_response_has_a_request_id(client):
    generated = await client.get("/projects")
    assert len(generated.headers["x-request-id"]) == 16

    kept = await client.get("/projects", headers={"X-Request-ID": "proxy-abc.123"})
    assert kept.headers["x-request-id"] == "proxy-abc.123"

    # Anything odd (log injection, huge values) is replaced, not echoed.
    replaced = await client.get("/projects", headers={"X-Request-ID": "bad id\nINFO forged"})
    assert replaced.headers["x-request-id"] != "bad id\nINFO forged"


async def test_health_checks_the_database(client, monkeypatch):
    ok = await client.get("http://test/health")
    assert ok.status_code == 200 and ok.json()["database"] == "up"

    class DeadEngine:
        def connect(self):
            raise OSError("connection refused")

    monkeypatch.setattr(main, "engine", DeadEngine())
    down = await client.get("http://test/health")
    assert down.status_code == 503
    assert down.json() == {"status": "unhealthy", "database": "down"}


async def test_collection_logs_carry_the_project_id(client, make_user, make_project, monkeypatch):
    async def search(topic, max_papers):
        return []  # fails fast with "No papers"

    monkeypatch.setattr(collection_service, "default_search", search)
    records = []
    sink = logger.add(lambda m: records.append(json.loads(m)), serialize=True, level="INFO")
    try:
        user = await make_user()
        pid = await make_project(user)
        await client.post(f"/projects/{pid}/collect", json={}, headers=user["headers"])
    finally:
        logger.remove(sink)

    extras = [r["record"]["extra"] for r in records]
    assert any(e.get("project_id") == pid for e in extras)
    assert all("request_id" in e for e in extras)


def test_sentry_events_are_scrubbed():
    event = {
        "request": {
            "headers": {"Authorization": "Bearer x", "Cookie": "rg_access=y", "Accept": "json"},
            "cookies": {"rg_access": "y"},
            "data": {"password": "hunter2"},
            "query_string": "token=z",
        },
        "user": {"email": "a@b.c"},
    }
    scrubbed = scrub_event(event)
    request = scrubbed["request"]
    assert request["headers"] == {
        "Authorization": "[scrubbed]",
        "Cookie": "[scrubbed]",
        "Accept": "json",
    }
    assert "cookies" not in request and "data" not in request and "query_string" not in request
    assert "user" not in scrubbed
