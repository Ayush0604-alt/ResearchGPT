"""Search cache table; index papers.pdf_url for extracted-text reuse

Revision ID: 0006_search_cache
Revises: 0005_refresh_tokens
Create Date: 2026-09-19
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006_search_cache"
down_revision = "0005_refresh_tokens"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "search_cache",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("results", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_papers_pdf_url", "papers", ["pdf_url"])


def downgrade() -> None:
    op.drop_index("ix_papers_pdf_url", "papers")
    op.drop_table("search_cache")
