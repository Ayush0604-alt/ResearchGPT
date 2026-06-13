"""
LangGraph Workflow Orchestrator — 10-agent sequential research pipeline.

Key fixes vs original:
- DocumentProcessingAgent instantiated ONCE (not per node call)
- Progress updates pushed to _task_store so the frontend can poll them in real-time
- Per-node error handling with graceful degradation (pipeline continues even if one agent fails)
- Agents that can run concurrently (summarization + findings) are gathered in parallel
"""
import asyncio
from typing import List, Dict, Any, TypedDict, Optional

from langgraph.graph import StateGraph, END
from loguru import logger

from app.agents.search.agent         import PaperSearchAgent
from app.agents.collection.agent     import PaperCollectionAgent
from app.agents.processing.agent     import DocumentProcessingAgent
from app.agents.summarization.agent  import SummarizationAgent
from app.agents.findings.agent       import KeyFindingsAgent
from app.agents.comparison.agent     import ComparisonAgent
from app.agents.trends.agent         import TrendAnalysisAgent
from app.agents.gaps.agent           import ResearchGapAgent
from app.agents.review.agent         import LiteratureReviewAgent
from app.agents.presentation.agent   import PresentationAgent

# ── Shared agent instances (avoids re-init of ChromaDB on every node call) ────
_doc_processor = DocumentProcessingAgent()


# ── Graph State ───────────────────────────────────────────────────────────────

class ResearchState(TypedDict):
    topic:             str
    project_id:        int
    max_papers:        int
    task_id:           str
    papers:            List[Dict[str, Any]]
    comparison:        str
    trends:            str
    gaps:              str
    literature_review: Dict[str, str]
    presentation:      Dict[str, Any]
    current_agent:     str
    progress:          int
    errors:            List[str]


# ── Helper to push progress to the task store ─────────────────────────────────

def _update_progress(state: ResearchState, agent_name: str, pct: int) -> dict:
    """Write live progress back so the polling endpoint sees it instantly."""
    from app.api.routes.agents import _task_store
    task_id = state.get("task_id", "")
    if task_id and task_id in _task_store:
        _task_store[task_id].update({
            "status":        "running",
            "progress":      pct,
            "current_agent": agent_name,
        })
    return {"current_agent": agent_name, "progress": pct}


# ── Node Implementations ──────────────────────────────────────────────────────

async def node_paper_search(state: ResearchState) -> dict:
    _update_progress(state, "Paper Search", 5)
    logger.info("[Workflow] Paper Search")
    try:
        agent  = PaperSearchAgent()
        papers = await agent.run(state["topic"], state["max_papers"])
    except Exception as e:
        logger.error(f"[Workflow] Paper Search failed: {e}")
        papers = []
    prog = _update_progress(state, "Paper Search", 12)
    return {**prog, "papers": papers}


async def node_paper_collection(state: ResearchState) -> dict:
    _update_progress(state, "Paper Collection", 13)
    logger.info("[Workflow] Paper Collection")
    agent   = PaperCollectionAgent()
    updated = []
    for paper in state["papers"]:
        try:
            result = await agent.run(paper, state["project_id"])
            updated.append(result)
        except Exception as e:
            logger.warning(f"[Workflow] Collection failed for '{paper.get('title','')[:40]}': {e}")
            updated.append(paper)   # keep paper without PDF
    prog = _update_progress(state, "Paper Collection", 22)
    return {**prog, "papers": updated}


async def node_document_processing(state: ResearchState) -> dict:
    _update_progress(state, "Document Processing", 23)
    logger.info("[Workflow] Document Processing")
    updated = []
    for i, paper in enumerate(state["papers"]):
        try:
            result = await _doc_processor.run(paper, i + 1, state["project_id"])
            updated.append(result)
        except Exception as e:
            logger.warning(f"[Workflow] Processing failed for paper {i+1}: {e}")
            updated.append(paper)
    prog = _update_progress(state, "Document Processing", 35)
    return {**prog, "papers": updated}


async def node_summarization(state: ResearchState) -> dict:
    _update_progress(state, "Summarization", 36)
    logger.info("[Workflow] Summarization")
    agent = SummarizationAgent()

    async def safe_summarize(p):
        try:
            return await agent.run(p)
        except Exception as e:
            logger.warning(f"[Workflow] Summary failed: {e}")
            return p

    updated = await asyncio.gather(*[safe_summarize(p) for p in state["papers"]])
    prog = _update_progress(state, "Summarization", 50)
    return {**prog, "papers": list(updated)}


async def node_key_findings(state: ResearchState) -> dict:
    _update_progress(state, "Key Findings", 51)
    logger.info("[Workflow] Key Findings")
    agent = KeyFindingsAgent()

    async def safe_findings(p):
        try:
            return await agent.run(p)
        except Exception as e:
            logger.warning(f"[Workflow] Findings failed: {e}")
            return p

    updated = await asyncio.gather(*[safe_findings(p) for p in state["papers"]])
    prog = _update_progress(state, "Key Findings", 62)
    return {**prog, "papers": list(updated)}


