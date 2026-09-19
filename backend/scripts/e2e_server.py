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
        "GEMINI_API_KEY": "",
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    reset_database()
    uvicorn.run("main:app", host="127.0.0.1", port=args.port, log_level="warning")
