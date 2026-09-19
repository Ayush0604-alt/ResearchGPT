"""Per-run metadata on literature reviews: prompt version, models, token usage

Revision ID: 0010_run_meta
Revises: 0009_citation_checks
Create Date: 2026-09-19
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010_run_meta"
down_revision = "0009_citation_checks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("literature_reviews", sa.Column("run_meta", postgresql.JSONB()))


def downgrade() -> None:
    op.drop_column("literature_reviews", "run_meta")
