"""Collection jobs: heartbeat, new statuses; drop task_id and pdf_path

Revision ID: 0004_collection_jobs
Revises: 0003_drop_presentations
Create Date: 2026-09-19

The in-memory task store and on-disk PDFs are gone. A collection job writes
progress and a heartbeat to research_projects; PDFs are never stored.
"""

import sqlalchemy as sa
from alembic import op

revision = "0004_collection_jobs"
down_revision = "0003_drop_presentations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 'running' belonged to the removed in-process pipeline.
    op.execute(
        "UPDATE research_projects SET status = 'failed', "
        "error = 'This run was interrupted by an upgrade. Please run it again.' "
        "WHERE status = 'running'"
    )
    op.add_column("research_projects", sa.Column("heartbeat_at", sa.DateTime(timezone=True)))
    op.drop_column("research_projects", "task_id")
    op.drop_column("papers", "pdf_path")


def downgrade() -> None:
    op.add_column("papers", sa.Column("pdf_path", sa.String(500)))
    op.add_column("research_projects", sa.Column("task_id", sa.String(255)))
    op.drop_column("research_projects", "heartbeat_at")
    op.execute(
        "UPDATE research_projects SET status = 'failed' "
        "WHERE status IN ('collecting', 'collected')"
    )
