"""
Agent 6: Comparison Agent
Compares findings, methodologies, and metrics across all papers.
Returns a Markdown comparison table.
"""
import json
from typing import List, Dict, Any
from loguru import logger
from app.utils.gemini_client import ask_gemini


class ComparisonAgent:
    async def run(self, papers: List[Dict[str, Any]]) -> str:
        """Generate a cross-paper comparison as Markdown."""
        if not papers:
            return "No papers to compare."

        papers_json = []
        for i, p in enumerate(papers, 1):
            papers_json.append({
                "index":        i,
                "title":        p.get("title", "")[:120],
                "year":         p.get("year"),
                "model":        (p.get("findings") or {}).get("model_used"),
                "dataset":      (p.get("findings") or {}).get("dataset_used"),
                "accuracy":     (p.get("findings") or {}).get("accuracy"),
                "contribution": (p.get("findings") or {}).get("contributions"),
                "limitations":  (p.get("findings") or {}).get("limitations"),
            })

        prompt = f"""You are a research analyst comparing academic papers.

Here are {len(papers)} papers in JSON format:
{json.dumps(papers_json, indent=2)}

Generate a comprehensive comparison in Markdown with:

## 1. Overview Comparison Table
A Markdown table with columns: #, Title, Year, Model/Method, Dataset, Key Metric

## 2. Methodology Comparison
Compare the approaches used across papers (2-3 paragraphs).

## 3. Performance Comparison
Compare reported metrics and results.

## 4. Key Differences
Highlight the most significant differences in approach or findings.

Be concise and factual."""

        result = await ask_gemini(prompt, max_tokens=2048)
        logger.info(f"[ComparisonAgent] Generated comparison for {len(papers)} papers")
        return result
