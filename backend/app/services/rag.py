"""
RAG (Retrieval-Augmented Generation) pipeline for the chat feature.
Combines vector similarity search on job description embeddings with
SQL keyword search on applications to build rich context for the LLM.
Streams response tokens via async generator for SSE delivery.
"""

import uuid
from collections.abc import AsyncGenerator
from datetime import date
from pathlib import Path

import structlog
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chat import ChatMessage
from app.services.embedding.factory import get_embedding_provider
from app.services.llm.base import LLMConfig, Message
from app.services.llm.factory import get_llm_provider

logger = structlog.get_logger(__name__)

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def _build_context(app_rows: list, chunk_rows: list) -> str:
    """Build a context string from retrieved applications and JD chunks."""
    parts: list[str] = [f"Today's date: {date.today().isoformat()}\n"]

    if app_rows:
        parts.append("## Relevant Job Applications\n")
        for row in app_rows:
            parts.append(
                f"- **{row['company']}** — {row['job_title']} "
                f"| Status: {row['status']} | Applied: {row['date_applied']} "
                f"| Source: {row.get('source') or 'unknown'} "
                f"| Location: {row.get('location') or 'N/A'} "
                f"| Work mode: {row.get('work_mode') or 'N/A'}"
            )
            if row.get("salary_min"):
                currency = row.get("salary_currency", "EUR")
                parts.append(
                    f"  Salary: {row['salary_min'] / 100:.0f}–{(row.get('salary_max') or row['salary_min']) / 100:.0f} {currency}/yr"
                )
            if row.get("notes"):
                parts.append(f"  Notes: {row['notes']}")
        parts.append("")

    if chunk_rows:
        parts.append("## Relevant Job Description Excerpts\n")
        for chunk in chunk_rows:
            parts.append(
                f"[{chunk['company']} - {chunk['job_title']}]\n{chunk['chunk_text']}\n"
            )

    return "\n".join(parts)


async def stream_chat(
    message: str,
    user_id: uuid.UUID,
    db: AsyncSession,
    config: LLMConfig | None = None,
) -> AsyncGenerator[str, None]:
    """
    Full RAG pipeline: embed query → vector search → SQL search → LLM stream.
    Yields string tokens for SSE delivery.
    """
    # 1. Embed user query (best-effort — fall back to SQL-only if embedding fails)
    chunk_rows: list[dict] = []
    try:
        embedding_provider = get_embedding_provider()
        query_embedding = await embedding_provider.embed(message)

        # Inline the embedding as a numeric literal — safe because it's generated
        # by our own embedding service (only floats), never user input.
        # This sidesteps SQLAlchemy text() confusing ::vector with a named param.
        embedding_literal = "[" + ",".join(str(x) for x in query_embedding) + "]"
        vector_sql = text(f"""
            SELECT
                jde.chunk_text,
                a.company,
                a.job_title,
                1 - (jde.embedding <=> '{embedding_literal}'::vector) AS similarity
            FROM job_description_embeddings jde
            JOIN applications a ON a.id = jde.application_id
            WHERE a.user_id = :user_id AND a.is_deleted = false
            ORDER BY jde.embedding <=> '{embedding_literal}'::vector
            LIMIT 5
        """)
        vec_result = await db.execute(vector_sql, {"user_id": str(user_id)})
        chunk_rows = [
            {"chunk_text": r[0], "company": r[1], "job_title": r[2], "similarity": r[3]}
            for r in vec_result.fetchall()
        ]
    except Exception as e:
        logger.warning("Vector search failed, using SQL-only", error=str(e))
        # Roll back the aborted transaction so subsequent queries can still run.
        await db.rollback()

    # 3. SQL keyword search on applications
    keywords = [w for w in message.split() if len(w) > 3]
    keyword_conditions = " OR ".join(
        [f"(a.company ILIKE :kw{i} OR a.job_title ILIKE :kw{i} OR a.notes ILIKE :kw{i})"
         for i in range(len(keywords[:5]))]
    ) or "true"

    params: dict = {"user_id": str(user_id)}
    for i, kw in enumerate(keywords[:5]):
        params[f"kw{i}"] = f"%{kw}%"

    app_sql = text(f"""
        SELECT
            a.company, a.job_title, a.status, a.date_applied,
            a.source, a.location, a.work_mode,
            a.salary_min, a.salary_max, a.salary_currency,
            a.notes
        FROM applications a
        WHERE a.user_id = :user_id AND a.is_deleted = false
          AND ({keyword_conditions})
        ORDER BY a.date_applied DESC
        LIMIT 10
    """)
    app_result = await db.execute(app_sql, params)
    cols = ["company", "job_title", "status", "date_applied", "source",
            "location", "work_mode", "salary_min", "salary_max", "salary_currency", "notes"]
    app_rows = [dict(zip(cols, row)) for row in app_result.fetchall()]

    # If no keyword matches, grab recent applications for context
    if not app_rows:
        recent_sql = text("""
            SELECT company, job_title, status, date_applied, source,
                   location, work_mode, salary_min, salary_max, salary_currency, notes
            FROM applications
            WHERE user_id = :user_id AND is_deleted = false
            ORDER BY date_applied DESC
            LIMIT 10
        """)
        recent_result = await db.execute(recent_sql, {"user_id": str(user_id)})
        app_rows = [dict(zip(cols, row)) for row in recent_result.fetchall()]

    # 4. Build context
    context = _build_context(app_rows, chunk_rows)

    # 5. Load recent chat history (last 10 messages)
    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
    )
    history = list(reversed(history_result.scalars().all()))

    # 6. Build message list
    system_prompt = (PROMPTS_DIR / "rag_system.txt").read_text().replace("{context}", context)
    messages: list[Message] = [Message(role="system", content=system_prompt)]

    for hist_msg in history:
        messages.append(Message(role=hist_msg.role, content=hist_msg.content))

    messages.append(Message(role="user", content=message))

    # 7. Save user message BEFORE streaming so it always gets an earlier
    #    created_at than the assistant message (same-tx timestamps cause
    #    non-deterministic ordering in history queries).
    user_msg = ChatMessage(user_id=user_id, role="user", content=message)
    db.add(user_msg)
    await db.commit()

    # 8. Stream from LLM
    provider = get_llm_provider(config)
    full_response = []

    async for token in provider.stream(messages, config):
        full_response.append(token)
        yield token

    # 9. Save assistant response
    assistant_msg = ChatMessage(
        user_id=user_id, role="assistant", content="".join(full_response)
    )
    db.add(assistant_msg)
    await db.commit()
