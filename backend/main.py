"""
ResearchGPT — FastAPI Application Entry Point.
The schema is managed by Alembic only (no create_all).
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from slowapi.errors import RateLimitExceeded

from app.api.routes import auth, chat, papers, projects, reviews
from app.core.config import settings
from app.core.logging import setup_logging
from app.core.rate_limit import limiter, rate_limit_exceeded
from app.db.session import AsyncSessionLocal, engine
from app.services import collection_service

setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup: ensure the log directory exists; fail collection jobs whose
    heartbeat went stale (e.g. cut off by a restart).
    Shutdown: dispose async engine connection pool.
    """
    os.makedirs("./logs", exist_ok=True)
    async with AsyncSessionLocal() as db:
        stale = await collection_service.fail_stale_collections(db)
        await db.commit()
    if stale:
        logger.warning(f"[Startup] Marked {stale} interrupted collection(s) as failed")
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    description="Production-grade AI Research Assistant Platform",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded)

# CORS must come before GZip
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def require_csrf_header(request: Request, call_next):
    """Cookie sessions + CSRF: state-changing API calls must carry
    X-Requested-With. Browsers only send custom headers cross-site after a CORS
    preflight, which our CORS_ORIGINS don't grant to other sites."""
    if (
        request.method in UNSAFE_METHODS
        and request.url.path.startswith(settings.API_V1_PREFIX)
        and not request.headers.get("x-requested-with")
    ):
        return JSONResponse({"detail": "Missing X-Requested-With header"}, status_code=403)
    return await call_next(request)


PREFIX = settings.API_V1_PREFIX
app.include_router(auth.router, prefix=f"{PREFIX}/auth", tags=["Auth"])
app.include_router(projects.router, prefix=f"{PREFIX}/projects", tags=["Projects"])
app.include_router(papers.router, prefix=f"{PREFIX}/papers", tags=["Papers"])
app.include_router(reviews.router, prefix=f"{PREFIX}/reviews", tags=["Reviews"])
app.include_router(chat.router, prefix=f"{PREFIX}/chat", tags=["Chat"])


@app.get("/", tags=["Health"])
async def root():
    return {"status": "ok", "app": settings.APP_NAME, "version": "1.0.0"}


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "healthy"}
