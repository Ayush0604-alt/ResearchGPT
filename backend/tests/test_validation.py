import pytest
from sqlalchemy import update

from app.db.session import AsyncSessionLocal
from app.models.models import User


@pytest.mark.parametrize(
    "overrides",
    [
        {"password": "short"},
        {"password": "é" * 40},  # 80 bytes: over bcrypt's 72-byte limit
        {"username": "ab"},
        {"username": "has space"},
        {"username": "x" * 51},
        {"email": "not-an-email"},
    ],
)
async def test_register_rejects_invalid_input(client, overrides):
    body = {"email": "v@example.com", "username": "valid_name", "password": "long-enough-pw"}
    resp = await client.post("/auth/register", json=body | overrides)
    assert resp.status_code == 422


@pytest.mark.parametrize("topic", ["", "  ", "ab", "x" * 301])
async def test_project_topic_bounds(client, make_user, topic):
    user = await make_user()
    resp = await client.post("/projects", json={"topic": topic}, headers=user["headers"])
    assert resp.status_code == 422


async def test_project_topic_is_trimmed(client, make_user):
    user = await make_user()
    resp = await client.post(
        "/projects", json={"topic": "  transformers  "}, headers=user["headers"]
    )
    assert resp.json()["topic"] == "transformers"


@pytest.mark.parametrize("max_papers", [0, 26, -1])
async def test_max_papers_bounds(client, make_user, make_project, max_papers):
    user = await make_user()
    pid = await make_project(user)
    resp = await client.post(
        "/agents/run", json={"project_id": pid, "max_papers": max_papers}, headers=user["headers"]
    )
    assert resp.status_code == 422


@pytest.mark.parametrize("question", ["", "x" * 4001])
async def test_chat_question_bounds(client, make_user, make_project, question):
    user = await make_user()
    pid = await make_project(user)
    resp = await client.post(
        "/chat/query", json={"project_id": pid, "question": question}, headers=user["headers"]
    )
    assert resp.status_code == 422


async def test_deactivated_user_token_is_rejected(client, make_user):
    user = await make_user()
    async with AsyncSessionLocal() as db:
        await db.execute(update(User).where(User.id == user["id"]).values(is_active=False))
        await db.commit()

    assert (await client.get("/projects", headers=user["headers"])).status_code == 401
