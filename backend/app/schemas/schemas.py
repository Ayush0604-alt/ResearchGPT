"""
Pydantic v2 schemas for request/response validation.

Fixes:
- CitationSource.relevance_score is Optional[float] with default 0.0 —
  ChromaDB distance-to-score conversion may produce None in edge cases.
- RAGResponse.citations uses List[Dict] as fallback if structured parsing fails.
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


class ProjectOut(BaseModel):
    id: int
    user_id: int
    title: str
    topic: str
    description: Optional[str] = None
    status: str
    task_id: Optional[str] = None
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


class PaperMetadata(BaseModel):
    title: str
    authors: Optional[List[str]] = []
    abstract: Optional[str] = None
    year: Optional[int] = None
    url: Optional[str] = None
    pdf_url: Optional[str] = None
    source: Optional[str] = None
    external_id: Optional[str] = None


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


# ── Agents ────────────────────────────────────────────────────────────────────


class AgentRunRequest(BaseModel):
    project_id: int
    max_papers: int = Field(default=10, ge=1, le=25)


class AgentStatusResponse(BaseModel):
    task_id: str
    status: str  # pending | running | completed | failed
    progress: Optional[int] = None  # 0-100
    current_agent: Optional[str] = None
    error: Optional[str] = None


# ── RAG ───────────────────────────────────────────────────────────────────────


class RAGQuery(BaseModel):
    project_id: int
    question: str


class CitationSource(BaseModel):
    paper_title: str
    paper_id: Optional[int] = None
    chunk_text: str
    # FIX: Optional with default 0.0 — score may be missing in edge cases
    relevance_score: Optional[float] = 0.0


class RAGResponse(BaseModel):
    answer: str
    citations: List[CitationSource]
    question: str


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


# ── Presentations ─────────────────────────────────────────────────────────────


class PresentationOut(BaseModel):
    id: int
    project_id: int
    file_path: Optional[str] = None
    slide_data: Optional[Dict[str, Any]] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Chat ──────────────────────────────────────────────────────────────────────


class ChatMessageIn(BaseModel):
    project_id: int
    message: str


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
