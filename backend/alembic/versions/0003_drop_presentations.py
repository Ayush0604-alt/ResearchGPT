"""Drop the unused presentations table (PPTX export was removed)

Revision ID: 0003_drop_presentations
Revises: 0002_schema_hardening
Create Date: 2026-09-19
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_drop_presentations"
down_revision = "0002_schema_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("presentations")


def downgrade() -> None:
    op.create_table(
        "presentations",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("research_projects.id", ondelete="CASCADE"),
            unique=True,
            nullable=False,
        ),
        sa.Column("file_path", sa.String(500)),
        sa.Column("slide_data", sa.JSON()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
