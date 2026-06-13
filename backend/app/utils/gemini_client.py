"""
Gemini 2.5 Flash client — singleton model instance shared across agents.
Uses generate_content_async for non-blocking calls.
"""
import google.generativeai as genai
from loguru import logger
from app.core.config import settings

genai.configure(api_key=settings.GEMINI_API_KEY)

# Single model instance — avoids re-configuring on every agent call
_model = genai.GenerativeModel(model_name=settings.GEMINI_MODEL)


async def ask_gemini(prompt: str, max_tokens: int = 4096) -> str:
    """
    Send a prompt to Gemini 2.5 Flash and return the text.
    Raises on API errors so callers can handle gracefully.
    """
    if not settings.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not set in environment")

    try:
        response = await _model.generate_content_async(
            prompt,
            generation_config=genai.GenerationConfig(
                max_output_tokens=max_tokens,
                temperature=0.3,
            ),
        )
        # Safety check — response.text raises if blocked
        text = response.text
        return text.strip() if text else ""
    except Exception as e:
        logger.error(f"[Gemini] API error: {type(e).__name__}: {e}")
        raise
