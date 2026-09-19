"""Search filters, search candidates and relevance screening

Revision ID: 0007_screening
Revises: 0006_search_cache
Create Date: 2026-09-19
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007_screening"
down_revision = "0006_search_cache"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("research_projects", sa.Column("year_from", sa.Integer()))
    op.add_column("research_projects", sa.Column("year_to", sa.Integer()))
    op.add_column("research_projects", sa.Column("sources", postgresql.JSONB()))
    op.add_column("research_projects", sa.Column("candidates", postgresql.JSONB()))
    op.add_column("papers", sa.Column("relevance_score", sa.Integer()))
    op.add_column("papers", sa.Column("relevance_reason", sa.Text()))


def downgrade() -> None:
    op.drop_column("papers", "relevance_reason")
    op.drop_column("papers", "relevance_score")
    for column in ("candidates", "sources", "year_to", "year_from"):
        op.drop_column("research_projects", column)