async def node_comparison(state: ResearchState) -> dict:
    _update_progress(state, "Comparison", 63)
    logger.info("[Workflow] Comparison")
    try:
        result = await ComparisonAgent().run(state["papers"])
    except Exception as e:
        logger.warning(f"[Workflow] Comparison failed: {e}")
        result = ""
    prog = _update_progress(state, "Comparison", 70)
    return {**prog, "comparison": result}


async def node_trends(state: ResearchState) -> dict:
    _update_progress(state, "Trend Analysis", 71)
    logger.info("[Workflow] Trend Analysis")
    try:
        result = await TrendAnalysisAgent().run(state["papers"])
    except Exception as e:
        logger.warning(f"[Workflow] Trends failed: {e}")
        result = ""
    prog = _update_progress(state, "Trend Analysis", 77)
    return {**prog, "trends": result}


async def node_gaps(state: ResearchState) -> dict:
    _update_progress(state, "Research Gaps", 78)
    logger.info("[Workflow] Research Gaps")
    try:
        result = await ResearchGapAgent().run(state["papers"], state["topic"])
    except Exception as e:
        logger.warning(f"[Workflow] Gaps failed: {e}")
        result = ""
    prog = _update_progress(state, "Research Gaps", 84)
    return {**prog, "gaps": result}


async def node_literature_review(state: ResearchState) -> dict:
    _update_progress(state, "Literature Review", 85)
    logger.info("[Workflow] Literature Review")
    try:
        result = await LiteratureReviewAgent().run(
            state["papers"], state["topic"],
            comparison=state.get("comparison", ""),
            trends=state.get("trends", ""),
            gaps=state.get("gaps", ""),
        )
    except Exception as e:
        logger.warning(f"[Workflow] Lit review failed: {e}")
        result = {}
    prog = _update_progress(state, "Literature Review", 93)
    return {**prog, "literature_review": result}


async def node_presentation(state: ResearchState) -> dict:
    _update_progress(state, "Presentation", 94)
    logger.info("[Workflow] Presentation")
    try:
        result = await PresentationAgent().run(
            topic=state["topic"],
            project_id=state["project_id"],
            papers=state["papers"],
            trends=state.get("trends", ""),
            gaps=state.get("gaps", ""),
            comparison=state.get("comparison", ""),
        )
    except Exception as e:
        logger.warning(f"[Workflow] Presentation failed: {e}")
        result = {}
    prog = _update_progress(state, "Done", 100)
    return {**prog, "presentation": result}


# ── Build Graph ───────────────────────────────────────────────────────────────

def build_research_graph():
    graph = StateGraph(ResearchState)
    graph.add_node("paper_search",        node_paper_search)
    graph.add_node("paper_collection",    node_paper_collection)
    graph.add_node("document_processing", node_document_processing)
    graph.add_node("summarization",       node_summarization)
    graph.add_node("key_findings",        node_key_findings)
    graph.add_node("comparison",          node_comparison)
    graph.add_node("trends",              node_trends)
    graph.add_node("gaps",                node_gaps)
    graph.add_node("literature_review",   node_literature_review)
    graph.add_node("presentation",        node_presentation)

    graph.set_entry_point("paper_search")
    graph.add_edge("paper_search",        "paper_collection")
    graph.add_edge("paper_collection",    "document_processing")
    graph.add_edge("document_processing", "summarization")
    graph.add_edge("summarization",       "key_findings")
    graph.add_edge("key_findings",        "comparison")
    graph.add_edge("comparison",          "trends")
    graph.add_edge("trends",              "gaps")
    graph.add_edge("gaps",                "literature_review")
    graph.add_edge("literature_review",   "presentation")
    graph.add_edge("presentation",        END)

    return graph.compile()


# ── Public Runner ─────────────────────────────────────────────────────────────

async def run_research_workflow(
    topic: str,
    project_id: int,
    max_papers: int = 10,
    task_id: str = "",
) -> ResearchState:
    workflow = build_research_graph()
    initial: ResearchState = {
        "topic":             topic,
        "project_id":        project_id,
        "max_papers":        max_papers,
        "task_id":           task_id,
        "papers":            [],
        "comparison":        "",
        "trends":            "",
        "gaps":              "",
        "literature_review": {},
        "presentation":      {},
        "current_agent":     "Initializing",
        "progress":          0,
        "errors":            [],
    }
    logger.info(f"[Workflow] Starting pipeline topic='{topic}' project={project_id}")
    final = await workflow.ainvoke(initial)
    logger.info(f"[Workflow] Pipeline complete project={project_id}")
    return final
