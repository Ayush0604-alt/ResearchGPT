"""Schema hardening: tz-aware timestamps, NOT NULLs, FK indexes and cascades, run fields

Revision ID: 0002_schema_hardening
Revises: 0001_initial
Create Date: 2026-09-19

- every timestamp becomes TIMESTAMPTZ (existing naive values are read as UTC)
- columns the models declare non-optional become NOT NULL (backfilled first)
- foreign keys get ON DELETE CASCADE; FK columns used in lookups get indexes
- research_projects gains progress/current_step/error/started_at/finished_at
- papers gains full_text and doi; literature_reviews gains comparison
"""

import sqlalchemy as sa
from alembic import op

revision = "0002_schema_hardening"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

TIMESTAMPS = {
    "users": ["created_at", "updated_at"],
    "research_projects": ["created_at", "updated_at"],
    "papers": ["created_at"],
    "paper_summaries": ["created_at"],
    "paper_findings": ["created_at"],
    "literature_reviews": ["created_at"],
    "presentations": ["created_at"],
    "chat_messages": ["created_at"],
}

# (table, column, value used to backfill NULLs)
NOT_NULL = [
    ("users", "is_active", "true"),
    ("research_projects", "status", "'pending'"),
    ("papers", "status", "'found'"),
]

# (table, column, referred table). Names are Postgres' defaults from 0001.
FOREIGN_KEYS = [
    ("research_projects", "user_id", "users"),
    ("papers", "project_id", "research_projects"),
    ("paper_summaries", "paper_id", "papers"),
    ("paper_findings", "paper_id", "papers"),
    ("literature_reviews", "project_id", "research_projects"),
    ("presentations", "project_id", "research_projects"),
    ("chat_messages", "project_id", "research_projects"),
]

# FK columns without an index (the unique ones are already indexed).
FK_INDEXES = [
    ("research_projects", "user_id"),
    ("papers", "project_id"),
    ("chat_messages", "project_id"),
]


def _set_fk_ondelete(ondelete):
    for table, column, referred in FOREIGN_KEYS:
        name = f"{table}_{column}_fkey"
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, referred, [column], ["id"], ondelete=ondelete)


def upgrade() -> None:
    for table, columns in TIMESTAMPS.items():
        for column in columns:
            op.execute(f"UPDATE {table} SET {column} = now() WHERE {column} IS NULL")
            op.alter_column(
                table,
                column,
                type_=sa.DateTime(timezone=True),
                existing_type=sa.DateTime(),
                postgresql_using=f"{column} AT TIME ZONE 'UTC'",
                nullable=False,
            )

    for table, column, backfill in NOT_NULL:
        op.execute(f"UPDATE {table} SET {column} = {backfill} WHERE {column} IS NULL")
        op.alter_column(table, column, nullable=False)

    _set_fk_ondelete("CASCADE")
    for table, column in FK_INDEXES:
        op.create_index(f"ix_{table}_{column}", table, [column])

    op.add_column(
        "research_projects",
        sa.Column("progress", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("research_projects", sa.Column("current_step", sa.String(100)))
    op.add_column("research_projects", sa.Column("error", sa.Text()))
    op.add_column("research_projects", sa.Column("started_at", sa.DateTime(timezone=True)))
    op.add_column("research_projects", sa.Column("finished_at", sa.DateTime(timezone=True)))

    op.add_column("papers", sa.Column("full_text", sa.Text()))
    op.add_column("papers", sa.Column("doi", sa.String(255)))
    op.create_index("ix_papers_doi", "papers", ["doi"])

    op.add_column("literature_reviews", sa.Column("comparison", sa.Text()))


def downgrade() -> None:
    op.drop_column("literature_reviews", "comparison")

    op.drop_index("ix_papers_doi", "papers")
    op.drop_column("papers", "doi")
    op.drop_column("papers", "full_text")

    for column in ("finished_at", "started_at", "error", "current_step", "progress"):
        op.drop_column("research_projects", column)

    for table, column in FK_INDEXES:
        op.drop_index(f"ix_{table}_{column}", table)
    _set_fk_ondelete(None)

    for table, column, _ in NOT_NULL:
        op.alter_column(table, column, nullable=True)

    for table, columns in TIMESTAMPS.items():
        for column in columns:
            op.alter_column(
                table,
                column,
                type_=sa.DateTime(),
                existing_type=sa.DateTime(timezone=True),
                postgresql_using=f"{column} AT TIME ZONE 'UTC'",
                nullable=True,
            )
