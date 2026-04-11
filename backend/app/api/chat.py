"""
Chat API router with RAG-powered streaming responses and session management.
Uses Server-Sent Events (SSE) to stream LLM tokens to the frontend.
All endpoints require JWT authentication.
"""

from __future__ import annotations

import asyncio
import json
import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.chat import ChatMessage
from app.models.chat_session import ChatSession
from app.models.user import User
from app.services import rag
from app.services.llm.base import LLMConfig, Message
from app.services.llm.factory import get_llm_provider

router = APIRouter()
logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Context window registry
# ---------------------------------------------------------------------------

CONTEXT_WINDOWS: dict[str, int] = {
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
    "gpt-4-turbo": 128_000,
    "gpt-4": 8_192,
    "gpt-3.5-turbo": 16_385,
    "claude": 200_000,  # matches any claude-* model
    "llama3.1": 128_000,
    "llama3.2": 128_000,
    "llama3": 8_192,
    "gemma3": 128_000,
    "gemma2": 8_192,
    "gemma": 8_192,
    "mistral": 32_768,
    "phi3": 128_000,
    "qwen2.5": 128_000,
}
DEFAULT_CONTEXT = 8_192


def get_max_tokens(model: str | None) -> int:
    if not model:
        return DEFAULT_CONTEXT
    ml = model.lower()
    for key, size in CONTEXT_WINDOWS.items():
        if key in ml:
            return size
    return DEFAULT_CONTEXT


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _title_from_message(msg: str) -> str:
    msg = " ".join(msg.strip().split())
    for prefix in ("**", "*", "#", "-", "•"):
        if msg.startswith(prefix):
            msg = msg.lstrip("*#-• ").strip()
    for label in ("job title:", "title:", "role:", "position:"):
        if msg.lower().startswith(label):
            msg = msg[len(label):].strip()
    if len(msg) <= 60:
        return msg
    truncated = msg[:60]
    last_space = truncated.rfind(" ")
    return (truncated[:last_space] if last_space > 20 else truncated) + "\u2026"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    provider: str | None = None
    model: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    history: list["HistoryMessageIn"] | None = None
    persist_user_message: bool = True
    user_message_metadata: dict | None = None
    assistant_message_metadata: dict | None = None


class HistoryMessageIn(BaseModel):
    role: str
    content: str


class SessionOut(BaseModel):
    id: str
    title: str
    token_count: int
    max_tokens: int
    created_at: str
    updated_at: str
    message_count: int


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    created_at: str
    metadata: dict | None = None


class RenameRequest(BaseModel):
    title: str


# ---------------------------------------------------------------------------
# Session CRUD
# ---------------------------------------------------------------------------


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SessionOut]:
    result = await db.execute(
        select(
            ChatSession,
            func.count(ChatMessage.id).label("message_count"),
        )
        .outerjoin(ChatMessage, ChatMessage.session_id == ChatSession.id)
        .where(ChatSession.user_id == current_user.id)
        .group_by(ChatSession.id)
        .order_by(ChatSession.updated_at.desc())
    )
    rows = result.all()
    return [
        SessionOut(
            id=str(session.id),
            title=session.title,
            token_count=session.token_count,
            max_tokens=DEFAULT_CONTEXT,
            created_at=session.created_at.isoformat(),
            updated_at=session.updated_at.isoformat(),
            message_count=count,
        )
        for session, count in rows
    ]


