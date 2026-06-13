"""Initial schema — all tables

Revision ID: 0001_initial
Revises:
Create Date: 2025-01-01 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision    = "0001_initial"
down_revision = None
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # users
    op.create_table(
        "users",
        sa.Column("id",              sa.Integer(),     primary_key=True, index=True),
        sa.Column("email",           sa.String(255),   nullable=False, unique=True, index=True),
        sa.Column("username",        sa.String(100),   nullable=False, unique=True, index=True),
        sa.Column("hashed_password", sa.String(255),   nullable=False),
        sa.Column("is_active",       sa.Boolean(),     server_default="true"),
        sa.Column("created_at",      sa.DateTime(),    server_default=sa.func.now()),
        sa.Column("updated_at",      sa.DateTime(),    server_default=sa.func.now(),
                  onupdate=sa.func.now()),
    )

    # research_projects
    op.create_table(
        "research_projects",
        sa.Column("id",          sa.Integer(),    primary_key=True, index=True),
        sa.Column("user_id",     sa.Integer(),    sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title",       sa.String(500),  nullable=False),
        sa.Column("topic",       sa.String(500),  nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("status",      sa.String(50),   server_default="pending"),
        sa.Column("task_id",     sa.String(255)),
        sa.Column("created_at",  sa.DateTime(),   server_default=sa.func.now()),
        sa.Column("updated_at",  sa.DateTime(),   server_default=sa.func.now(),
                  onupdate=sa.func.now()),
    )

    # papers
    op.create_table(
        "papers",
        sa.Column("id",          sa.Integer(),    primary_key=True, index=True),
        sa.Column("project_id",  sa.Integer(),    sa.ForeignKey("research_projects.id"), nullable=False),
        sa.Column("title",       sa.String(1000), nullable=False),
        sa.Column("authors",     sa.Text()),
        sa.Column("abstract",    sa.Text()),
        sa.Column("year",        sa.Integer()),
        sa.Column("url",         sa.String(2000)),
        sa.Column("pdf_url",     sa.String(2000)),
        sa.Column("pdf_path",    sa.String(500)),
        sa.Column("source",      sa.String(100)),
        sa.Column("external_id", sa.String(255)),
        sa.Column("status",      sa.String(50),   server_default="found"),
        sa.Column("created_at",  sa.DateTime(),   server_default=sa.func.now()),
    )

    # paper_summaries
    op.create_table(
        "paper_summaries",
        sa.Column("id",          sa.Integer(),  primary_key=True, index=True),
        sa.Column("paper_id",    sa.Integer(),  sa.ForeignKey("papers.id"), unique=True, nullable=False),
        sa.Column("summary",     sa.Text()),
        sa.Column("methodology", sa.Text()),
        sa.Column("conclusion",  sa.Text()),
        sa.Column("created_at",  sa.DateTime(), server_default=sa.func.now()),
    )

    # paper_findings
    op.create_table(
        "paper_findings",
        sa.Column("id",            sa.Integer(),    primary_key=True, index=True),
        sa.Column("paper_id",      sa.Integer(),    sa.ForeignKey("papers.id"), unique=True, nullable=False),
        sa.Column("model_used",    sa.Text()),
        sa.Column("dataset_used",  sa.Text()),
        sa.Column("accuracy",      sa.String(255)),
        sa.Column("contributions", sa.Text()),
        sa.Column("limitations",   sa.Text()),
        sa.Column("raw_json",      sa.JSON()),
        sa.Column("created_at",    sa.DateTime(),   server_default=sa.func.now()),
    )

    # literature_reviews
    op.create_table(
        "literature_reviews",
        sa.Column("id",           sa.Integer(),  primary_key=True, index=True),
        sa.Column("project_id",   sa.Integer(),  sa.ForeignKey("research_projects.id"),
                  unique=True, nullable=False),
        sa.Column("introduction", sa.Text()),
        sa.Column("body",         sa.Text()),
        sa.Column("discussion",   sa.Text()),
        sa.Column("conclusion",   sa.Text()),
        sa.Column("trends",       sa.Text()),
        sa.Column("gaps",         sa.Text()),
        sa.Column("created_at",   sa.DateTime(), server_default=sa.func.now()),
    )

    # presentations
    op.create_table(
        "presentations",
        sa.Column("id",         sa.Integer(),  primary_key=True, index=True),
        sa.Column("project_id", sa.Integer(),  sa.ForeignKey("research_projects.id"),
                  unique=True, nullable=False),
        sa.Column("file_path",  sa.String(500)),
        sa.Column("slide_data", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )

    # chat_messages
    op.create_table(
        "chat_messages",
        sa.Column("id",         sa.Integer(),  primary_key=True, index=True),
        sa.Column("project_id", sa.Integer(),  sa.ForeignKey("research_projects.id"), nullable=False),
        sa.Column("role",       sa.String(20), nullable=False),
        sa.Column("content",    sa.Text(),     nullable=False),
        sa.Column("citations",  sa.JSON()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("presentations")
    op.drop_table("literature_reviews")
    op.drop_table("paper_findings")
    op.drop_table("paper_summaries")
    op.drop_table("papers")
    op.drop_table("research_projects")
    op.drop_table("users")