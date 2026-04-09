"""
Chat API router with RAG-powered streaming responses.
Uses Server-Sent Events (SSE) to stream LLM tokens to the frontend.
All endpoints require JWT authentication.
"""

import asyncio
import json

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.chat import ChatMessage
from app.models.user import User
from app.services import rag
from app.services.llm.base import LLMConfig

router = APIRouter()
logger = structlog.get_logger(__name__)


class ChatRequest(BaseModel):
    """Chat message request with optional per-request LLM config."""

    message: str
    # Optional per-request provider overrides (stored in frontend localStorage)
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None


@router.post(
    "",
    summary="Send a chat message (SSE streaming)",
    description=(
        "Accepts a user message, runs the RAG pipeline, and streams "
        "the LLM response as Server-Sent Events. "
        "Format: `data: {\"token\": \"...\"}\\n\\n`, final event: `data: [DONE]\\n\\n`"
    ),
)
async def chat(
    body: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Stream chat response via SSE."""
    config: LLMConfig | None = None
    if body.provider or body.model or body.api_key:
        config = LLMConfig(
            provider=body.provider,
            model=body.model,
            api_key=body.api_key,
            base_url=body.base_url,
        )

    async def event_generator():
        # Send an immediate heartbeat so Cloudflare's 100s timeout starts fresh
        # once tokens begin flowing, not from when Ollama starts thinking.
        yield ": heartbeat\n\n"

        queue: asyncio.Queue[tuple[str, str | None]] = asyncio.Queue()

        async def _fill() -> None:
            try:
                async for token in rag.stream_chat(
                    message=body.message,
                    user_id=current_user.id,
                    db=db,
                    config=config,
                ):
                    await queue.put(("token", token))
            except Exception as e:
                logger.error("Chat stream error", error=str(e))
                await queue.put(("error", str(e)))
            finally:
                await queue.put(("done", None))

        task = asyncio.create_task(_fill())
        try:
            while True:
                try:
                    kind, value = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    # Keep Cloudflare alive while Ollama is still thinking
                    yield ": heartbeat\n\n"
                    continue

                if kind == "token":
                    yield f"data: {json.dumps({'token': value})}\n\n"
                elif kind == "error":
                    yield f"data: {json.dumps({'error': value})}\n\n"
                    break
                else:  # "done"
                    break
        finally:
            task.cancel()
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/history",
    summary="Get chat history",
    description="Returns the last 50 chat messages for the current user, oldest first.",
)
async def get_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Fetch chat message history for the current user."""
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(50)
    )
    messages = list(reversed(result.scalars().all()))
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "metadata": m.metadata_,
            "created_at": m.created_at.isoformat(),
        }
        for m in messages
    ]


@router.delete(
    "/history",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Clear chat history",
    description="Deletes all chat messages for the current user.",
)
async def clear_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete all chat messages for the current user."""
    await db.execute(
        delete(ChatMessage).where(ChatMessage.user_id == current_user.id)
    )
    await db.commit()