@router.post("/sessions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    session = await _get_or_create_empty_session(current_user.id, db)
    count_result = await db.execute(
        select(func.count(ChatMessage.id)).where(ChatMessage.session_id == session.id)
    )
    message_count = count_result.scalar_one()
    return SessionOut(
        id=str(session.id),
        title=session.title,
        token_count=session.token_count,
        max_tokens=DEFAULT_CONTEXT,
        created_at=session.created_at.isoformat(),
        updated_at=session.updated_at.isoformat(),
        message_count=message_count,
    )


@router.patch("/sessions/{session_id}", response_model=SessionOut)
async def rename_session(
    session_id: str,
    body: RenameRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionOut:
    session = await _get_session(session_id, current_user.id, db)
    session.title = body.title.strip() or "New Chat"
    await db.commit()
    await db.refresh(session)
    count_result = await db.execute(
        select(func.count(ChatMessage.id)).where(ChatMessage.session_id == session.id)
    )
    message_count = count_result.scalar_one()
    return SessionOut(
        id=str(session.id),
        title=session.title,
        token_count=session.token_count,
        max_tokens=DEFAULT_CONTEXT,
        created_at=session.created_at.isoformat(),
        updated_at=session.updated_at.isoformat(),
        message_count=message_count,
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    session = await _get_session(session_id, current_user.id, db)
    await db.delete(session)
    await db.commit()


@router.get("/sessions/{session_id}/history", response_model=list[MessageOut])
async def get_session_history(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    session = await _get_session(session_id, current_user.id, db)
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc())
    )
    messages = result.scalars().all()
    return [
        MessageOut(
            id=m.id,
            role=m.role,
            content=m.content,
            created_at=m.created_at.isoformat(),
            metadata=m.metadata_,
        )
        for m in messages
    ]


@router.delete("/sessions/{session_id}/history", status_code=status.HTTP_204_NO_CONTENT)
async def clear_session_history(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    session = await _get_session(session_id, current_user.id, db)
    await db.execute(delete(ChatMessage).where(ChatMessage.session_id == session.id))
    session.token_count = 0
    await db.commit()


@router.post("/sessions/{session_id}/summarize")
async def summarize_session(
    session_id: str,
    body: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    session = await _get_session(session_id, current_user.id, db)

    config: LLMConfig | None = None
    if body.provider or body.model or body.api_key:
        config = LLMConfig(
            provider=body.provider,
            model=body.model,
            api_key=body.api_key,
            base_url=body.base_url if body.provider != "ollama" else None,
        )

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at.asc())
    )
    history = result.scalars().all()

    if body.history:
        conversation = "\n".join(f"{m.role.upper()}: {m.content}" for m in body.history)
    else:
        conversation = "\n".join(f"{m.role.upper()}: {m.content}" for m in history)

    messages: list[Message] = [
        Message(
            role="system",
            content="You are a helpful assistant. Summarize the following conversation concisely.",
        ),
        Message(
            role="user",
            content=f"Summarize this conversation:\n\n{conversation}",
        ),
    ]

    async def event_generator():
        yield ": heartbeat\n\n"
        queue: asyncio.Queue[tuple[str, str | None]] = asyncio.Queue()
        summary_parts: list[str] = []

        async def _fill() -> None:
            try:
                provider = get_llm_provider(config)
                async for token in provider.stream(messages, config):
                    summary_parts.append(token)
                    await queue.put(("token", token))
            except Exception as e:
                logger.error("Summarize stream error", error=str(e))
                await queue.put(("error", str(e)))
            finally:
                await queue.put(("done", None))

        task = asyncio.create_task(_fill())
        try:
            while True:
                try:
                    kind, value = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue

                if kind == "token":
                    yield f"data: {json.dumps({'token': value})}\n\n"
                elif kind == "error":
                    yield f"data: {json.dumps({'error': value})}\n\n"
                    break
                else:
                    break
        finally:
            task.cancel()

        summary = "".join(summary_parts)
        if summary:
            await db.execute(delete(ChatMessage).where(ChatMessage.session_id == session.id))
            summary_msg = ChatMessage(
                user_id=current_user.id,
                role="assistant",
                content=summary,
                session_id=session.id,
            )
            db.add(summary_msg)
            session.token_count = estimate_tokens(summary)
            await db.commit()
            await db.refresh(session)

        yield f"data: {json.dumps({'meta': {'session_id': str(session.id), 'token_count': session.token_count}})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Main chat endpoint
# ---------------------------------------------------------------------------


@router.post("")
async def chat(
    body: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    config: LLMConfig | None = None
    if body.provider or body.model or body.api_key:
        config = LLMConfig(
            provider=body.provider,
            model=body.model,
            api_key=body.api_key,
            base_url=body.base_url if body.provider != "ollama" else None,
        )

    # Resolve session
    is_new_session = False
    if body.session_id is None:
        session = ChatSession(user_id=current_user.id, title="New Chat")
        db.add(session)
        await db.commit()
        await db.refresh(session)
        is_new_session = True
    else:
        try:
            sid = uuid.UUID(body.session_id)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid session_id format.")
        result = await db.execute(
            select(ChatSession).where(
                ChatSession.id == sid,
                ChatSession.user_id == current_user.id,
            )
        )
        session = result.scalar_one_or_none()
        if session is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    # Check if this is the first message in the session (for auto-title)
    count_result = await db.execute(
        select(func.count(ChatMessage.id)).where(ChatMessage.session_id == session.id)
    )
    message_count_before = count_result.scalar_one()
    first_message = message_count_before == 0

    session_id = session.id

    async def event_generator():
        yield ": heartbeat\n\n"
        queue: asyncio.Queue[tuple[str, str | None]] = asyncio.Queue()

        async def _fill() -> None:
            try:
                async for token in rag.stream_chat(
                    message=body.message,
                    user_id=current_user.id,
                    db=db,
                    config=config,
                    session_id=session_id,
                    history_override=[
                        Message(role=msg.role, content=msg.content) for msg in body.history or []
                    ] or None,
                    persist_user_message=body.persist_user_message,
                    user_message_metadata=body.user_message_metadata,
                    assistant_message_metadata=body.assistant_message_metadata,
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
                    yield ": heartbeat\n\n"
                    continue

                if kind == "token":
                    yield f"data: {json.dumps({'token': value})}\n\n"
                elif kind == "error":
                    yield f"data: {json.dumps({'error': value})}\n\n"
                    break
                else:
                    break
        finally:
            task.cancel()

        # Auto-title on first message
        if first_message or is_new_session:
            result2 = await db.execute(
                select(ChatSession).where(ChatSession.id == session_id)
            )
            sess = result2.scalar_one_or_none()
            if sess is not None:
                sess.title = _title_from_message(body.message)
                await db.commit()
                await db.refresh(sess)
                token_count = sess.token_count
            else:
                token_count = 0
        else:
            result2 = await db.execute(
                select(ChatSession).where(ChatSession.id == session_id)
            )
            sess = result2.scalar_one_or_none()
            token_count = sess.token_count if sess else 0

        yield f"data: {json.dumps({'meta': {'session_id': str(session_id), 'token_count': token_count}})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Legacy history endpoints (backward compat)
# ---------------------------------------------------------------------------


@router.get("/history")
async def get_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
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


@router.delete("/history", status_code=status.HTTP_204_NO_CONTENT)
async def clear_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await db.execute(delete(ChatMessage).where(ChatMessage.user_id == current_user.id))
    await db.commit()


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


async def _get_session(
    session_id: str,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> ChatSession:
    try:
        sid = uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid session_id format.")
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == sid,
            ChatSession.user_id == user_id,
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    return session


async def _get_or_create_empty_session(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> ChatSession:
    result = await db.execute(
        select(ChatSession)
        .outerjoin(ChatMessage, ChatMessage.session_id == ChatSession.id)
        .where(ChatSession.user_id == user_id)
        .group_by(ChatSession.id)
        .having(func.count(ChatMessage.id) == 0)
        .order_by(ChatSession.updated_at.desc())
        .limit(1)
    )
    session = result.scalar_one_or_none()
    if session is not None:
        return session

    session = ChatSession(user_id=user_id, title="New Chat")
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session
