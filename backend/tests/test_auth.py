async def test_register_returns_user_without_password(client):
    resp = await client.post(
        "/auth/register",
        json={"email": "a@example.com", "username": "alice", "password": "correct-horse-battery"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == "a@example.com"
    assert body["username"] == "alice"
    assert "password" not in body and "hashed_password" not in body


async def test_register_rejects_duplicate_email_and_username(client, make_user):
    user = await make_user()

    dup_email = await client.post(
        "/auth/register",
        json={"email": user["email"], "username": "other", "password": "correct-horse-battery"},
    )
    assert dup_email.status_code == 400

    dup_name = await client.post(
        "/auth/register",
        json={
            "email": "new@example.com",
            "username": user["username"],
            "password": "correct-horse-battery",
        },
    )
    assert dup_name.status_code == 400


async def test_login_rejects_wrong_password(client, make_user):
    user = await make_user()
    resp = await client.post("/auth/login", json={"email": user["email"], "password": "wrong"})
    assert resp.status_code == 401


async def test_me_requires_valid_token(client, make_user):
    user = await make_user()

    ok = await client.get("/auth/me", headers=user["headers"])
    assert ok.status_code == 200
    assert ok.json()["id"] == user["id"]

    assert (await client.get("/auth/me")).status_code == 401
    bad = await client.get("/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert bad.status_code == 401


async def test_delete_account_removes_everything(client, make_user, make_project):
    from sqlalchemy import func, select

    from app.db.session import AsyncSessionLocal
    from app.models.models import ChatMessage, Paper, ResearchProject, User

    user = await make_user()
    other = await make_user()
    pid = await make_project(user)
    await make_project(other)
    async with AsyncSessionLocal() as db:
        db.add(Paper(project_id=pid, title="p"))
        db.add(ChatMessage(project_id=pid, role="user", content="q"))
        await db.commit()

    wrong = await client.request(
        "DELETE", "/auth/me", json={"password": "nope"}, headers=user["headers"]
    )
    assert wrong.status_code == 403

    resp = await client.request(
        "DELETE", "/auth/me", json={"password": user["password"]}, headers=user["headers"]
    )
    assert resp.status_code == 204

    async with AsyncSessionLocal() as db:
        count = lambda model: db.scalar(select(func.count()).select_from(model))  # noqa: E731
        assert await count(User) == 1  # only the other user
        assert await count(ResearchProject) == 1
        assert await count(Paper) == 0
        assert await count(ChatMessage) == 0
    assert (await client.get("/auth/me", headers=user["headers"])).status_code == 401
