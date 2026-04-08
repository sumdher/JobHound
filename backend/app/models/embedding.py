"""
JobDescriptionEmbedding model - stores chunked job description text
with pgvector embeddings for RAG (Retrieval-Augmented Generation) queries.
Each application can have multiple chunks with separate embeddings.
"""

from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import settings
from app.database import Base


class JobDescriptionEmbedding(Base):
    """A single chunk of a job description with its vector embedding."""

    __tablename__ = "job_description_embeddings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    application_id: Mapped[str] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("applications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(
        Vector(settings.embedding_dimension), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    application: Mapped["Application"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Application", back_populates="embeddings"
    )

    def __repr__(self) -> str:
        return f"<JobDescriptionEmbedding app={self.application_id} chunk={self.chunk_index}>"
