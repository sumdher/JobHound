"""
Analytics API router.
All endpoints are protected by JWT and return aggregated data for the dashboard.
Uses dedicated analytics service with raw SQL for performance.
"""

import structlog
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.services import analytics as analytics_service

router = APIRouter()
logger = structlog.get_logger(__name__)


@router.get(
    "/overview",
    summary="Dashboard stat cards",
    description="Returns high-level statistics: total apps, response rate, avg salary, etc.",
)
async def get_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Stat cards for the top of the dashboard."""
    return await analytics_service.get_overview_stats(current_user.id, db)


@router.get(
    "/applications-over-time",
    summary="Applications over time (area chart data)",
    description="Returns application counts grouped by week or month for the past 12 months.",
)
async def get_applications_over_time(
    period: str = Query(default="monthly", description="Grouping: 'weekly' or 'monthly'"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Weekly or monthly application volume."""
    return await analytics_service.get_applications_over_time(
        current_user.id, db, period=period
    )


@router.get(
    "/status-funnel",
    summary="Status funnel chart data",
    description="Returns count of applications per status for the funnel visualization.",
)
async def get_status_funnel(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Application count per status."""
    return await analytics_service.get_status_funnel(current_user.id, db)


@router.get(
    "/skills-frequency",
    summary="Top skills by frequency",
    description="Returns top N skills ordered by usage across all applications.",
)
async def get_skills_frequency(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Skills ranked by how often they appear in applications."""
    return await analytics_service.get_skills_frequency(current_user.id, db, limit=limit)


@router.get(
    "/source-effectiveness",
    summary="Source effectiveness (grouped bar chart data)",
    description="Returns applied vs. response count per source (linkedin, indeed, etc.).",
)
async def get_source_effectiveness(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Per-source application counts and response rates."""
    return await analytics_service.get_source_effectiveness(current_user.id, db)


@router.get(
    "/salary-distribution",
    summary="Salary distribution histogram data",
    description="Returns salary histogram buckets with median and percentile annotations.",
)
async def get_salary_distribution(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Salary histogram with p25/median/p75."""
    return await analytics_service.get_salary_distribution(current_user.id, db)


@router.get(
    "/response-time",
    summary="Average response time by source",
    description="Returns average days from application to first response, grouped by source.",
)
async def get_response_time(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Average response time per source."""
    return await analytics_service.get_response_time(current_user.id, db)


@router.get(
    "/status-by-month",
    summary="Status breakdown by month (stacked bar data)",
    description="Returns per-status application counts per month for the past 12 months.",
)
async def get_status_by_month(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Monthly status breakdown for stacked bar chart."""
    return await analytics_service.get_status_by_month(current_user.id, db)
