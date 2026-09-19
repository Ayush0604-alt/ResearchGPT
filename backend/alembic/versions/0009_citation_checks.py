"""Claim-level citation checks on literature reviews

Revision ID: 0009_citation_checks
Revises: 0008_snowball
Create Date: 2026-09-19
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009_citation_checks"
down_revision = "0008_snowball"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("literature_reviews", sa.Column("citation_checks", postgresql.JSONB()))


def downgrade() -> None:
    op.drop_column("literature_reviews", "citation_checks")
