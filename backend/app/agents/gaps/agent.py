"""
Agent 8: Research Gap Agent
Identifies limitations, unexplored areas, and future research directions.
"""
import json
from typing import List, Dict, Any
from loguru import logger
from app.utils.gemini_client import ask_gemini


class ResearchGapAgent:
    async def run(self, papers: List[Dict[str, Any]], topic: str) -> str:
        limitations = []
        for p in papers:
            findings = p.get("findings") or {}
            if findings.get("limitations"):
                limitations.append({
                    "title":       p.get("title", "")[:80],
                    "limitations": findings["limitations"],
                })

        prompt = f"""You are a research gap analyst for the topic: "{topic}"

Reviewed papers and their limitations:
{json.dumps(limitations, indent=2)}

Analyze and report research gaps in Markdown:

## Known Limitations Across Papers
Summarize the most common limitations mentioned.

## Unexplored Research Areas
Identify 3-5 research areas that have NOT been adequately addressed.

## Methodological Gaps
What methodological approaches are missing or underrepresented?

## Dataset Gaps
What kinds of data or benchmarks are lacking?

## Future Research Directions
Suggest 5 concrete, specific future research directions with brief justifications.

## Open Problems
List 3-5 open research problems in this area.

Be specific, forward-looking, and constructive."""

        result = await ask_gemini(prompt, max_tokens=2048)
        logger.info(f"[GapAgent] Generated research gaps for topic='{topic}'")
        return result
