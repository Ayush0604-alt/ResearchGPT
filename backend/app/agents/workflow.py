"""
LangGraph Workflow Orchestrator — Simplified Batch Processing Pipeline.

Fix: Replaced multi-node LLM calls with a single ComprehensiveAnalysisAgent
     to reduce API costs and avoid rate limits. Handles 429 ResourceExhausted gracefully.
"""
import asyncio
from typing import List, Dict, Any, TypedDict, Optional

from langgraph.graph import StateGraph, END
from loguru import logger

from app.agents.search.agent         import PaperSearchAgent
from app.agents.collection.agent     import PaperCollectionAgent
from app.agents.comprehensive.agent  import ComprehensiveAnalysisAgent

from app.utils.gemini_client         import RateLimitError

# ── Graph State ────────────────────────────────────────────────────────────────

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


# ── Helper to push progress to the task store ──────────────────────────────────

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


# ── Node Implementations ───────────────────────────────────────────────────────

async def node_paper_search(state: ResearchState) -> dict:
    _update_progress(state, "Paper Search", 5)
    logger.info("[Workflow] Paper Search")
    try:
        agent  = PaperSearchAgent()
        papers = await agent.run(state["topic"], state["max_papers"])
    except Exception as e:
        logger.error(f"[Workflow] Paper Search failed: {e}")
        papers = []
    prog = _update_progress(state, "Paper Search", 20)
    return {**prog, "papers": papers}


async def node_paper_collection(state: ResearchState) -> dict:
    _update_progress(state, "Paper Collection", 25)
    logger.info("[Workflow] Paper Collection")
    agent   = PaperCollectionAgent()
    updated = []
    for paper in state["papers"]:
        try:
            result = await agent.run(paper, state["project_id"])
            updated.append(result)
        except Exception as e:
            logger.warning(f"[Workflow] Collection failed for '{paper.get('title','')[:40]}': {e}")
            updated.append(paper)
    prog = _update_progress(state, "Paper Collection", 40)
    return {**prog, "papers": updated}


async def node_comprehensive_analysis(state: ResearchState) -> dict:
    _update_progress(state, "Comprehensive Analysis", 45)
    logger.info("[Workflow] Comprehensive Analysis (Batch LLM Call)")
    agent = ComprehensiveAnalysisAgent()
    try:
        result = await agent.run(state["papers"], state["topic"])
    except RateLimitError as e:
        logger.error(f"[Workflow] Halting pipeline due to RateLimitError: {e}")
        raise e  # Let it bubble up to fail the task immediately
    except Exception as e:
        logger.error(f"[Workflow] Halting pipeline due to API Error: {e}")
        raise e
    
    prog = _update_progress(state, "Comprehensive Analysis", 80)
    return {
        **prog, 
        "comparison": result.get("comparison", ""),
        "trends": result.get("trends", ""),
        "gaps": result.get("gaps", ""),
        "literature_review": result.get("literature_review", {})
    }





# ── Build Graph ────────────────────────────────────────────────────────────────

def build_research_graph():
    graph = StateGraph(ResearchState)

    graph.add_node("step_paper_search",          node_paper_search)
    graph.add_node("step_paper_collection",      node_paper_collection)
    graph.add_node("step_comprehensive_analysis", node_comprehensive_analysis)
    graph.set_entry_point("step_paper_search")
    graph.add_edge("step_paper_search",          "step_paper_collection")
    graph.add_edge("step_paper_collection",      "step_comprehensive_analysis")
    graph.add_edge("step_comprehensive_analysis", END)

    return graph.compile()


# ── Public Runner ──────────────────────────────────────────────────────────────

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