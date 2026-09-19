"""
Test harness.

Tests run against a throwaway local Postgres, never the database in .env:

    docker compose -f docker-compose.test.yml up -d

Override with TEST_DATABASE_URL (must point at localhost or the CI service).
Environment variables win over .env in pydantic-settings, so they are set here,
before anything imports `app`.
"""

import os
from urllib.parse import urlparse

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://postgres:test@127.0.0.1:55432/researchgpt_test",
)

_host = urlparse(TEST_DATABASE_URL).hostname
if _host not in {"localhost", "127.0.0.1", "test-db"}:
    raise RuntimeError(
        f"Refusing to run tests against non-local database host {_host!r}. "
        "Tests truncate every table."
    )

os.environ.update(
    {
        "DATABASE_URL": TEST_DATABASE_URL,
        "SYNC_DATABASE_URL": TEST_DATABASE_URL.replace("+asyncpg", "+psycopg"),
        "SECRET_KEY": "test-secret-key-that-is-at-least-32-characters-long",
        "GEMINI_API_KEY": "",  # tests must never reach a real LLM
        "DEBUG": "false",
    }
)

import itertools  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402
from main import app  # noqa: E402

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="session", autouse=True)
def _migrated_schema():
    """Build the schema once per session from the real Alembic migrations."""
    sync_url = os.environ["SYNC_DATABASE_URL"]
    sync_engine = create_engine(sync_url)
    with sync_engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    sync_engine.dispose()

    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    command.upgrade(cfg, "head")


@pytest.fixture(autouse=True)
async def _clean_db():
    """Empty every table after each test and drop pooled connections.

    Disposing the engine matters: asyncpg connections are bound to the event
    loop that opened them, and pytest-asyncio gives each test its own loop.
    """
    yield
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    await engine.dispose()


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test/api") as c:
        yield c


_counter = itertools.count(1)


@pytest.fixture
def make_user(client):
    """Register a user and return {id, email, username, password, headers}."""

    async def _make(**overrides):
        n = next(_counter)
        data = {
            "email": f"user{n}@example.com",
            "username": f"user{n}",
            "password": "correct-horse-battery",
            **overrides,
        }
        resp = await client.post("/auth/register", json=data)
        assert resp.status_code == 201, resp.text
        login = await client.post(
            "/auth/login", json={"email": data["email"], "password": data["password"]}
        )
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
        return {
            **data,
            "id": resp.json()["id"],
            "headers": {"Authorization": f"Bearer {token}"},
        }

    return _make


@pytest.fixture
def make_project(client):
    """Create a project owned by `user` and return its id."""

    async def _make(user, topic="graph neural networks"):
        resp = await client.post("/projects", json={"topic": topic}, headers=user["headers"])
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    return _make
