"""
Cookie sessions: a short-lived access token plus a rotating refresh token.

- access token: JWT, ACCESS_TOKEN_EXPIRE_MINUTES, cookie `rg_access` (path /api)
- refresh token: 32 random bytes, REFRESH_TOKEN_EXPIRE_DAYS, cookie `rg_refresh`
  (path /api/auth, so it's only sent to the auth endpoints). Only its SHA-256
  hash is stored. Each use revokes it and issues a new one; presenting an
  already-revoked token revokes every session of that user (likely theft).

Both cookies are httpOnly (JavaScript can't read them), SameSite=Lax, and
Secure when COOKIE_SECURE is set (required outside development).
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import ACCESS_COOKIE, create_access_token
from app.models.models import RefreshToken, User

REFRESH_COOKIE = "rg_refresh"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _cookie_prefix() -> str:
    return settings.API_V1_PREFIX.rstrip("/") or "/"


async def _issue_refresh(db: AsyncSession, user_id: int) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(
        RefreshToken(
            user_id=user_id,
            token_hash=_hash(raw),
            expires_at=_now() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    await db.flush()
    return raw


def _set_cookies(response: Response, user_id: int, refresh: str) -> None:
    common = {"httponly": True, "secure": settings.COOKIE_SECURE, "samesite": "lax"}
    response.set_cookie(
        ACCESS_COOKIE,
        create_access_token({"sub": str(user_id)}),
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path=_cookie_prefix(),
        **common,
    )
    response.set_cookie(
        REFRESH_COOKIE,
        refresh,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path=f"{_cookie_prefix()}/auth",
        **common,
    )


def clear_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path=_cookie_prefix())
    response.delete_cookie(REFRESH_COOKIE, path=f"{_cookie_prefix()}/auth")


async def start(db: AsyncSession, response: Response, user_id: int) -> None:
    """Log in: new refresh token and both cookies."""
    _set_cookies(response, user_id, await _issue_refresh(db, user_id))


async def rotate(db: AsyncSession, response: Response, raw: Optional[str]) -> User:
    """Exchange a refresh token for new cookies. Returns the user."""
    if not raw:
        raise HTTPException(401, "Not signed in")
    token = await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == _hash(raw)))
    if token is None:
        raise HTTPException(401, "Session expired. Please sign in again.")
    if token.revoked_at is not None:
        # A rotated token came back: someone else has a copy. End every session.
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == token.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=_now())
        )
        # Commit now: get_db rolls back when the 401 below propagates.
        await db.commit()
        raise HTTPException(401, "Session expired. Please sign in again.")
    if token.expires_at <= _now():
        raise HTTPException(401, "Session expired. Please sign in again.")

    user = await db.get(User, token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "Account not found or inactive")

    token.revoked_at = _now()
    _set_cookies(response, user.id, await _issue_refresh(db, user.id))
    return user


async def end(db: AsyncSession, response: Response, raw: Optional[str]) -> None:
    """Log out: revoke this refresh token and clear the cookies."""
    if raw:
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.token_hash == _hash(raw), RefreshToken.revoked_at.is_(None))
            .values(revoked_at=_now())
        )
    clear_cookies(response)
