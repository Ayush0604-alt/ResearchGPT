"""
Per-IP rate limits (slowapi) for endpoints attackers hammer: sign-up and login.

Counts live in RATE_LIMIT_STORAGE_URI (memory:// = per instance). Per-user
quotas that must hold across instances (projects per day, one collection at a
time) are checked against the database instead; see routes/projects.py.

Behind a reverse proxy the client IP comes from X-Forwarded-For, which uvicorn
only trusts with --proxy-headers and a FORWARDED_ALLOW_IPS that names the proxy.
"""

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import settings

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.RATE_LIMIT_STORAGE_URI,
    enabled=settings.RATE_LIMIT_ENABLED,
)


async def rate_limit_exceeded(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    # `detail`, like every other API error, so the frontend can show it.
    return JSONResponse(
        {"detail": "Too many attempts. Please wait a bit and try again."},
        status_code=429,
        headers={"Retry-After": "60"},
    )
