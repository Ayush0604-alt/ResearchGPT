"""
Application configuration — loaded from environment variables / .env file.
Environment variables take precedence over .env.
"""

import json
from typing import List

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_SECRET_KEY = "dev_secret_key_change_in_production_min_32_chars"
_PLACEHOLDER_SECRETS = {
    _DEV_SECRET_KEY,
    "your_jwt_secret_key_here_min_32_chars",
    "changeme",
    "change-me",
    "secret",
}


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
    DEBUG: bool = False
    SQL_ECHO: bool = False  # log every SQL statement (noisy; dev only)
    API_V1_PREFIX: str = "/api"

    # ── Security ───────────────────────────────────────────────────────────────
    # The default only works when APP_ENV=development (see _require_strong_secret).
    SECRET_KEY: str = _DEV_SECRET_KEY
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    BCRYPT_ROUNDS: int = Field(default=12, ge=4, le=16)  # tests use 4 for speed
    ALGORITHM: str = "HS256"

    # ── Database ───────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/researchgpt"
    SYNC_DATABASE_URL: str = "postgresql+psycopg://postgres:password@localhost:5432/researchgpt"

    # ── Google Gemini ──────────────────────────────────────────────────────────
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # ── Storage ────────────────────────────────────────────────────────────────
    PDF_STORAGE_DIR: str = "./storage/pdfs"
    MAX_PDF_SIZE_MB: int = 50

    # ── CORS ───────────────────────────────────────────────────────────────────
    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    # ── Rate Limits ────────────────────────────────────────────────────────────
    MAX_PAPERS_PER_SEARCH: int = 20
    MAX_PAPERS_TO_DOWNLOAD: int = 10

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

    @model_validator(mode="after")
    def _require_strong_secret(self):
        """Outside development, refuse to start with a guessable JWT secret."""
        if self.APP_ENV == "development":
            return self
        if len(self.SECRET_KEY) < 32 or self.SECRET_KEY in _PLACEHOLDER_SECRETS:
            raise ValueError(
                f"SECRET_KEY is missing, too short or a placeholder (APP_ENV={self.APP_ENV}). "
                "Generate one with: openssl rand -hex 32"
            )
        return self


settings = Settings()
