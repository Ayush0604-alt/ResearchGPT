"""Keep earlier reviews as versions, so runs can be compared

Revision ID: 0012_review_runs
Revises: 0011_paper_chunks
Create Date: 2026-09-20
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0012_review_runs"
down_revision = "0011_paper_chunks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("research_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sections", postgresql.JSONB(), nullable=False),
        sa.Column("citation_checks", postgresql.JSONB()),
        sa.Column("run_meta", postgresql.JSONB()),
        sa.Column("papers", postgresql.JSONB()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_review_runs_project_id", "review_runs", ["project_id"])


def downgrade() -> None:
    op.drop_table("review_runs")
