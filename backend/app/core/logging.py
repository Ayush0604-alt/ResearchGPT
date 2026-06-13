"""
Loguru-based structured logging configuration.
"""
import sys
from loguru import logger
from app.core.config import settings


def setup_logging():
    logger.remove()  # Remove default handler

    fmt = (
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> — "
        "<level>{message}</level>"
    )

    # Console
    logger.add(
        sys.stdout,
        format=fmt,
        level="DEBUG" if settings.DEBUG else "INFO",
        colorize=True,
    )

    # File — rotate daily, keep 30 days
    logger.add(
        "logs/researchgpt_{time:YYYY-MM-DD}.log",
        format=fmt,
        level="INFO",
        rotation="00:00",
        retention="30 days",
        compression="zip",
    )

    logger.info(f"Logging initialized — env={settings.APP_ENV}")
