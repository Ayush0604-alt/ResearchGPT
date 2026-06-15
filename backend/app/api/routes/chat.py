"""
Chat Routes: /api/chat

Fix: delete route was missing `await db.commit()` — deletions were being
     rolled back by the session context manager's exception handler path,
     so clearing chat history appeared to work but messages reappeared on reload.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.db.session import get_db
from pydantic import BaseModel
from app.models.models import ChatMessage, Paper
from app.schemas.schemas import ChatHistoryOut
from app.core.security import get_current_user_id
from app.utils.gemini_client import ask_gemini

router = APIRouter()

class ChatQuery(BaseModel):
    project_id: int
    question: str


@router.get("/history/{project_id}", response_model=ChatHistoryOut)
async def get_chat_history(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.project_id == project_id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()
    return ChatHistoryOut(messages=list(messages), total=len(messages))


@router.delete("/history/{project_id}", status_code=204)
async def clear_chat_history(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    # FIX: use bulk DELETE instead of load-then-delete, and ensure commit runs.
    # The original code fetched all rows then called db.delete() per row but
    # never committed — get_db() only commits on the yield path when no
    # exception is raised, but 204 responses have no body so some ASGI paths
    # skipped the commit.
    await db.execute(
        delete(ChatMessage).where(ChatMessage.project_id == project_id)
    )
    # Explicit commit ensures the bulk delete is persisted regardless of
    # how the response is finalized.
    await db.commit()


@router.post("/query")
async def chat_query(
    body: ChatQuery,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    # Save user message
    user_msg = ChatMessage(
        project_id=body.project_id,
        role="user",
        content=body.question
    )
    db.add(user_msg)
    await db.commit()
    
    # Fetch papers for context
    result = await db.execute(
        select(Paper).where(Paper.project_id == body.project_id)
    )
    papers = result.scalars().all()
    
    context = ""
    for i, p in enumerate(papers[:15]):
        context += f"[{i+1}] {p.title} ({p.year})\nAbstract: {p.abstract}\n\n"
        
    prompt = f"""You are an expert AI research assistant. Answer the user's question based ONLY on the following paper abstracts. If the answer is not in the papers, say so.

Context Papers:
{context}

Question: {body.question}"""

    try:
        answer = await ask_gemini(prompt, max_tokens=2048)
    except Exception as e:
        answer = f"Sorry, I encountered an error: {e}"
        
    assistant_msg = ChatMessage(
        project_id=body.project_id,
        role="assistant",
        content=answer
    )
    db.add(assistant_msg)
    await db.commit()
    
    return {"answer": answer, "sources": []}