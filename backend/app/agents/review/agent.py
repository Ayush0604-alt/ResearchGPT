"""
Agent 9: Literature Review Agent
Generates a full Markdown literature survey with introduction, body, discussion, conclusion.
"""
import json
from typing import List, Dict, Any
from loguru import logger
from app.utils.gemini_client import ask_gemini


class LiteratureReviewAgent:
    async def run(
        self,
        papers: List[Dict[str, Any]],
        topic: str,
        comparison: str = "",
        trends: str = "",
        gaps: str = "",
    ) -> Dict[str, str]:
        """
        Returns dict with keys: introduction, body, discussion, conclusion, full_review
        """
        paper_summaries = []
        for p in papers:
            paper_summaries.append(
                f"- **{p.get('title', 'Unknown')}** ({p.get('year', 'n/a')}) "
                f"by {', '.join(p.get('authors', [])[:2] or ['Unknown'])}. "
                f"{p.get('summary', '')[:300]}"
            )

        papers_text = "\n".join(paper_summaries)

        # ── Introduction ──
        intro_prompt = f"""Write an academic Introduction section for a literature review on "{topic}".

Include:
- Background and motivation for the topic
- Importance and relevance of the research area
- Scope of this review
- Organization of the review

Papers reviewed:
{papers_text[:2000]}

Write 3-4 paragraphs in formal academic style."""

        introduction = await ask_gemini(intro_prompt, max_tokens=1500)

        # ── Body ──
        body_prompt = f"""Write the main Body/Survey section of a literature review on "{topic}".

Papers reviewed:
{papers_text}

Trends analysis:
{trends[:1000] if trends else "Not available"}

Organize by themes or chronological progression. Include:
- Categorization of papers into themes/approaches
- Discussion of key works in each category
- How different approaches relate to each other
- Critical analysis of methods and results

Write 5-7 paragraphs in formal academic style with paper citations in brackets."""

        body = await ask_gemini(body_prompt, max_tokens=3000)

        # ── Discussion ──
        discussion_prompt = f"""Write a Discussion section for a literature review on "{topic}".

Comparison findings:
{comparison[:1000] if comparison else "Not available"}

Research gaps:
{gaps[:1000] if gaps else "Not available"}

Include:
- Synthesis of key findings
- Critical evaluation of current approaches
- Discussion of controversies or disagreements
- Implications for practice and research

Write 3-4 paragraphs in formal academic style."""

        discussion = await ask_gemini(discussion_prompt, max_tokens=1500)

        # ── Conclusion ──
        conclusion_prompt = f"""Write a Conclusion section for a literature review on "{topic}".

Summarize:
- Key findings from the reviewed papers
- Main trends identified
- Most significant research gaps
- Recommendations for future research
- Final remarks on the state of the field

Write 2-3 paragraphs in formal academic style."""

        conclusion = await ask_gemini(conclusion_prompt, max_tokens=1000)

        # ── Assemble full review ──
        full_review = f"""# Literature Review: {topic}

---

## 1. Introduction

{introduction}

---

## 2. Literature Survey

{body}

---

## 3. Discussion

{discussion}

---

## 4. Trends in the Field

{trends if trends else "_Trend analysis not available._"}

---

## 5. Research Gaps and Future Directions

{gaps if gaps else "_Gap analysis not available._"}

---

## 6. Conclusion

{conclusion}

---

## References

{self._format_references(papers)}
"""

        logger.info(f"[LitReviewAgent] Generated literature review for '{topic}'")
        return {
            "introduction": introduction,
            "body":         body,
            "discussion":   discussion,
            "conclusion":   conclusion,
            "full_review":  full_review,
        }

    def _format_references(self, papers: List[Dict]) -> str:
        refs = []
        for i, p in enumerate(papers, 1):
            authors = ", ".join((p.get("authors") or ["Unknown"])[:3])
            year    = p.get("year", "n.d.")
            title   = p.get("title", "Unknown Title")
            url     = p.get("url", "")
            refs.append(f"[{i}] {authors} ({year}). *{title}*. {url}")
        return "\n\n".join(refs)
