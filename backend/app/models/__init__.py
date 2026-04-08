"""
SQLAlchemy ORM models package.
Exports all models so Alembic can detect them for migrations.
"""

from app.models.application import Application, ApplicationSkill, StatusHistory
from app.models.chat import ChatMessage
from app.models.embedding import JobDescriptionEmbedding
from app.models.skill import Skill
from app.models.user import User

__all__ = [
    "User",
    "Application",
    "Skill",
    "ApplicationSkill",
    "StatusHistory",
    "JobDescriptionEmbedding",
    "ChatMessage",
]
