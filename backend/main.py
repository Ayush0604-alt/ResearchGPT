"""
ResearchGPT — FastAPI Application Entry Point

Fixes:
- Removed metadata.create_all (rely on Alembic only)
- Ensured all storage directories are created on startup
- GZipMiddleware and CORSMiddleware properly ordered
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.core.config import settings
from app.core.logging import setup_logging
from app.db.session import engine
from app.api.routes import auth, projects, papers, agents, reviews, chat

setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup: ensure all storage directories exist.
    Shutdown: dispose async engine connection pool.
    """
    os.makedirs(settings.PDF_STORAGE_DIR,    exist_ok=True)
    os.makedirs(settings.CHROMA_PERSIST_DIR, exist_ok=True)
    os.makedirs("./storage/presentations",   exist_ok=True)
    os.makedirs("./logs",                    exist_ok=True)
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

# CORS must come before GZip
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

PREFIX = settings.API_V1_PREFIX
app.include_router(auth.router,          prefix=f"{PREFIX}/auth",          tags=["Auth"])
app.include_router(projects.router,      prefix=f"{PREFIX}/projects",      tags=["Projects"])
app.include_router(papers.router,        prefix=f"{PREFIX}/papers",        tags=["Papers"])
app.include_router(agents.router,        prefix=f"{PREFIX}/agents",        tags=["Agents"])
app.include_router(reviews.router,       prefix=f"{PREFIX}/reviews",       tags=["Reviews"])
app.include_router(chat.router,          prefix=f"{PREFIX}/chat",          tags=["Chat"])


@app.get("/", tags=["Health"])
async def root():
    return {"status": "ok", "app": settings.APP_NAME, "version": "1.0.0"}


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "healthy"}