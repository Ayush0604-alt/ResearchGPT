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
