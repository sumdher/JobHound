"""
Admin API router.

Email-based approve/reject (token links in emails) — no auth required.
Admin panel endpoints (user list, status update, delete) — require admin JWT.
"""

import uuid
from datetime import datetime, timedelta, timezone
from html import escape

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.application import Application, ApplicationSkill, StatusHistory
from app.models.chat import ChatMessage
from app.models.embedding import JobDescriptionEmbedding
from app.models.user import User

router = APIRouter()
logger = structlog.get_logger(__name__)

_ACTION_TOKEN_EXPIRY_HOURS = 72


# ── Admin auth dependency ─────────────────────────────────────────────────────

async def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    """Dependency: require the request to come from the configured admin email."""
    if not settings.admin_email or current_user.email.lower() != settings.admin_email.lower():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


# ── Email action tokens ───────────────────────────────────────────────────────

def create_action_token(user_id: uuid.UUID, action: str) -> str:
    """Create a short-lived signed JWT for an admin approve/reject action."""
    expire = datetime.now(timezone.utc) + timedelta(hours=_ACTION_TOKEN_EXPIRY_HOURS)
    return jwt.encode(
        {"sub": str(user_id), "action": action, "exp": expire},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def _decode_action_token(token: str, expected_action: str) -> str:
    """Decode and validate an action token. Returns user_id string."""
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except JWTError as e:
        raise ValueError(f"Invalid or expired token: {e}") from e

    if payload.get("action") != expected_action:
        raise ValueError("Token action mismatch")

    user_id = payload.get("sub")
    if not user_id:
        raise ValueError("Token missing user ID")

    return user_id


def _html_page(title: str, message: str, color: str = "#3b82f6") -> HTMLResponse:
    safe_title = escape(title)
    safe_msg = escape(message)
    return HTMLResponse(f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JobHound — {safe_title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
             display: flex; align-items: center; justify-content: center;
             min-height: 100vh; margin: 0; background: #0f172a; color: #f8fafc;">
  <div style="text-align: center; max-width: 480px; padding: 48px 40px;
              background: #1e293b; border-radius: 16px; border: 1px solid #334155;
              box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
    <div style="font-size: 56px; margin-bottom: 20px;">🐾</div>
    <h1 style="color: {color}; margin: 0 0 12px; font-size: 24px;">{safe_title}</h1>
    <p style="color: #94a3b8; margin: 0; line-height: 1.6;">{safe_msg}</p>
  </div>
</body>
</html>""")


# ── Email-based approve / reject (no auth — token in URL) ────────────────────

@router.get("/approve", response_class=HTMLResponse, include_in_schema=False)
async def approve_user(
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> HTMLResponse:
    """Approve a pending user (admin action via signed token from email link)."""
    try:
        user_id_str = _decode_action_token(token, "approve")
        user_id = uuid.UUID(user_id_str)
    except (ValueError, AttributeError) as e:
        logger.warning("Invalid approve token", error=str(e))
        return _html_page("Invalid Link", "This link is invalid or has expired.", "#ef4444")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        return _html_page("User Not Found", "No matching user found.", "#ef4444")

    if user.status == "approved":
        return _html_page(
            "Already Approved",
            f"{user.email} already has access to JobHound.",
            "#22c55e",
        )

    user.status = "approved"
    await db.commit()
    logger.info("User approved by admin (email link)", email=user.email)
    return _html_page(
        "Access Granted",
        f"{user.email} has been approved and can now sign in to JobHound.",
        "#22c55e",
    )


@router.get("/reject", response_class=HTMLResponse, include_in_schema=False)
async def reject_user(
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
) -> HTMLResponse:
    """Reject a pending user (admin action via signed token from email link)."""
    try:
        user_id_str = _decode_action_token(token, "reject")
        user_id = uuid.UUID(user_id_str)
    except (ValueError, AttributeError) as e:
        logger.warning("Invalid reject token", error=str(e))
        return _html_page("Invalid Link", "This link is invalid or has expired.", "#ef4444")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        return _html_page("User Not Found", "No matching user found.", "#ef4444")

    if user.status == "rejected":
        return _html_page(
            "Already Rejected",
            f"{user.email} has already been rejected.",
            "#f59e0b",
        )

    user.status = "rejected"
    await db.commit()
    logger.info("User rejected by admin (email link)", email=user.email)
    return _html_page(
        "Access Denied",
        f"{user.email} has been rejected.",
        "#ef4444",
    )


# ── Admin panel endpoints (JWT-authenticated, admin only) ────────────────────

class AdminUserResponse(BaseModel):
    id: str
    email: str
    name: str | None
    avatar_url: str | None
    status: str
    application_count: int
    created_at: str


class UpdateStatusRequest(BaseModel):
    status: str


@router.get("/panel/users", response_model=list[AdminUserResponse])
async def list_users(
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> list[AdminUserResponse]:
    """List all users with their application counts. Admin only."""
    # Count applications per user (non-deleted)
    counts_q = (
        select(Application.user_id, func.count(Application.id).label("app_count"))
        .where(Application.is_deleted.is_(False))
        .group_by(Application.user_id)
        .subquery()
    )
    result = await db.execute(
        select(User, func.coalesce(counts_q.c.app_count, 0).label("app_count"))
        .outerjoin(counts_q, User.id == counts_q.c.user_id)
        .order_by(User.created_at.desc())
    )
    rows = result.all()
    return [
        AdminUserResponse(
            id=str(u.id),
            email=u.email,
            name=u.name,
            avatar_url=u.avatar_url,
            status=u.status,
            application_count=int(count),
            created_at=u.created_at.isoformat(),
        )
        for u, count in rows
    ]


@router.patch("/panel/users/{user_id}/status")
async def update_user_status(
    user_id: uuid.UUID,
    body: UpdateStatusRequest,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Update a user's approval status. Admin only."""
    if body.status not in ("pending", "approved", "rejected"):
        raise HTTPException(status_code=400, detail="Invalid status value")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.email.lower() == settings.admin_email.lower():
        raise HTTPException(status_code=400, detail="Cannot change admin's own status")

    user.status = body.status
    await db.commit()
    logger.info("User status updated by admin", target=user.email, status=body.status, admin=admin.email)
    return {"id": str(user.id), "status": user.status}


@router.delete("/panel/users/{user_id}", status_code=204)
async def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Hard-delete a user and all their data. Admin only."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.email.lower() == settings.admin_email.lower():
        raise HTTPException(status_code=400, detail="Cannot delete the admin account")

    # Collect application IDs for this user
    app_ids_q = select(Application.id).where(Application.user_id == user_id)

    # Delete child records first (FK order)
    await db.execute(delete(JobDescriptionEmbedding).where(
        JobDescriptionEmbedding.application_id.in_(app_ids_q)
    ))
    await db.execute(delete(StatusHistory).where(
        StatusHistory.application_id.in_(app_ids_q)
    ))
    await db.execute(delete(ApplicationSkill).where(
        ApplicationSkill.application_id.in_(app_ids_q)
    ))
    await db.execute(delete(Application).where(Application.user_id == user_id))
    await db.execute(delete(ChatMessage).where(ChatMessage.user_id == user_id))
    await db.execute(delete(User).where(User.id == user_id))
    await db.commit()

    logger.info("User deleted by admin", target=user.email, admin=admin.email)
