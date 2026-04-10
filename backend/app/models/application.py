"""
Application, ApplicationSkill, and StatusHistory models.
An Application tracks one job application with all associated metadata.
StatusHistory records every status transition for audit/timeline purposes.
ApplicationSkill is the many-to-many join between Application and Skill.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

VALID_STATUSES = (
    "applied",
    "screening",
    "interview_scheduled",
    "interviewing",
    "offer",
    "rejected",
    "ghosted",
    "withdrawn",
)

VALID_WORK_MODES = ("remote", "hybrid", "onsite")

VALID_SOURCES = (
    "linkedin",
    "indeed",
    "company_site",
    "referral",
    "glassdoor",
    "other",
)


class Application(Base):
    """A single job application with full metadata."""

    __tablename__ = "applications"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Core fields
    company: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    job_title: Mapped[str] = mapped_column(String(255), nullable=False)
    date_applied: Mapped[date] = mapped_column(Date, nullable=False, server_default=func.current_date())
    source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="applied", index=True)
    status_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Location / mode
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    work_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Details
    whats_in_it_for_me: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Salary
    salary_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    salary_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    salary_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    salary_period: Mapped[str] = mapped_column(String(20), nullable=False, default="yearly")

    # Links
    cv_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    cl_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    job_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Notes + audit
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_input: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Soft delete flag
    is_deleted: Mapped[bool] = mapped_column(nullable=False, default=False, index=True)

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
    user: Mapped["User"] = relationship("User", back_populates="applications")  # type: ignore[name-defined]  # noqa: F821
    application_skills: Mapped[list["ApplicationSkill"]] = relationship(
        "ApplicationSkill", back_populates="application", cascade="all, delete-orphan"
    )
    status_history: Mapped[list["StatusHistory"]] = relationship(
        "StatusHistory", back_populates="application", cascade="all, delete-orphan",
        order_by="StatusHistory.changed_at"
    )
    embeddings: Mapped[list["JobDescriptionEmbedding"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "JobDescriptionEmbedding", back_populates="application", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Application {self.company} - {self.job_title}>"


class ApplicationSkill(Base):
    """Many-to-many join between Application and Skill."""

    __tablename__ = "application_skills"
    __table_args__ = (
        UniqueConstraint("application_id", "skill_id", name="uq_application_skill"),
    )

    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("applications.id", ondelete="CASCADE"),
        primary_key=True,
    )
    skill_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("skills.id", ondelete="CASCADE"),
        primary_key=True,
    )

    application: Mapped["Application"] = relationship(
        "Application", back_populates="application_skills"
    )
    skill: Mapped["Skill"] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "Skill", back_populates="application_skills"
    )


class StatusHistory(Base):
    """Immutable record of every application status transition."""

    __tablename__ = "status_history"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("applications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    to_status: Mapped[str] = mapped_column(String(50), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    application: Mapped["Application"] = relationship(
        "Application", back_populates="status_history"
    )

    def __repr__(self) -> str:
        return f"<StatusHistory {self.from_status} → {self.to_status}>"
