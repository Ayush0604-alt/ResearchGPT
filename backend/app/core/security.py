"""
Password hashing (bcrypt via pwdlib) and JWT helpers (PyJWT).
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pwdlib import PasswordHash
from pwdlib.hashers.bcrypt import BcryptHasher
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.models.models import User

# Verifies the $2b$ hashes written by the previous passlib setup.
password_hash = PasswordHash((BcryptHasher(rounds=settings.BCRYPT_ROUNDS),))
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


_BCRYPT_MAX_BYTES = 72


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    # bcrypt>=5 raises on inputs over 72 bytes; such a password can't match.
    if len(plain.encode("utf-8")) > _BCRYPT_MAX_BYTES:
        return False
    return password_hash.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None


async def get_current_user_id(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> int:
    payload = decode_token(token)
    sub: Optional[str] = payload.get("sub")
    if sub is None or not str(sub).isdigit():
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user_id = int(sub)

    # Tokens outlive account changes: re-check that the user still exists and is active.
    is_active = await db.scalar(select(User.is_active).where(User.id == user_id))
    if not is_active:
        raise HTTPException(
            status_code=401,
            detail="Account not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id
