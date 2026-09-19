"""
Start the API for end-to-end tests on a freshly migrated, disposable database.

Usage (Playwright runs this for you):
    E2E_DATABASE_URL=postgresql+asyncpg://postgres:test@127.0.0.1:55432/researchgpt_e2e \
        python scripts/e2e_server.py --port 8001

Refuses to touch any database that isn't on localhost.
"""

import argparse
import os
import sys
from urllib.parse import urlparse

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

url = os.environ.get(
    "E2E_DATABASE_URL",
    "postgresql+asyncpg://postgres:test@127.0.0.1:55432/researchgpt_e2e",
)
parsed = urlparse(url)
if parsed.hostname not in {"localhost", "127.0.0.1"}:
    sys.exit(f"Refusing to reset non-local database host {parsed.hostname!r}")

sync_url = url.replace("+asyncpg", "+psycopg")
os.environ.update(
    {
        "DATABASE_URL": url,
        "SYNC_DATABASE_URL": sync_url,
        "APP_ENV": "development",
        "SECRET_KEY": "e2e-secret-key-that-is-at-least-32-characters",
        "BCRYPT_ROUNDS": "4",
        "RATE_LIMIT_ENABLED": "false",
        "COOKIE_SECURE": "false",  # the e2e site is plain http
    }
)
sys.path.insert(0, BACKEND_DIR)
os.chdir(BACKEND_DIR)

import uvicorn  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402


def reset_database() -> None:
    db_name = parsed.path.lstrip("/")
    admin = create_engine(sync_url.rsplit("/", 1)[0] + "/postgres", isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": db_name})
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    admin.dispose()

    engine = create_engine(sync_url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    engine.dispose()
    command.upgrade(Config(os.path.join(BACKEND_DIR, "alembic.ini")), "head")


FAKE_PAPERS = [
    {
        "title": "Graph Transformers for Molecular Property Prediction",
        "authors": ["Ada Lovelace", "Alan Turing"],
        "abstract": "We apply graph transformers to molecular benchmarks and improve ROC-AUC.",
        "year": 2024,
        "url": "https://example.org/papers/1",
        "pdf_url": "https://example.org/papers/1.pdf",
        "source": "arxiv",
        "external_id": "e2e-1",
        "doi": "10.5555/e2e-1",
    },
    {
        "title": "Message Passing Networks Revisited",
        "authors": ["Grace Hopper"],
        "abstract": "A careful re-evaluation of message passing neural networks on OGB.",
        "year": 2023,
        "url": "https://example.org/papers/2",
        "pdf_url": None,
        "source": "semantic_scholar",
        "external_id": "e2e-2",
    },
    {
        "title": "Positional Encodings for Graphs",
        "authors": ["Katherine Johnson"],
        "abstract": "We compare Laplacian and random-walk positional encodings for graphs.",
        "year": 2022,
        "url": "https://example.org/papers/3",
        "pdf_url": "https://example.org/papers/3.pdf",
        "source": "arxiv",
        "external_id": "e2e-3",
    },
]


def use_fake_sources() -> None:
    """E2E runs must not depend on Semantic Scholar/arXiv/PubMed being up."""
    from app.services import collection_service

    async def search(topic, max_papers):
        return [dict(p) for p in FAKE_PAPERS][:max_papers]

    async def fetch_text(client, url):
        return f"Full text of {url}. " * 40

    async def candidates(queries, limit, year_from=None, year_to=None, sources=None):
        return [dict(p) for p in FAKE_PAPERS]

    collection_service.default_search = search

    async def neighbours(dois, limit):
        return [
            {
                "title": "A Foundational Paper on Graph Attention",
                "authors": ["Donald Knuth"],
                "abstract": "The original graph attention mechanism that later work builds on.",
                "year": 2018,
                "url": "https://example.org/papers/4",
                "pdf_url": "https://example.org/papers/4.pdf",
                "source": "openalex",
                "external_id": "e2e-4",
                "doi": "10.5555/e2e-4",
            }
        ]

    collection_service.default_candidates = candidates
    collection_service.default_neighbours = neighbours
    collection_service.default_fetch_text = fetch_text


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    reset_database()
    use_fake_sources()
    from main import app

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
