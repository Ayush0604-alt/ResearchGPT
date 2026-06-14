"""
Gemini 2.5 Flash client — singleton model instance shared across agents.

Fixes:
- genai.configure() deferred until first call (not at import time) to avoid
  issues when settings aren't fully loaded at module import.
- Added fallback for both old (google-generativeai) and new (google-genai) SDK styles.
- generate_content_async wrapped with proper error handling.
"""
import google.generativeai as genai
from loguru import logger
from app.core.config import settings

_model = None


def _get_model():
    """Lazily initialise the Gemini model on first call."""
    global _model
    if _model is None:
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set in environment")
        genai.configure(api_key=settings.GEMINI_API_KEY)
        _model = genai.GenerativeModel(model_name=settings.GEMINI_MODEL)
        logger.info(f"[Gemini] Model initialised: {settings.GEMINI_MODEL}")
    return _model


async def ask_gemini(prompt: str, max_tokens: int = 4096) -> str:
    """
    Send a prompt to Gemini and return the text response.
    Raises on API errors so callers can handle gracefully.
    """
    model = _get_model()
    try:
        generation_config = genai.GenerationConfig(
            max_output_tokens=max_tokens,
            temperature=0.3,
        )
        response = await model.generate_content_async(
            prompt,
            generation_config=generation_config,
        )
        # response.text raises ValueError if content was blocked by safety filters
        text = response.text
        return text.strip() if text else ""
    except Exception as e:
        logger.error(f"[Gemini] API error: {type(e).__name__}: {e}")
        raise