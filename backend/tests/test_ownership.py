"""Every project-scoped route must hide other users' projects (404, not 403)."""

import pytest
from sqlalchemy import func, select

from app.db.session import AsyncSessionLocal
from app.models.models import ChatMessage, LiteratureReview

ROUTES = [
    ("GET", "/papers/{pid}"),
    ("GET", "/papers/{pid}/summaries"),
    ("GET", "/papers/{pid}/findings"),
    ("GET", "/reviews/{pid}"),
    ("GET", "/reviews/{pid}/markdown"),
    ("GET", "/chat/history/{pid}"),
    ("DELETE", "/chat/history/{pid}"),
    ("POST", "/chat/query"),
    ("POST", "/agents/run"),
    ("GET", "/projects/{pid}"),
    ("DELETE", "/projects/{pid}"),
]


async def _project_with_message(make_project, owner):
    pid = await make_project(owner)
    async with AsyncSessionLocal() as db:
        db.add(ChatMessage(project_id=pid, role="user", content="hello"))
        db.add(LiteratureReview(project_id=pid, introduction="secret"))
        await db.commit()
    return pid


async def _message_count(pid):
    async with AsyncSessionLocal() as db:
        return await db.scalar(
            select(func.count()).select_from(ChatMessage).where(ChatMessage.project_id == pid)
        )


@pytest.mark.parametrize("method,path", ROUTES)
async def test_other_users_project_is_not_found(client, make_user, make_project, method, path):
    alice = await make_user()
    bob = await make_user()
    pid = await _project_with_message(make_project, alice)

    body = {"project_id": pid, "question": "q", "max_papers": 1}
    resp = await client.request(
        method,
        path.format(pid=pid),
        headers=bob["headers"],
        json=body if method == "POST" else None,
    )

    assert resp.status_code == 404, resp.text
    assert await _message_count(pid) == 1  # nothing of alice's was touched


@pytest.mark.parametrize("method,path", ROUTES)
async def test_missing_project_is_not_found(client, make_user, method, path):
    bob = await make_user()
    body = {"project_id": 999_999, "question": "q", "max_papers": 1}
    resp = await client.request(
        method,
        path.format(pid=999_999),
        headers=bob["headers"],
        json=body if method == "POST" else None,
    )
    assert resp.status_code == 404, resp.text


async def test_owner_can_read_own_project_data(client, make_user, make_project):
    alice = await make_user()
    pid = await _project_with_message(make_project, alice)
    h = alice["headers"]

    assert (await client.get(f"/papers/{pid}", headers=h)).json() == []
    assert (await client.get(f"/reviews/{pid}", headers=h)).json()["introduction"] == "secret"
    assert "secret" in (await client.get(f"/reviews/{pid}/markdown", headers=h)).text
    assert (await client.get(f"/chat/history/{pid}", headers=h)).json()["total"] == 1

    assert (await client.delete(f"/chat/history/{pid}", headers=h)).status_code == 204
    assert await _message_count(pid) == 0
