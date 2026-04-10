"""
User model - represents an authenticated user (via Google OAuth).
One user can have many applications and chat messages.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

USER_STATUSES = ("pending", "approved", "rejected")

from app.database import Base


class User(Base):
    """Authenticated user created/updated on Google OAuth login."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="pending"
    )
    llm_settings: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    applications: Mapped[list["Application"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Application", back_populates="user", cascade="all, delete-orphan"
    )
    chat_messages: Mapped[list["ChatMessage"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ChatMessage", back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User {self.email}>"
