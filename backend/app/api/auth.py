"""
Authentication API router.
Handles Google OAuth token verification and JWT issuance.
POST /api/auth/google  — verify Google ID token, upsert user, return JWT + status.
GET  /api/auth/me      — return current user profile (requires approved status).
GET  /api/auth/status  — return current user status (works for pending users too).
"""

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin import create_action_token
from app.config import settings
from app.database import get_db
from app.middleware.auth import create_access_token, get_any_user, get_current_user
from app.models.user import User
from app.services.email import EmailDeliveryError, send_approval_request_email

router = APIRouter()
logger = structlog.get_logger(__name__)


class GoogleTokenRequest(BaseModel):
    """Request body for Google OAuth token exchange."""

    id_token: str


class AuthResponse(BaseModel):
    """Response containing JWT and user profile."""

    access_token: str
    token_type: str = "bearer"
    user: dict


@router.post(
    "/google",
    response_model=AuthResponse,
    summary="Exchange Google ID token for JWT",
    description=(
        "Verifies the Google ID token, upserts the user in the database, "
        "and returns a signed JWT. New users start as 'pending' unless they "
        "are the configured admin email."
    ),
)
async def google_auth(
    body: GoogleTokenRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Verify Google ID token and return a JobHound JWT."""
    try:
        id_info = id_token.verify_oauth2_token(
            body.id_token,
            google_requests.Request(),
            settings.google_client_id,
        )
    except ValueError as e:
        logger.warning("Invalid Google ID token", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google token: {e}",
        ) from e

    email = id_info.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google token missing email claim",
        )

    configured_admin = (settings.admin_email or "").strip().lower()
    normalized_email = email.strip().lower()

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    is_new_user = user is None

    if is_new_user:
        # Auto-approve if no admin is configured (dev mode) or if this IS the admin
        is_admin = bool(configured_admin and normalized_email == configured_admin)
        initial_status = "approved" if (is_admin or not configured_admin) else "pending"

        user = User(
            email=email,
            name=id_info.get("name"),
            avatar_url=id_info.get("picture"),
            status=initial_status,
        )
        db.add(user)
        await db.flush()
        logger.info("New user created", email=email, status=initial_status)
    else:
        user.name = id_info.get("name", user.name)
        user.avatar_url = id_info.get("picture", user.avatar_url)

    # Send approval email to admin for new non-admin pending users
    if is_new_user and user.status == "pending":
        approve_token = create_action_token(user.id, "approve")
        reject_token = create_action_token(user.id, "reject")
        approve_url = f"{settings.app_url}/backend/api/admin/approve?token={approve_token}"
        reject_url = f"{settings.app_url}/backend/api/admin/reject?token={reject_token}"
        try:
            await send_approval_request_email(
                user_email=user.email,
                user_name=user.name,
                approve_url=approve_url,
                reject_url=reject_url,
            )
        except EmailDeliveryError as exc:
            await db.rollback()
            logger.error(
                "New user signup aborted because approval email failed",
                email=user.email,
                error=str(exc),
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=(
                    "Account could not be created because the approval request email "
                    "failed to send. Please try again later."
                ),
            ) from exc

    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id, user.email)

    is_admin = bool(configured_admin and normalized_email == configured_admin)

    return AuthResponse(
        access_token=token,
        user={
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "avatar_url": user.avatar_url,
            "status": user.status,
            "is_admin": is_admin,
        },
    )


@router.get(
    "/me",
    summary="Get current user profile",
    description="Returns the profile of the currently authenticated user (must be approved).",
)
async def get_me(current_user: User = Depends(get_current_user)) -> dict:
    """Return the current user's profile."""
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "name": current_user.name,
        "avatar_url": current_user.avatar_url,
        "status": current_user.status,
        "created_at": current_user.created_at.isoformat(),
    }


@router.get(
    "/status",
    summary="Get current user approval status",
    description=(
        "Returns the approval status of the authenticated user. "
        "Works for pending and rejected users (no status check)."
    ),
)
async def get_status(current_user: User = Depends(get_any_user)) -> dict:
    """Return the user's current approval status (usable by pending users)."""
    configured_admin = (settings.admin_email or "").strip().lower()
    current_email = (current_user.email or "").strip().lower()

    return {
        "status": current_user.status,
        "is_admin": current_email == configured_admin if configured_admin else False,
    }
