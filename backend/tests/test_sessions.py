"""Cookie sessions: httpOnly cookies, rotating refresh tokens, CSRF header."""

from datetime import timedelta

from sqlalchemy import select

from app.core.security import create_access_token
from app.db.session import AsyncSessionLocal
from app.models.models import RefreshToken
from app.services.session_service import _hash as _sha


async def _refresh_with(client, token):
    client.cookies.clear()
    client.cookies.set("rg_refresh", token)
    return await client.post("/auth/refresh")


async def _login(client, user):
    return await client.post(
        "/auth/login", json={"email": user["email"], "password": user["password"]}
    )


async def test_login_sets_httponly_cookies_and_returns_no_token(client, make_user):
    user = await make_user()
    resp = await _login(client, user)

    assert resp.status_code == 200
    assert "access_token" not in resp.json()
    assert resp.json()["username"] == user["username"]
    set_cookie = resp.headers.get_list("set-cookie")
    access = next(c for c in set_cookie if c.startswith("rg_access="))
    refresh = next(c for c in set_cookie if c.startswith("rg_refresh="))
    for cookie in (access, refresh):
        assert "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert "Path=/api/auth" in refresh  # only sent to the auth endpoints


async def test_cookie_authenticates_requests(client, make_user):
    user = await make_user()
    await _login(client, user)  # the client keeps the cookies
    me = await client.get("/auth/me")
    assert me.status_code == 200 and me.json()["id"] == user["id"]


async def test_refresh_rotates_the_token(client, make_user):
    user = await make_user()
    first = (await _login(client, user)).cookies["rg_refresh"]

    resp = await client.post("/auth/refresh")

    assert resp.status_code == 200
    second = resp.cookies["rg_refresh"]
    assert second != first
    async with AsyncSessionLocal() as db:
        by_hash = {t.token_hash: t for t in (await db.scalars(select(RefreshToken))).all()}
    old, new = by_hash[_sha(first)], by_hash[_sha(second)]
    assert old.revoked_at is not None
    assert new.revoked_at is None


async def test_reusing_a_rotated_token_ends_every_session(client, make_user):
    user = await make_user()
    stolen = (await _login(client, user)).cookies["rg_refresh"]
    await client.post("/auth/refresh")  # legitimate rotation
    current = client.cookies.get("rg_refresh", path="/api/auth")

    client.cookies.clear()
    replay = await _refresh_with(client, stolen)
    assert replay.status_code == 401

    # The legitimate session is now dead too.
    client.cookies.clear()
    again = await _refresh_with(client, current)
    assert again.status_code == 401


async def test_logout_revokes_the_refresh_token(client, make_user):
    user = await make_user()
    token = (await _login(client, user)).cookies["rg_refresh"]

    out = await client.post("/auth/logout")
    assert out.status_code == 204
    assert any(
        c.startswith('rg_access=""') or "Max-Age=0" in c for c in out.headers.get_list("set-cookie")
    )

    client.cookies.clear()
    assert (await _refresh_with(client, token)).status_code == 401


async def test_expired_access_token_is_rejected(client, make_user):
    user = await make_user()
    expired = create_access_token({"sub": str(user["id"])}, timedelta(seconds=-1))
    client.cookies.set("rg_access", expired)
    assert (await client.get("/auth/me")).status_code == 401


async def test_state_changing_requests_need_the_csrf_header(client, make_user):
    user = await make_user()
    no_header = {k: v for k, v in user["headers"].items()} | {"X-Requested-With": ""}
    blocked = await client.post("/projects", json={"topic": "csrf test"}, headers=no_header)
    assert blocked.status_code == 403
    # Reads don't need it.
    assert (await client.get("/projects", headers=no_header)).status_code == 200
