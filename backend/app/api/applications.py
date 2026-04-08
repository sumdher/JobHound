"""
Applications API router.
Full CRUD for job applications. All endpoints require JWT authentication.

Endpoints:
  GET    /api/applications          — paginated list with filtering and sorting
  GET    /api/applications/{id}     — full detail with skills and status history
  POST   /api/applications          — create a new application
  PATCH  /api/applications/{id}     — partial update
  DELETE /api/applications/{id}     — soft delete
  POST   /api/applications/parse    — parse free-text into application fields
"""

import uuid
from datetime import date
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.application import Application, ApplicationSkill, StatusHistory
from app.models.skill import Skill
from app.models.user import User
from app.schemas.application import (
    ApplicationCreate,
    ApplicationListResponse,
    ApplicationResponse,
    ApplicationUpdate,
    ParseRequest,
    ParseResponse,
    StatusHistoryResponse,
)

router = APIRouter()
logger = structlog.get_logger(__name__)

# Statuses considered "inactive" for the purpose of filtering active applications
_INACTIVE_STATUSES = {"rejected", "ghosted", "withdrawn"}

# Allowed sort columns mapped to ORM attributes
_SORT_COLUMNS: dict[str, object] = {
    "date_applied": Application.date_applied,
    "company": Application.company,
    "status": Application.status,
    "created_at": Application.created_at,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_application_response(app: Application) -> ApplicationResponse:
    """Convert an ORM Application (with loaded relationships) to the response schema."""
    skill_names = [
        as_.skill.name
        for as_ in (app.application_skills or [])
        if as_.skill is not None
    ]
    history = [
        StatusHistoryResponse(
            id=sh.id,
            from_status=sh.from_status,
            to_status=sh.to_status,
            changed_at=sh.changed_at,
            notes=sh.notes,
        )
        for sh in (app.status_history or [])
    ]
    data = {
        "id": app.id,
        "user_id": app.user_id,
        "company": app.company,
        "job_title": app.job_title,
        "date_applied": app.date_applied,
        "source": app.source,
        "status": app.status,
        "location": app.location,
        "work_mode": app.work_mode,
        "whats_in_it_for_me": app.whats_in_it_for_me,
        "salary_min": app.salary_min,
        "salary_max": app.salary_max,
        "salary_currency": app.salary_currency,
        "salary_period": app.salary_period,
        "cv_link": app.cv_link,
        "cl_link": app.cl_link,
        "job_url": app.job_url,
        "notes": app.notes,
        "raw_input": app.raw_input,
        "skills": skill_names,
        "status_history": history,
        "created_at": app.created_at,
        "updated_at": app.updated_at,
    }
    return ApplicationResponse(**data)


async def _upsert_skills(
    db: AsyncSession,
    skill_names: list[str],
) -> list[Skill]:
    """
    Get-or-create skills by (lowercased) name.
    Returns the list of Skill ORM objects in the same order as input.
    """
    skills: list[Skill] = []
    for raw_name in skill_names:
        name = raw_name.strip().lower()
        if not name:
            continue
        result = await db.execute(select(Skill).where(Skill.name == name))
        skill = result.scalar_one_or_none()
        if skill is None:
            skill = Skill(name=name)
            db.add(skill)
            await db.flush()  # assign PK before use
            logger.debug("Created new skill", name=name)
        skills.append(skill)
    return skills


async def _set_application_skills(
    db: AsyncSession,
    app: Application,
    skill_names: list[str],
) -> None:
    """Replace all skills on an application with the provided list."""
    # Remove existing links
    await db.execute(
        delete(ApplicationSkill).where(
            ApplicationSkill.application_id == app.id
        )
    )
    skills = await _upsert_skills(db, skill_names)
    seen_ids: set[int] = set()
    for skill in skills:
        if skill.id in seen_ids:
            continue
        seen_ids.add(skill.id)
        db.add(ApplicationSkill(application_id=app.id, skill_id=skill.id))


async def _get_application_or_404(
    db: AsyncSession,
    app_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Application:
    """
    Fetch a non-deleted application owned by the given user.
    Raises 404 if not found or not owned by user.
    """
    result = await db.execute(
        select(Application)
        .where(
            and_(
                Application.id == app_id,
                Application.user_id == user_id,
                Application.is_deleted.is_(False),
            )
        )
        .options(
            selectinload(Application.application_skills).selectinload(
                ApplicationSkill.skill
            ),
            selectinload(Application.status_history),
        )
    )
    app = result.scalar_one_or_none()
    if app is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )
    return app


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=ApplicationListResponse,
    summary="List job applications",
    description=(
        "Returns a paginated, filterable, sortable list of the current user's "
        "non-deleted job applications. Supports filtering by status, source, "
        "date range, required skills, location, and a full-text search over "
        "company name and job title."
    ),
)
async def list_applications(
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(default=20, ge=1, le=100, description="Results per page"),
    status_filter: Optional[str] = Query(
        default=None, alias="status", description="Filter by application status"
    ),
    source: Optional[str] = Query(default=None, description="Filter by application source"),
    date_from: Optional[date] = Query(
        default=None, description="Filter applications on or after this date (YYYY-MM-DD)"
    ),
    date_to: Optional[date] = Query(
        default=None, description="Filter applications on or before this date (YYYY-MM-DD)"
    ),
    skills: Optional[list[str]] = Query(
        default=None, description="Return applications that match ANY of these skill names"
    ),
    location: Optional[str] = Query(
        default=None, description="Filter by location (case-insensitive substring match)"
    ),
    search: Optional[str] = Query(
        default=None,
        description="Full-text search across company name and job title",
    ),
    sort_by: Optional[str] = Query(
        default="created_at",
        description="Column to sort by: date_applied | company | status | created_at",
    ),
    sort_order: str = Query(
        default="desc",
        description="Sort direction: asc | desc",
        pattern="^(asc|desc)$",
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ApplicationListResponse:
    """List non-deleted applications for the authenticated user."""
    base_filters = [
        Application.user_id == current_user.id,
        Application.is_deleted.is_(False),
    ]

    if status_filter:
        base_filters.append(Application.status == status_filter)
    if source:
        base_filters.append(Application.source == source)
    if date_from:
        base_filters.append(Application.date_applied >= date_from)
    if date_to:
        base_filters.append(Application.date_applied <= date_to)
    if location:
        base_filters.append(Application.location.ilike(f"%{location}%"))
    if search:
        term = f"%{search}%"
        base_filters.append(
            or_(
                Application.company.ilike(term),
                Application.job_title.ilike(term),
            )
        )

    base_query = select(Application).where(and_(*base_filters))

    # Skill filter: only include applications that have ANY of the given skills
    if skills:
        lowered = [s.strip().lower() for s in skills if s.strip()]
        if lowered:
            skill_subq = (
                select(ApplicationSkill.application_id)
                .join(Skill, Skill.id == ApplicationSkill.skill_id)
                .where(Skill.name.in_(lowered))
            )
            base_query = base_query.where(Application.id.in_(skill_subq))

    # Count
    count_result = await db.execute(
        select(func.count()).select_from(base_query.subquery())
    )
    total = count_result.scalar_one()

    # Sorting
    sort_col = _SORT_COLUMNS.get(sort_by or "created_at", Application.created_at)
    if sort_order == "asc":
        base_query = base_query.order_by(sort_col.asc())  # type: ignore[union-attr]
    else:
        base_query = base_query.order_by(sort_col.desc())  # type: ignore[union-attr]

    # Pagination with eager-loaded relationships
    offset = (page - 1) * page_size
    result = await db.execute(
        base_query.options(
            selectinload(Application.application_skills).selectinload(
                ApplicationSkill.skill
            ),
            selectinload(Application.status_history),
        )
        .offset(offset)
        .limit(page_size)
    )
    applications = result.scalars().unique().all()

    return ApplicationListResponse(
        items=[_build_application_response(a) for a in applications],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{app_id}",
    response_model=ApplicationResponse,
    summary="Get application detail",
    description=(
        "Returns the full detail of a single application including all associated "
        "skills and the complete status-transition history. Returns 404 if the "
        "application does not exist or belongs to a different user."
    ),
)
async def get_application(
    app_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ApplicationResponse:
    """Fetch a single application by ID for the authenticated user."""
    app = await _get_application_or_404(db, app_id, current_user.id)
    return _build_application_response(app)


@router.post(
    "",
    response_model=ApplicationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a job application",
    description=(
        "Creates a new job application for the current user. Skills are upserted "
        "by lowercased name. An initial status history record is created automatically. "
        "If job_description is provided it is stored as raw text on the application and "
        "an embedding is generated asynchronously (errors are caught gracefully)."
    ),
)
async def create_application(
    body: ApplicationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ApplicationResponse:
    """Create a new application and return the full response."""
    app = Application(
        user_id=current_user.id,
        company=body.company,
        job_title=body.job_title,
        date_applied=body.date_applied or date.today(),
        source=body.source,
        status=body.status,
        location=body.location,
        work_mode=body.work_mode,
        whats_in_it_for_me=body.whats_in_it_for_me,
        salary_min=body.salary_min,
        salary_max=body.salary_max,
        salary_currency=body.salary_currency,
        salary_period=body.salary_period,
        cv_link=body.cv_link,
        cl_link=body.cl_link,
        job_url=body.job_url,
        notes=body.notes,
        raw_input=body.raw_input or body.job_description,
    )
    db.add(app)
    await db.flush()  # assign PK

    # Record initial status in history
    db.add(
        StatusHistory(
            application_id=app.id,
            from_status=None,
            to_status=app.status,
        )
    )

    # Upsert skills
    if body.skills:
        await _set_application_skills(db, app, body.skills)

    await db.flush()

    # Trigger embedding generation (fire-and-forget, errors are non-fatal)
    if body.job_description:
        try:
            from app.services.embedding_service import generate_embedding  # noqa: PLC0415

            await generate_embedding(
                db=db,
                application_id=app.id,
                text=body.job_description,
            )
        except Exception:
            logger.warning(
                "Failed to generate embedding for application",
                application_id=str(app.id),
                exc_info=True,
            )

    await db.commit()
    await db.refresh(app)

    # Reload with relationships
    app = await _get_application_or_404(db, app.id, current_user.id)
    logger.info(
        "Application created",
        application_id=str(app.id),
        company=app.company,
        user_id=str(current_user.id),
    )
    return _build_application_response(app)


@router.patch(
    "/{app_id}",
    response_model=ApplicationResponse,
    summary="Partially update an application",
    description=(
        "Applies a partial update to an existing application. Only provided fields "
        "are modified. If the status changes, a new StatusHistory record is inserted "
        "automatically. Skills, if provided, replace the existing skill set."
    ),
)
async def update_application(
    app_id: uuid.UUID,
    body: ApplicationUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ApplicationResponse:
    """Partially update an application owned by the current user."""
    app = await _get_application_or_404(db, app_id, current_user.id)

    update_data = body.model_dump(exclude_unset=True)

    # Handle status change before applying updates
    new_status = update_data.pop("status", None)
    if new_status is not None and new_status != app.status:
        old_status = app.status
        app.status = new_status
        db.add(
            StatusHistory(
                application_id=app.id,
                from_status=old_status,
                to_status=new_status,
            )
        )

    # Handle skills separately
    new_skills = update_data.pop("skills", None)

    # Handle job_description → raw_input
    job_description = update_data.pop("job_description", None)
    if job_description is not None:
        app.raw_input = job_description
        try:
            from app.services import embedding as embedding_service  # noqa: PLC0415

            await embedding_service.generate_embedding(
                db=db,
                application_id=app.id,
                text=job_description,
            )
        except Exception:
            logger.warning(
                "Failed to generate embedding on update",
                application_id=str(app.id),
                exc_info=True,
            )

    # Apply remaining scalar field updates
    for field, value in update_data.items():
        setattr(app, field, value)

    if new_skills is not None:
        await _set_application_skills(db, app, new_skills)

    await db.flush()
    await db.commit()

    app = await _get_application_or_404(db, app_id, current_user.id)
    logger.info(
        "Application updated",
        application_id=str(app_id),
        user_id=str(current_user.id),
    )
    return _build_application_response(app)


@router.delete(
    "/{app_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete an application",
    description=(
        "Marks an application as deleted (is_deleted=True) without removing the "
        "database row. The application will no longer appear in list or detail "
        "endpoints. Returns 204 No Content on success."
    ),
)
async def delete_application(
    app_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft-delete an application by setting is_deleted=True."""
    app = await _get_application_or_404(db, app_id, current_user.id)
    app.is_deleted = True
    await db.flush()
    await db.commit()
    logger.info(
        "Application soft-deleted",
        application_id=str(app_id),
        user_id=str(current_user.id),
    )


@router.post(
    "/parse",
    response_model=ParseResponse,
    summary="Parse free-text into application fields",
    description=(
        "Accepts a natural-language job description or any free-text input and "
        "returns a structured ParseResponse containing the extracted application "
        "fields, a list of uncertain fields, and identified skills. Delegates to "
        "the services.parser.parse_application service."
    ),
)
async def parse_application_text(
    body: ParseRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),  # noqa: ARG001
) -> ParseResponse:
    """Parse free-form text into structured application data."""
    try:
        from app.services import parser as parser_service  # noqa: PLC0415

        result = await parser_service.parse_application(
            text=body.text,
            config=None,
        )
        uncertain_fields = result.pop("uncertain_fields", [])
        skills = result.pop("skills", [])
        return ParseResponse(parsed=result, uncertain_fields=uncertain_fields, skills=skills)
    except Exception as exc:
        logger.error("Application parsing failed", error=str(exc), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Parser service error: {exc}",
        ) from exc
