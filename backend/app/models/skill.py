"""
Skill model - canonical, normalized skill names (e.g. "python", "docker").
Skills are shared across all users; linked to applications via ApplicationSkill.
"""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

SKILL_CATEGORIES = (
    "language",
    "framework",
    "tool",
    "cloud",
    "database",
    "soft_skill",
    "methodology",
    "other",
)


class Skill(Base):
    """Canonical skill entity. Names are stored in lowercase for deduplication."""

    __tablename__ = "skills"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    category: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Relationships
    application_skills: Mapped[list["ApplicationSkill"]] = relationship(  # type: ignore[name-defined]  # noqa: F821
        "ApplicationSkill", back_populates="skill", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Skill {self.name}>"
