"""
Agent 4: Summarization Agent
Generates concise summary, methodology, and conclusion for each paper.
"""
from typing import Dict, Any
from loguru import logger
from app.utils.gemini_client import ask_gemini


class SummarizationAgent:
    async def run(self, paper: Dict[str, Any]) -> Dict[str, Any]:
        title    = paper.get("title", "")
        abstract = paper.get("abstract", "") or ""
        text_preview = paper.get("extracted_text", abstract)[:4000]

        prompt = f"""You are a research analyst. Analyze the following academic paper and provide:

Paper Title: {title}

Content:
{text_preview}

Provide a structured response with these exact sections:

## SUMMARY
A concise 3-5 sentence summary of the paper's main contribution and findings.

## METHODOLOGY
The key methods, algorithms, frameworks, or approaches used (2-4 sentences).

## CONCLUSION
The main conclusions, results, and implications (2-4 sentences).

Be factual, precise, and academic in tone."""

        response = await ask_gemini(prompt)

        summary, methodology, conclusion = self._parse_response(response)
        return {
            **paper,
            "summary":     summary,
            "methodology": methodology,
            "conclusion":  conclusion,
        }

    def _parse_response(self, text: str):
        sections = {"SUMMARY": "", "METHODOLOGY": "", "CONCLUSION": ""}
        current = None
        for line in text.split("\n"):
            stripped = line.strip()
            if "## SUMMARY" in stripped:
                current = "SUMMARY"
            elif "## METHODOLOGY" in stripped:
                current = "METHODOLOGY"
            elif "## CONCLUSION" in stripped:
                current = "CONCLUSION"
            elif current and stripped:
                sections[current] += stripped + " "
        return (
            sections["SUMMARY"].strip(),
            sections["METHODOLOGY"].strip(),
            sections["CONCLUSION"].strip(),
        )
