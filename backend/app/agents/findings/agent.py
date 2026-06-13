"""
Agent 5: Key Findings Agent
Extracts structured JSON findings: model, dataset, accuracy, contributions, limitations.
"""
import json
from typing import Dict, Any
from loguru import logger
from app.utils.gemini_client import ask_gemini


class KeyFindingsAgent:
    async def run(self, paper: Dict[str, Any]) -> Dict[str, Any]:
        title    = paper.get("title", "")
        abstract = paper.get("abstract", "") or ""
        summary  = paper.get("summary", "") or ""

        prompt = f"""You are a research data extractor. Extract structured information from this paper.

Title: {title}
Abstract: {abstract}
Summary: {summary}

Return ONLY a valid JSON object with these exact keys:
{{
  "model_used": "The ML/DL model or algorithm used (e.g., BERT, ResNet, Transformer, etc.)",
  "dataset_used": "The dataset(s) used for training/evaluation",
  "accuracy": "Key performance metric (e.g., 94.2% accuracy, F1=0.89, BLEU=45.2)",
  "contributions": "Main novel contributions of the paper (2-3 sentences)",
  "limitations": "Known limitations or future work mentioned (1-2 sentences)"
}}

If a field cannot be determined, use null.
Respond ONLY with the JSON object, no other text."""

        response = await ask_gemini(prompt)
        findings = self._safe_parse_json(response)

        return {
            **paper,
            "findings": findings,
        }

    def _safe_parse_json(self, text: str) -> Dict[str, Any]:
        try:
            # Strip markdown code blocks if present
            clean = text.strip()
            if clean.startswith("```"):
                clean = "\n".join(clean.split("\n")[1:])
            if clean.endswith("```"):
                clean = "\n".join(clean.split("\n")[:-1])
            return json.loads(clean.strip())
        except json.JSONDecodeError:
            logger.warning("[FindingsAgent] JSON parse failed, returning defaults")
            return {
                "model_used":    None,
                "dataset_used":  None,
                "accuracy":      None,
                "contributions": None,
                "limitations":   None,
            }
