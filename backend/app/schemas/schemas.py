"""
Pydantic v2 schemas for request/response validation.
"""

from datetime import datetime
from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import (
    BaseModel,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

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


class AccountDeletion(BaseModel):
    password: str = Field(max_length=128)


class UserOut(BaseModel):
    id: int
    email: str
    username: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Projects ──────────────────────────────────────────────────────────────────


SourceName = Literal["semantic_scholar", "openalex", "arxiv", "europepmc"]
Year = Annotated[int, Field(ge=1900, le=2100)]


class ProjectCreate(BaseModel):
    topic: Topic
    title: Optional[Title] = None
    description: Optional[Description] = None
    year_from: Optional[Year] = None
    year_to: Optional[Year] = None
    sources: Optional[List[SourceName]] = Field(default=None, min_length=1)
    snowball: bool = False

    @model_validator(mode="after")
    def _years_in_order(self):
        if self.year_from and self.year_to and self.year_from > self.year_to:
            raise ValueError("year_from must not be after year_to")
        return self

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
    year_from: Optional[int] = None
    year_to: Optional[int] = None
    sources: Optional[List[str]] = None
    snowball: bool = False
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
    doi: Optional[str] = None
    relevance_score: Optional[int] = None
    relevance_reason: Optional[str] = None
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


# ── Browser analysis (results computed in the browser with the user's key) ───

# Generous caps: model output, but bounded so a client can't store megabytes.
ShortText = Annotated[str, StringConstraints(max_length=20_000)]
LongText = Annotated[str, StringConstraints(max_length=60_000)]


class PaperForAnalysis(BaseModel):
    id: int
    title: str
    authors: Optional[str] = None
    year: Optional[int] = None
    abstract: Optional[str] = None
    full_text: Optional[str] = None
    url: Optional[str] = None
    has_pdf: bool = False
    has_extraction: bool = False


class PaperExtractionIn(BaseModel):
    summary: ShortText
    methodology: ShortText = ""
    conclusion: ShortText = ""
    model_used: ShortText = ""
    dataset_used: ShortText = ""
    metrics: ShortText = ""
    contributions: ShortText = ""
    limitations: ShortText = ""
    key_quotes: List[Annotated[str, StringConstraints(max_length=2_000)]] = Field(
        default_factory=list, max_length=10
    )
    model: Annotated[str, StringConstraints(max_length=100)] = ""


class AnalysisIn(BaseModel):
    introduction: LongText
    body: LongText
    discussion: LongText = ""
    conclusion: LongText = ""
    trends: LongText = ""
    gaps: LongText = ""
    comparison: LongText = ""
    model: Annotated[str, StringConstraints(max_length=100)] = ""


# ── Collection ────────────────────────────────────────────────────────────────


Query = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=200)]


class SearchRequest(BaseModel):
    """Search queries planned in the browser (the topic itself is always added)."""

    queries: List[Query] = Field(default_factory=list, max_length=5)


class Candidate(BaseModel):
    id: int
    title: str
    authors: List[str] = []
    abstract: str = ""
    year: Optional[int] = None
    source: str = ""
    doi: Optional[str] = None
    has_pdf: bool = False


class SearchOut(BaseModel):
    candidates: List[Candidate]


class SnowballRequest(BaseModel):
    """Candidate ids of the best-rated papers to follow citations from."""

    seed_ids: List[int] = Field(min_length=1, max_length=5)


class Relevance(BaseModel):
    id: int
    score: int = Field(ge=0, le=10)
    reason: Annotated[str, StringConstraints(max_length=300)] = ""


class CollectRequest(BaseModel):
    max_papers: int = Field(default=10, ge=1, le=25)
    # Candidates chosen by screening. Without them the topic is searched directly.
    candidate_ids: Optional[List[int]] = Field(default=None, min_length=1, max_length=25)
    relevance: List[Relevance] = Field(default_factory=list, max_length=100)


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


class ChatCitationIn(BaseModel):
    paper_id: int


class ChatExchangeIn(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    answer: str = Field(min_length=1, max_length=20_000)
    citations: List[ChatCitationIn] = Field(default_factory=list, max_length=50)


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
