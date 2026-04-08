"""
Embedding generation service for job description chunks.
Splits job descriptions into overlapping chunks, embeds each chunk,
and stores them in the job_description_embeddings table.
Used by the applications API and the RAG pipeline.
"""

import uuid

import structlog
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.embedding import JobDescriptionEmbedding
from app.services.embedding.factory import get_embedding_provider

logger = structlog.get_logger(__name__)

# Approximate token sizes for chunking
CHUNK_SIZE = 500     # target tokens per chunk (approx chars / 4)
CHUNK_OVERLAP = 50   # overlap tokens between chunks


def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """
    Split text into overlapping chunks by word count.
    Approximately 1 token ≈ 4 characters, so chunk_size=500 ≈ 2000 chars.
    """
    words = text.split()
    chunks: list[str] = []

    i = 0
    while i < len(words):
        chunk_words = words[i : i + chunk_size]
        chunks.append(" ".join(chunk_words))
        if i + chunk_size >= len(words):
            break
        i += chunk_size - overlap

    return [c for c in chunks if c.strip()]


async def generate_embedding(
    db: AsyncSession,
    application_id: uuid.UUID,
    text: str,
) -> None:
    """
    Chunk the text, embed each chunk, and store in the DB.
    Replaces any existing embeddings for this application.
    Non-fatal: caller should catch exceptions.
    """
    if not text or not text.strip():
        return

    # Remove existing embeddings for this application
    await db.execute(
        delete(JobDescriptionEmbedding).where(
            JobDescriptionEmbedding.application_id == application_id
        )
    )

    chunks = _chunk_text(text)
    if not chunks:
        return

    provider = get_embedding_provider()

    try:
        embeddings = await provider.embed_batch(chunks)
    except Exception as e:
        logger.error("Embedding batch failed", error=str(e), application_id=str(application_id))
        raise

    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        db.add(
            JobDescriptionEmbedding(
                application_id=application_id,
                chunk_index=i,
                chunk_text=chunk,
                embedding=embedding,
            )
        )

    logger.info(
        "Embeddings stored",
        application_id=str(application_id),
        chunks=len(chunks),
    )
