"""
Password hashing (bcrypt via pwdlib), access tokens (PyJWT) and request auth.

Browsers authenticate with an httpOnly cookie holding a short-lived access
token (see app/services/session_service.py). API clients may send the same
token as `Authorization: Bearer …`; the header wins when both are present.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from pwdlib import PasswordHash
from pwdlib.hashers.bcrypt import BcryptHasher
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.models.models import User

ACCESS_COOKIE = "rg_access"

# Verifies the $2b$ hashes written by the previous passlib setup.
password_hash = PasswordHash((BcryptHasher(rounds=settings.BCRYPT_ROUNDS),))

_BCRYPT_MAX_BYTES = 72


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    # bcrypt>=5 raises on inputs over 72 bytes; such a password can't match.
    if len(plain.encode("utf-8")) > _BCRYPT_MAX_BYTES:
        return False
    return password_hash.verify(plain, hashed)


# A real hash to verify against when no user matched, so that logging in with an
# unknown address costs the same as logging in with a known one. Without it the
# bcrypt call is skipped and the ~200ms difference says whether an account exists.
_DUMMY_HASH = password_hash.hash("password-that-is-never-a-real-one")


def verify_password_dummy(plain: str) -> None:
    """Spend the same time as a real check, and always fail."""
    verify_password(plain, _DUMMY_HASH)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        raise _unauthorized("Invalid or expired token") from None


def _token_from(request: Request) -> Optional[str]:
    scheme, _, credentials = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() == "bearer" and credentials:
        return credentials
    return request.cookies.get(ACCESS_COOKIE)


async def get_current_user_id(request: Request, db: AsyncSession = Depends(get_db)) -> int:
    token = _token_from(request)
    if not token:
        raise _unauthorized("Not authenticated")
    payload = decode_token(token)
    sub: Optional[str] = payload.get("sub")
    if sub is None or not str(sub).isdigit():
        raise _unauthorized("Invalid token payload")
    user_id = int(sub)

    # Tokens outlive account changes: re-check that the user still exists and is active.
    is_active = await db.scalar(select(User.is_active).where(User.id == user_id))
    if not is_active:
        raise _unauthorized("Account not found or inactive")
    return user_id
