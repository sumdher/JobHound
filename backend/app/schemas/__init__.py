"""
Pydantic v2 schemas for the JobHound backend.
All public schema classes are re-exported from this package for convenient imports.
"""

from __future__ import annotations

from app.schemas.analytics import (
    ResponseTimeItem,
    SalaryDistribution,
    SkillFrequency,
    SourceEffectiveness,
    StatCards,
    StatusFunnelItem,
    TimeSeriesPoint,
)
from app.schemas.application import (
    ApplicationBase,
    ApplicationCreate,
    ApplicationListResponse,
    ApplicationResponse,
    ApplicationUpdate,
    ParseRequest,
    ParseResponse,
    StatusHistoryResponse,
)
from app.schemas.chat import ChatMessageResponse, ChatRequest
from app.schemas.user import UserResponse

__all__ = [
    # application
    "ApplicationBase",
    "ApplicationCreate",
    "ApplicationUpdate",
    "ApplicationResponse",
    "ApplicationListResponse",
    "StatusHistoryResponse",
    "ParseRequest",
    "ParseResponse",
    # user
    "UserResponse",
    # chat
    "ChatRequest",
    "ChatMessageResponse",
    # analytics
    "TimeSeriesPoint",
    "StatusFunnelItem",
    "SkillFrequency",
    "SourceEffectiveness",
    "SalaryDistribution",
    "ResponseTimeItem",
    "StatCards",
]
