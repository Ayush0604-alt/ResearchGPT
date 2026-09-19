"""
Pydantic v2 schemas for request/response validation.
"""

from datetime import datetime
from typing import Annotated, Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field, StringConstraints, field_validator

# Trimmed strings with bounds. DB columns: title/topic String(500).
Topic = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]
Username = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_]+$"
    ),
]

# ── Auth ──────────────────────────────────────────────────────────────────────


class UserRegister(BaseModel):
    email: EmailStr
    username: Username
    password: str = Field(min_length=8)

    @field_validator("password")
    @classmethod
    def _fits_bcrypt(cls, v: str) -> str:
        # bcrypt only uses the first 72 bytes; reject rather than silently truncate.
        if len(v.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)  # no minimum: existing accounts may predate it


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str


class UserOut(BaseModel):
    id: int
    email: str
    username: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Projects ──────────────────────────────────────────────────────────────────


class ProjectCreate(BaseModel):
    topic: Topic
    title: Optional[Title] = None
    description: Optional[Description] = None

    @field_validator("title", "description", mode="before")
    @classmethod
    def _blank_is_missing(cls, v):
        # Forms send "" for untouched optional inputs.
        if isinstance(v, str) and not v.strip():
            return None
        return v


class ProjectOut(BaseModel):
    id: int
    user_id: int
    title: str
    topic: str
    description: Optional[str] = None
    status: str
    progress: int = 0
    current_step: Optional[str] = None
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectList(BaseModel):
    projects: List[ProjectOut]
    total: int


# ── Papers ────────────────────────────────────────────────────────────────────


class PaperOut(BaseModel):
    id: int
    project_id: int
    title: str
    authors: Optional[str] = None
    abstract: Optional[str] = None
    year: Optional[int] = None
    url: Optional[str] = None
    source: Optional[str] = None
    status: str
    has_full_text: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Summaries & Findings ──────────────────────────────────────────────────────


class SummaryOut(BaseModel):
    paper_id: int
    summary: Optional[str] = None
    methodology: Optional[str] = None
    conclusion: Optional[str] = None

    model_config = {"from_attributes": True}


class FindingsOut(BaseModel):
    paper_id: int
    model_used: Optional[str] = None
    dataset_used: Optional[str] = None
    accuracy: Optional[str] = None
    contributions: Optional[str] = None
    limitations: Optional[str] = None
    raw_json: Optional[Dict[str, Any]] = None

    model_config = {"from_attributes": True}


# ── Collection ────────────────────────────────────────────────────────────────────


class CollectRequest(BaseModel):
    max_papers: int = Field(default=10, ge=1, le=25)


# ── Literature Review ─────────────────────────────────────────────────────────


class LiteratureReviewOut(BaseModel):
    id: int
    project_id: int
    introduction: Optional[str] = None
    body: Optional[str] = None
    discussion: Optional[str] = None
    conclusion: Optional[str] = None
    trends: Optional[str] = None
    gaps: Optional[str] = None
    comparison: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Chat ──────────────────────────────────────────────────────────────────────


class ChatMessageOut(BaseModel):
    id: int
    project_id: int
    role: str
    content: str
    citations: Optional[Dict[str, Any]] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatHistoryOut(BaseModel):
    messages: List[ChatMessageOut]
    total: int
