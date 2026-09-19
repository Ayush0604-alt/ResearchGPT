"""Project option: follow citations (snowballing)

Revision ID: 0008_snowball
Revises: 0007_screening
Create Date: 2026-09-19
"""

import sqlalchemy as sa
from alembic import op

revision = "0008_snowball"
down_revision = "0007_screening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "research_projects",
        sa.Column("snowball", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("research_projects", "snowball")
