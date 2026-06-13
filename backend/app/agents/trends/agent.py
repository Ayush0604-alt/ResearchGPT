"""
Agent 7: Trend Analysis Agent
Identifies common datasets, models, and emerging research trends.
"""
import json
from typing import List, Dict, Any
from loguru import logger
from app.utils.gemini_client import ask_gemini


class TrendAnalysisAgent:
    async def run(self, papers: List[Dict[str, Any]]) -> str:
        paper_data = []
        for p in papers:
            paper_data.append({
                "title":       p.get("title", "")[:100],
                "year":        p.get("year"),
                "model":       (p.get("findings") or {}).get("model_used"),
                "dataset":     (p.get("findings") or {}).get("dataset_used"),
                "contribution":(p.get("findings") or {}).get("contributions", "")[:200],
            })

        prompt = f"""You are a research trend analyst reviewing {len(papers)} academic papers.

Papers:
{json.dumps(paper_data, indent=2)}

Identify and report on research trends in Markdown:

## Common Models & Architectures
List the most frequently used models/architectures and their adoption trends.

## Common Datasets
List frequently used datasets and what they're used for.

## Emerging Trends
Identify 3-5 emerging research directions or trends visible across these papers.

## Timeline of Progress
How has the research evolved over the years covered?

## Dominant Themes
What are the 2-3 most dominant research themes?

Be analytical and insightful."""

        result = await ask_gemini(prompt, max_tokens=2048)
        logger.info(f"[TrendAgent] Generated trends for {len(papers)} papers")
        return result
