"""
Auth Routes: /api/auth

Sessions live in httpOnly cookies (see app/services/session_service.py);
no token is ever returned to JavaScript.
"""

from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import limiter
from app.core.security import get_current_user_id, hash_password, verify_password
from app.db.session import get_db
from app.models.models import User
from app.schemas.schemas import AccountDeletion, UserLogin, UserOut, UserRegister
from app.services import session_service
from app.services.session_service import REFRESH_COOKIE

router = APIRouter()


@router.post("/register", response_model=UserOut, status_code=201)
@limiter.limit("5/hour")
async def register(request: Request, body: UserRegister, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    existing_uname = await db.execute(select(User).where(User.username == body.username))
    if existing_uname.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(
        email=body.email,
        username=body.username,
        hashed_password=hash_password(body.password),
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.post("/login", response_model=UserOut)
@limiter.limit("10/minute")
async def login(
    request: Request,
    response: Response,
    body: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    user = await db.scalar(select(User).where(User.email == body.email))
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account inactive")

    await session_service.start(db, response, user.id)
    return user


@router.post("/refresh", response_model=UserOut)
async def refresh(
    response: Response,
    rg_refresh: Optional[str] = Cookie(default=None, alias=REFRESH_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    """New access and refresh cookies for a valid refresh cookie."""
    return await session_service.rotate(db, response, rg_refresh)


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    rg_refresh: Optional[str] = Cookie(default=None, alias=REFRESH_COOKIE),
    db: AsyncSession = Depends(get_db),
):
    await session_service.end(db, response, rg_refresh)


@router.get("/me", response_model=UserOut)
async def me(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.delete("/me", status_code=204)
async def delete_account(
    body: AccountDeletion,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    """Delete the account and everything in it (projects, papers, reviews,
    chats, sessions cascade in the database). Requires the current password."""
    user = await db.get(User, user_id)
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=403, detail="Password is incorrect")
    await db.delete(user)
    session_service.clear_cookies(response)
