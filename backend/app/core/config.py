"""
Application configuration — loaded from environment variables / .env file.

Fix: moved load_dotenv() call before Settings class definition so .env is
loaded before pydantic-settings tries to read values.
"""
import json
from typing import List
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # Ignore unknown env vars instead of raising
    )

    # ── App ────────────────────────────────────────────────────────────────────
    APP_NAME: str = "ResearchGPT"
    APP_ENV: str = "development"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api"

    # ── Security ───────────────────────────────────────────────────────────────
    SECRET_KEY: str = "dev_secret_key_change_in_production_min_32_chars"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    ALGORITHM: str = "HS256"

    # ── Database ───────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/researchgpt"
    SYNC_DATABASE_URL: str = "postgresql+psycopg://postgres:password@localhost:5432/researchgpt"

    # ── Google Gemini ──────────────────────────────────────────────────────────
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # ── ChromaDB ───────────────────────────────────────────────────────────────
    CHROMA_PERSIST_DIR: str = "./storage/chroma"
    CHROMA_COLLECTION_NAME: str = "research_papers"

    # ── Storage ────────────────────────────────────────────────────────────────
    PDF_STORAGE_DIR: str = "./storage/pdfs"
    MAX_PDF_SIZE_MB: int = 50

    # ── CORS ───────────────────────────────────────────────────────────────────
    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    # ── Rate Limits ────────────────────────────────────────────────────────────
    MAX_PAPERS_PER_SEARCH: int = 20
    MAX_PAPERS_TO_DOWNLOAD: int = 10

    # ── Redis ──────────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Future: AWS S3 ─────────────────────────────────────────────────────────
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_REGION: str = "us-east-1"
    AWS_S3_BUCKET: str = ""
    USE_S3: bool = False

    # ── Future: Pinecone ───────────────────────────────────────────────────────
    PINECONE_API_KEY: str = ""
    PINECONE_ENVIRONMENT: str = ""
    PINECONE_INDEX_NAME: str = "researchgpt"
    USE_PINECONE: bool = False

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                # Handle comma-separated string fallback
                return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("SYNC_DATABASE_URL", mode="before")
    @classmethod
    def force_psycopg3(cls, v):
        if isinstance(v, str) and v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+psycopg://", 1)
        return v


settings = Settings()