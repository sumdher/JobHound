"""
Admin API router.
Token-based approve/reject endpoints for user access control.
Links are sent to the admin via email — no login required (action embedded in signed JWT).
"""

import uuid
from datetime import datetime, timedelta, timezone
from html import escape

import structlog
from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User

router = APIRouter()
logger = structlog.get_logger(__name__)

_ACTION_TOKEN_EXPIRY_HOURS = 72


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
    logger.info("User approved by admin", email=user.email)
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
    logger.info("User rejected by admin", email=user.email)
    return _html_page(
        "Access Denied",
        f"{user.email} has been rejected.",
        "#ef4444",
    )
