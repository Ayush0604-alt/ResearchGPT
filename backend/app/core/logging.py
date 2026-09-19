"""
Logging (loguru) and optional error tracking (Sentry).

- LOG_FORMAT=text (default): coloured, human-readable lines
- LOG_FORMAT=json: one JSON object per line, for log collectors
- LOG_TO_FILE: also write daily-rotated files under logs/ (off in containers,
  where stdout is collected)

Every line carries `request_id` (set per HTTP request) and, inside a collection
job, `project_id`, via logger.contextualize().
"""

import sys

from loguru import logger

from app.core.config import settings

TEXT_FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
    "<level>{level: <8}</level> | "
    "<magenta>{extra[request_id]}</magenta> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> — "
    "<level>{message}</level>"
)


def setup_logging():
    logger.remove()
    logger.configure(extra={"request_id": "-"})
    level = "DEBUG" if settings.DEBUG else "INFO"

    if settings.LOG_FORMAT == "json":
        logger.add(sys.stdout, level=level, serialize=True)
    else:
        logger.add(sys.stdout, level=level, format=TEXT_FORMAT, colorize=True)

    if settings.LOG_TO_FILE:
        logger.add(
            "logs/researchgpt_{time:YYYY-MM-DD}.log",
            level="INFO",
            format=TEXT_FORMAT,
            rotation="00:00",
            retention="30 days",
            compression="zip",
        )

    logger.info(f"Logging initialized — env={settings.APP_ENV} format={settings.LOG_FORMAT}")


# ── Sentry ────────────────────────────────────────────────────────────────────

SENSITIVE_HEADERS = {"authorization", "cookie", "set-cookie", "x-goog-api-key", "x-api-key"}


def scrub_event(event: dict, hint: dict | None = None) -> dict:
    """Drop anything that could hold credentials or user content."""
    request = event.get("request") or {}
    request.pop("cookies", None)
    request.pop("data", None)  # bodies: passwords, questions, paper text
    request.pop("query_string", None)
    headers = request.get("headers") or {}
    for name in list(headers):
        if name.lower() in SENSITIVE_HEADERS:
            headers[name] = "[scrubbed]"
    event.pop("user", None)
    return event


def setup_sentry() -> bool:
    """Enable Sentry when SENTRY_DSN is set. Returns whether it was enabled."""
    if not settings.SENTRY_DSN:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.APP_ENV,
        send_default_pii=False,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        max_request_body_size="never",
        before_send=scrub_event,
    )
    logger.info("Sentry enabled")
    return True
