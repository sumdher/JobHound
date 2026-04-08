"""
Skills API router.
GET /api/skills — list all canonical skills (id, name, category). No auth required.
"""

import structlog
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.skill import Skill

router = APIRouter()
logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Response schemas (local — no separate schema file needed for this simple router)
# ---------------------------------------------------------------------------


class SkillResponse(BaseModel):
    """A single skill entry."""

    id: int
    name: str
    category: str | None = None

    model_config = {"from_attributes": True}


class SkillListResponse(BaseModel):
    """Paginated list of skills."""

    items: list[SkillResponse]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=SkillListResponse,
    summary="List all skills",
    description=(
        "Returns a paginated list of all canonical skills in the system. "
        "Skills are shared across all users and normalized to lowercase. "
        "No authentication is required."
    ),
)
async def list_skills(
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(default=50, ge=1, le=200, description="Number of skills per page"),
    category: str | None = Query(default=None, description="Filter by skill category"),
    search: str | None = Query(default=None, description="Search skills by name prefix"),
    db: AsyncSession = Depends(get_db),
) -> SkillListResponse:
    """Return all skills ordered by name, with optional category and name filters."""
    base_query = select(Skill)

    if category:
        base_query = base_query.where(Skill.category == category)
    if search:
        base_query = base_query.where(Skill.name.ilike(f"{search.lower()}%"))

    # Total count
    count_result = await db.execute(
        select(func.count()).select_from(base_query.subquery())
    )
    total = count_result.scalar_one()

    # Paginated fetch
    offset = (page - 1) * page_size
    result = await db.execute(
        base_query.order_by(Skill.name).offset(offset).limit(page_size)
    )
    skills = result.scalars().all()

    logger.debug("Listed skills", total=total, page=page, page_size=page_size)

    return SkillListResponse(
        items=[SkillResponse.model_validate(s) for s in skills],
        total=total,
        page=page,
        page_size=page_size,
    )
