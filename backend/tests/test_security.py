from datetime import timedelta

import jwt

from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password

# Written by the old passlib[bcrypt] setup (12 rounds) for 'legacy-password-123'.
LEGACY_PASSLIB_HASH = "$2b$12$auGSYDygZnqkuSBu2ZdlyuAaz7GpVIW621BXtwX3khqJOCSJ49VyC"


def test_existing_passlib_hashes_still_verify():
    assert verify_password("legacy-password-123", LEGACY_PASSLIB_HASH)
    assert not verify_password("wrong", LEGACY_PASSLIB_HASH)


def test_hash_roundtrip():
    hashed = hash_password("correct-horse-battery")
    assert hashed.startswith("$2b$")
    assert verify_password("correct-horse-battery", hashed)


def test_overlong_password_is_rejected_not_crashing():
    assert verify_password("x" * 100, hash_password("short-password")) is False


async def test_legacy_user_can_log_in(client):
    from app.db.session import AsyncSessionLocal
    from app.models.models import User

    async with AsyncSessionLocal() as db:
        db.add(User(email="old@example.com", username="old", hashed_password=LEGACY_PASSLIB_HASH))
        await db.commit()

    resp = await client.post(
        "/auth/login", json={"email": "old@example.com", "password": "legacy-password-123"}
    )
    assert resp.status_code == 200


async def test_login_with_overlong_password_is_401_not_500(client, make_user):
    user = await make_user()
    resp = await client.post("/auth/login", json={"email": user["email"], "password": "é" * 60})
    assert resp.status_code == 401


def _token(payload, secret=None, expires=timedelta(minutes=5)):
    if secret is None:
        return create_access_token(payload, expires)
    return jwt.encode(payload, secret, algorithm="HS256")


async def test_rejects_expired_forged_and_malformed_tokens(client, make_user):
    user = await make_user()
    sub = str(user["id"])
    cases = [
        _token({"sub": sub}, expires=timedelta(seconds=-1)),  # expired
        _token({"sub": sub}, secret="x" * 64),  # wrong key
        _token({"sub": "not-a-number"}),  # would have crashed int()
        _token({"nope": 1}),  # no subject
        jwt.encode({"sub": sub}, key=None, algorithm="none"),  # alg=none
    ]
    for token in cases:
        resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401, token


def test_tokens_use_configured_algorithm():
    token = create_access_token({"sub": "1"})
    assert jwt.get_unverified_header(token)["alg"] == settings.ALGORITHM
