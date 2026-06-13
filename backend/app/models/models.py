"""
SQLAlchemy ORM models for ResearchGPT.
"""
from datetime import datetime
from typing import Optional, List
import enum

from sqlalchemy import Integer, String, Text, Boolean, DateTime, Float, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


# ── Enums ─────────────────────────────────────────────────────────────────────

class ProjectStatus(str, enum.Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"


class PaperStatus(str, enum.Enum):
    FOUND      = "found"
    DOWNLOADED = "downloaded"
    PROCESSED  = "processed"
    FAILED     = "failed"


# ── Users ─────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id:               Mapped[int]  = mapped_column(Integer, primary_key=True, index=True)
    email:            Mapped[str]  = mapped_column(String(255), unique=True, index=True, nullable=False)
    username:         Mapped[str]  = mapped_column(String(100), unique=True, index=True, nullable=False)
    hashed_password:  Mapped[str]  = mapped_column(String(255), nullable=False)
    is_active:        Mapped[bool] = mapped_column(Boolean, default=True)
    created_at:       Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at:       Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    projects: Mapped[List["ResearchProject"]] = relationship("ResearchProject", back_populates="user")


# ── Research Projects ─────────────────────────────────────────────────────────

class ResearchProject(Base):
    __tablename__ = "research_projects"

    id:          Mapped[int]           = mapped_column(Integer, primary_key=True, index=True)
    user_id:     Mapped[int]           = mapped_column(ForeignKey("users.id"), nullable=False)
    title:       Mapped[str]           = mapped_column(String(500), nullable=False)
    topic:       Mapped[str]           = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    # Store as plain string — avoids SQLAlchemy Enum type migration complications
    status:      Mapped[str]           = mapped_column(String(50), default=ProjectStatus.PENDING.value)
    task_id:     Mapped[Optional[str]] = mapped_column(String(255))
    created_at:  Mapped[datetime]      = mapped_column(DateTime, server_default=func.now())
    updated_at:  Mapped[datetime]      = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user:              Mapped["User"]                       = relationship("User", back_populates="projects")
    papers:            Mapped[List["Paper"]]                = relationship("Paper",           back_populates="project", cascade="all, delete-orphan")
    literature_review: Mapped[Optional["LiteratureReview"]] = relationship("LiteratureReview",back_populates="project", uselist=False, cascade="all, delete-orphan")
    presentation:      Mapped[Optional["Presentation"]]     = relationship("Presentation",    back_populates="project", uselist=False, cascade="all, delete-orphan")
    chat_messages:     Mapped[List["ChatMessage"]]          = relationship("ChatMessage",     back_populates="project", cascade="all, delete-orphan")


# ── Papers ────────────────────────────────────────────────────────────────────

class Paper(Base):
    __tablename__ = "papers"

    id:          Mapped[int]           = mapped_column(Integer, primary_key=True, index=True)
    project_id:  Mapped[int]           = mapped_column(ForeignKey("research_projects.id"), nullable=False)
    title:       Mapped[str]           = mapped_column(String(1000), nullable=False)
    authors:     Mapped[Optional[str]] = mapped_column(Text)          # JSON-encoded list
    abstract:    Mapped[Optional[str]] = mapped_column(Text)
    year:        Mapped[Optional[int]] = mapped_column(Integer)
    url:         Mapped[Optional[str]] = mapped_column(String(2000))
    pdf_url:     Mapped[Optional[str]] = mapped_column(String(2000))
    pdf_path:    Mapped[Optional[str]] = mapped_column(String(500))
    source:      Mapped[Optional[str]] = mapped_column(String(100))
    external_id: Mapped[Optional[str]] = mapped_column(String(255))
    status:      Mapped[str]           = mapped_column(String(50), default=PaperStatus.FOUND.value)
    created_at:  Mapped[datetime]      = mapped_column(DateTime, server_default=func.now())

    project:  Mapped["ResearchProject"]       = relationship("ResearchProject", back_populates="papers")
    summary:  Mapped[Optional["PaperSummary"]]  = relationship("PaperSummary",  back_populates="paper", uselist=False, cascade="all, delete-orphan")
    findings: Mapped[Optional["PaperFindings"]] = relationship("PaperFindings", back_populates="paper", uselist=False, cascade="all, delete-orphan")


# ── Paper Summaries ───────────────────────────────────────────────────────────

class PaperSummary(Base):
    __tablename__ = "paper_summaries"

    id:          Mapped[int]           = mapped_column(Integer, primary_key=True, index=True)
    paper_id:    Mapped[int]           = mapped_column(ForeignKey("papers.id"), unique=True, nullable=False)
    summary:     Mapped[Optional[str]] = mapped_column(Text)
    methodology: Mapped[Optional[str]] = mapped_column(Text)
    conclusion:  Mapped[Optional[str]] = mapped_column(Text)
    created_at:  Mapped[datetime]      = mapped_column(DateTime, server_default=func.now())

    paper: Mapped["Paper"] = relationship("Paper", back_populates="summary")


# ── Paper Findings ────────────────────────────────────────────────────────────

class PaperFindings(Base):
    __tablename__ = "paper_findings"

    id:            Mapped[int]            = mapped_column(Integer, primary_key=True, index=True)
    paper_id:      Mapped[int]            = mapped_column(ForeignKey("papers.id"), unique=True, nullable=False)
    model_used:    Mapped[Optional[str]]  = mapped_column(Text)
    dataset_used:  Mapped[Optional[str]]  = mapped_column(Text)
    accuracy:      Mapped[Optional[str]]  = mapped_column(String(255))
    contributions: Mapped[Optional[str]]  = mapped_column(Text)
    limitations:   Mapped[Optional[str]]  = mapped_column(Text)
    raw_json:      Mapped[Optional[dict]] = mapped_column(JSON)
    created_at:    Mapped[datetime]       = mapped_column(DateTime, server_default=func.now())

    paper: Mapped["Paper"] = relationship("Paper", back_populates="findings")


# ── Literature Reviews ────────────────────────────────────────────────────────

class LiteratureReview(Base):
    __tablename__ = "literature_reviews"

    id:           Mapped[int]            = mapped_column(Integer, primary_key=True, index=True)
    project_id:   Mapped[int]            = mapped_column(ForeignKey("research_projects.id"), unique=True, nullable=False)
    introduction: Mapped[Optional[str]]  = mapped_column(Text)
    body:         Mapped[Optional[str]]  = mapped_column(Text)
    discussion:   Mapped[Optional[str]]  = mapped_column(Text)
    conclusion:   Mapped[Optional[str]]  = mapped_column(Text)
    trends:       Mapped[Optional[str]]  = mapped_column(Text)
    gaps:         Mapped[Optional[str]]  = mapped_column(Text)
    created_at:   Mapped[datetime]       = mapped_column(DateTime, server_default=func.now())

    project: Mapped["ResearchProject"] = relationship("ResearchProject", back_populates="literature_review")


# ── Presentations ─────────────────────────────────────────────────────────────

class Presentation(Base):
    __tablename__ = "presentations"

    id:         Mapped[int]            = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int]            = mapped_column(ForeignKey("research_projects.id"), unique=True, nullable=False)
    file_path:  Mapped[Optional[str]]  = mapped_column(String(500))
    slide_data: Mapped[Optional[dict]] = mapped_column(JSON)
    created_at: Mapped[datetime]       = mapped_column(DateTime, server_default=func.now())

    project: Mapped["ResearchProject"] = relationship("ResearchProject", back_populates="presentation")


# ── Chat Messages ─────────────────────────────────────────────────────────────

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id:         Mapped[int]            = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int]            = mapped_column(ForeignKey("research_projects.id"), nullable=False)
    role:       Mapped[str]            = mapped_column(String(20), nullable=False)   # "user" | "assistant"
    content:    Mapped[str]            = mapped_column(Text, nullable=False)
    citations:  Mapped[Optional[dict]] = mapped_column(JSON)
    created_at: Mapped[datetime]       = mapped_column(DateTime, server_default=func.now())

    project: Mapped["ResearchProject"] = relationship("ResearchProject", back_populates="chat_messages")
