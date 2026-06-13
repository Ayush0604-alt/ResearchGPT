"""
Agent 2: Paper Collection Agent
Downloads PDFs from URLs and stores them locally (S3-ready).
"""
import os
import hashlib
from pathlib import Path
from typing import Dict, Any, Optional

import aiofiles
import httpx
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings


class PaperCollectionAgent:
    """
    Downloads PDFs for papers that have a pdf_url.
    Stores files in settings.PDF_STORAGE_DIR / {project_id} / {hash}.pdf
    Returns updated paper dict with local pdf_path.
    """

    def __init__(self):
        self.storage_dir = Path(settings.PDF_STORAGE_DIR)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.max_size_bytes = settings.MAX_PDF_SIZE_MB * 1024 * 1024
        self.timeout = httpx.Timeout(60.0)

    async def run(self, paper: Dict[str, Any], project_id: int) -> Dict[str, Any]:
        """
        Download the paper's PDF if a URL exists.
        Returns the paper dict with pdf_path added.
        """
        pdf_url = paper.get("pdf_url")
        if not pdf_url:
            logger.debug(f"[CollectionAgent] No PDF URL for: {paper.get('title', '')[:60]}")
            return paper

        dest_dir = self.storage_dir / str(project_id)
        dest_dir.mkdir(parents=True, exist_ok=True)

        # Deterministic filename from URL hash
        url_hash = hashlib.md5(pdf_url.encode()).hexdigest()[:12]
        dest_path = dest_dir / f"{url_hash}.pdf"

        if dest_path.exists():
            logger.debug(f"[CollectionAgent] PDF already exists: {dest_path}")
            paper["pdf_path"] = str(dest_path)
            return paper

        try:
            pdf_path = await self._download_pdf(pdf_url, dest_path)
            paper["pdf_path"] = pdf_path
            logger.info(f"[CollectionAgent] Downloaded: {dest_path.name}")
        except Exception as e:
            logger.warning(f"[CollectionAgent] Download failed for {pdf_url}: {e}")
            paper["pdf_path"] = None

        return paper

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=15))
    async def _download_pdf(self, url: str, dest: Path) -> Optional[str]:
        headers = {
            "User-Agent": "ResearchGPT/1.0 (research tool; mailto:contact@researchgpt.ai)"
        }
        async with httpx.AsyncClient(
            timeout=self.timeout,
            follow_redirects=True,
            headers=headers,
        ) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()

                content_type = resp.headers.get("content-type", "")
                if "pdf" not in content_type and not url.endswith(".pdf"):
                    logger.warning(f"[CollectionAgent] Non-PDF content-type: {content_type}")

                downloaded = 0
                async with aiofiles.open(dest, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=8192):
                        downloaded += len(chunk)
                        if downloaded > self.max_size_bytes:
                            logger.warning(f"[CollectionAgent] File too large, aborting")
                            break
                        await f.write(chunk)

        return str(dest)
