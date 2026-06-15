"""
Gemini 2.5 Flash client — singleton model instance shared across agents.

Fixes:
- Migrated from legacy `google-generativeai` to the new `google-genai` SDK.
- The new SDK uses REST natively and bypasses the `grpcio` Python 3.13 Windows issue!
"""
from google import genai
from google.genai import types
from loguru import logger
from app.core.config import settings

_client = None


def _get_client():
    """Lazily initialise the Gemini client on first call."""
    global _client
    if _client is None:
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set in environment")
        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
        logger.info(f"[Gemini] Client initialised for: {settings.GEMINI_MODEL}")
    return _client


class RateLimitError(Exception):
    """Raised when the Gemini API returns a 429 ResourceExhausted error."""
    pass


async def ask_gemini(prompt: str, max_tokens: int = 4096, response_schema=None) -> str:
    """
    Send a prompt to Gemini and return the text response.
    Raises on API errors so callers can handle gracefully.
    """
    client = _get_client()
    try:
        config_kwargs = {
            "max_output_tokens": max_tokens,
            "temperature": 0.3,
        }
        if response_schema:
            config_kwargs["response_mime_type"] = "application/json"
            config_kwargs["response_schema"] = response_schema
            
        response = await client.aio.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(**config_kwargs)
        )
        text = response.text
        return text.strip() if text else ""
    except Exception as e:
        error_str = str(e)
        logger.error(f"[Gemini] API error: {type(e).__name__}: {e}")
        if "429" in error_str or "ResourceExhausted" in type(e).__name__ or "ResourceExhausted" in error_str:
            raise RateLimitError("Gemini API rate limit exceeded (429 ResourceExhausted).") from e
        raise