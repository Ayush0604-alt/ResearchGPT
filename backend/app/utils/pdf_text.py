"""
Plain-text extraction from PDF bytes (pypdf, BSD-licensed).

PDFs come from the internet, so parsing is bounded: page count, output size,
and it runs in a worker thread so a slow file can't block the event loop.
"""

import asyncio
import io
import logging
import re

from pypdf import PdfReader

MAX_PAGES = 60
MAX_CHARS = 150_000

# pypdf logs a warning for every malformed object; that's noise for us.
logging.getLogger("pypdf").setLevel(logging.ERROR)


def looks_like_pdf(data: bytes) -> bool:
    return data[:1024].lstrip().startswith(b"%PDF-")


def _extract(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    parts = []
    for page in reader.pages[:MAX_PAGES]:
        parts.append(page.extract_text() or "")
        if sum(map(len, parts)) > MAX_CHARS:
            break
    text = "\n\n".join(parts)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:MAX_CHARS]


async def extract_pdf_text(data: bytes) -> str | None:
    """Return the PDF's text, or None when it isn't a readable PDF."""
    if not looks_like_pdf(data):
        return None
    try:
        text = await asyncio.to_thread(_extract, data)
    except Exception:
        return None
    # Scanned PDFs often yield no text at all.
    return text if len(text) >= 200 else None
