"""Migration 0002 must upgrade data written under 0001 and round-trip cleanly."""

import os

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from tests.conftest import BACKEND_DIR


def _alembic():
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    return cfg


def test_0002_upgrades_legacy_rows_and_downgrades():
    cfg = _alembic()
    engine = create_engine(os.environ["SYNC_DATABASE_URL"])
    try:
        command.downgrade(cfg, "0001_initial")
        with engine.begin() as conn:
            # Rows as 0001 allowed them: NULL is_active/status, naive timestamps.
            conn.execute(
                text(
                    "INSERT INTO users (id, email, username, hashed_password, is_active, created_at)"
                    " VALUES (1, 'a@x.io', 'a', 'h', NULL, '2026-01-02 03:04:05')"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO research_projects (id, user_id, title, topic, status)"
                    " VALUES (1, 1, 't', 'topic', NULL)"
                )
            )
            conn.execute(text("INSERT INTO papers (id, project_id, title) VALUES (1, 1, 'p')"))

        command.upgrade(cfg, "head")

        with engine.begin() as conn:
            user = conn.execute(text("SELECT is_active, created_at FROM users")).one()
            assert user.is_active is True
            assert user.created_at.tzinfo is not None
            assert user.created_at.isoformat().startswith("2026-01-02T03:04:05")
            project = conn.execute(text("SELECT status, progress FROM research_projects")).one()
            assert (project.status, project.progress) == ("pending", 0)

            # ON DELETE CASCADE now works below the ORM too.
            conn.execute(text("DELETE FROM users WHERE id = 1"))
            assert conn.execute(text("SELECT count(*) FROM papers")).scalar() == 0

        command.downgrade(cfg, "0001_initial")
        command.upgrade(cfg, "head")
    finally:
        with engine.begin() as conn:
            conn.execute(text("TRUNCATE users RESTART IDENTITY CASCADE"))
        engine.dispose()
