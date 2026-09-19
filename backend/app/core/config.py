"""
Application configuration — loaded from environment variables / .env file.
Environment variables take precedence over .env.
"""

import json
from typing import List

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_SECRET_KEY = "dev_secret_key_change_in_production_min_32_chars"
# The server must never hold an LLM key: users bring their own, and it stays in
# their browser. These are refused outside development (see _no_server_llm_keys).
LLM_KEY_VARS = ("GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY")

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
    LOG_FORMAT: str = Field(default="text", pattern="^(text|json)$")
    LOG_TO_FILE: bool = True  # turn off in containers; stdout is collected there
    SENTRY_DSN: str = ""  # optional error tracking (backend only)
    SENTRY_TRACES_SAMPLE_RATE: float = Field(default=0.0, ge=0.0, le=1.0)
    API_V1_PREFIX: str = "/api"

    # ── Security ───────────────────────────────────────────────────────────────
    # The default only works when APP_ENV=development (see _require_strong_secret).
    SECRET_KEY: str = _DEV_SECRET_KEY
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # Session cookies only over HTTPS. Required outside development.
    COOKIE_SECURE: bool = True
    BCRYPT_ROUNDS: int = Field(default=12, ge=4, le=16)  # tests use 4 for speed
    ALGORITHM: str = "HS256"

    # ── Database ───────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/researchgpt"
    SYNC_DATABASE_URL: str = "postgresql+psycopg://postgres:password@localhost:5432/researchgpt"

    # ── Paper search (server-owned keys for free data APIs; not LLM keys) ──────
    CONTACT_EMAIL: str = ""  # sent to OpenAlex (polite pool) and required by Unpaywall
    SEMANTIC_SCHOLAR_API_KEY: str = ""  # optional; raises S2 rate limits
    OPENALEX_API_KEY: str = ""  # optional

    # ── Paper collection ───────────────────────────────────────────────────────
    # PDFs are read in memory and discarded; only extracted text is stored.
    MAX_PDF_SIZE_MB: int = 25

    # ── LLM keys: must stay empty outside development ──────────────────────────
    # Declared only so they're read like every other setting (env or .env) and
    # can be refused below. Nothing on the server uses them.
    GEMINI_API_KEY: str = ""
    GOOGLE_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""

    # ── Abuse limits ───────────────────────────────────────────────────────────
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_STORAGE_URI: str = "memory://"  # per instance; e.g. redis://… to share
    MAX_PROJECTS_PER_DAY: int = 20

    # ── CORS ───────────────────────────────────────────────────────────────────
    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

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
        if not self.COOKIE_SECURE:
            raise ValueError(f"COOKIE_SECURE must be true (APP_ENV={self.APP_ENV}).")
        if len(self.SECRET_KEY) < 32 or self.SECRET_KEY in _PLACEHOLDER_SECRETS:
            raise ValueError(
                f"SECRET_KEY is missing, too short or a placeholder (APP_ENV={self.APP_ENV}). "
                "Generate one with: openssl rand -hex 32"
            )
        return self

    @model_validator(mode="after")
    def _no_server_llm_keys(self):
        """Outside development, refuse to start if an LLM key is configured.

        Such a key would be unused at best, and at worst a sign that server-side
        LLM calls (billed to the operator) have crept back in.
        """
        if self.APP_ENV == "development":
            return self
        found = [name for name in LLM_KEY_VARS if getattr(self, name)]
        if found:
            raise ValueError(
                f"{', '.join(found)} must not be set on the server (APP_ENV={self.APP_ENV}). "
                "Users bring their own key in the browser."
            )
        return self


settings = Settings()
