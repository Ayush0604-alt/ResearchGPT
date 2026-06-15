import json
from typing import List, Dict, Any
from loguru import logger
from pydantic import BaseModel

from app.utils.gemini_client import ask_gemini

class LiteratureReviewSchema(BaseModel):
    introduction: str
    body: str
    discussion: str
    conclusion: str

class ComprehensiveAnalysisSchema(BaseModel):
    comparison: str
    trends: str
    gaps: str
    literature_review: LiteratureReviewSchema

class ComprehensiveAnalysisAgent:
    """
    Performs comparison, trend analysis, gap identification, 
    and literature review generation in a single LLM call.
    """

    async def run(self, papers: List[Dict[str, Any]], topic: str) -> Dict[str, Any]:
        logger.info(f"[ComprehensiveAnalysis] Analyzing {len(papers)} papers in a single batch.")
        
        if not papers:
            logger.warning("[ComprehensiveAnalysis] No papers to analyze.")
            return {
                "comparison": "",
                "trends": "",
                "gaps": "",
                "literature_review": {}
            }

        # Build paper list text using titles, authors, years, and abstracts
        papers_text = ""
        for i, p in enumerate(papers[:10]):  # Limit to max 10 to fit in prompt
            title = p.get('title', 'Unknown Title')
            year = p.get('year', 'Unknown Year')
            authors = ", ".join(p.get('authors', [])) if isinstance(p.get('authors'), list) else p.get('authors', 'Unknown')
            abstract = p.get('abstract', 'No abstract available.')
            papers_text += f"[{i+1}] {title} ({year}) by {authors}\nAbstract: {abstract}\n\n"

        prompt = f"""You are an expert AI research assistant. Your task is to perform a comprehensive analysis of the following research papers regarding the topic: "{topic}".

Here are the abstracts of the collected papers:
{papers_text}

Based ONLY on the provided papers, generate a comprehensive analysis and return the result.
Ensure all strings are properly escaped.
"""

        try:
            response = await ask_gemini(prompt, max_tokens=8000, response_schema=ComprehensiveAnalysisSchema)
            clean_response = response.strip()
            
            # Robust JSON extraction
            start_idx = clean_response.find('{')
            end_idx = clean_response.rfind('}')
            if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                clean_response = clean_response[start_idx:end_idx+1]
            else:
                logger.warning("[ComprehensiveAnalysis] Response did not contain valid JSON block.")

            result = json.loads(clean_response)
            logger.info("[ComprehensiveAnalysis] Successfully generated comprehensive analysis.")
            return result
            
        except Exception as e:
            logger.error(f"[ComprehensiveAnalysis] Error generating analysis: {e}")
            # If it's a RateLimitError, we let it bubble up so the workflow halts
            if type(e).__name__ == "RateLimitError":
                raise e
                
            # For other JSON parse errors or generic errors, return empty skeleton
            return {
                "comparison": "",
                "trends": "",
                "gaps": "",
                "literature_review": {}
            }
