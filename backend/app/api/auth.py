"""
Authentication API router.
Handles Google OAuth token verification and JWT issuance.
POST /api/auth/google  — verify Google ID token, upsert user, return JWT.
GET  /api/auth/me      — return current user profile.
"""

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.auth import create_access_token, get_current_user
from app.models.user import User

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
        "and returns a signed JWT for subsequent API calls."
    ),
)
async def google_auth(
    body: GoogleTokenRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Verify Google ID token and return a JobHound JWT."""
    # Verify the Google ID token
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

    # Upsert user
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            email=email,
            name=id_info.get("name"),
            avatar_url=id_info.get("picture"),
        )
        db.add(user)
        await db.flush()
        logger.info("New user created", email=email)
    else:
        user.name = id_info.get("name", user.name)
        user.avatar_url = id_info.get("picture", user.avatar_url)

    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id, user.email)

    return AuthResponse(
        access_token=token,
        user={
            "id": str(user.id),
            "email": user.email,
            "name": user.name,
            "avatar_url": user.avatar_url,
        },
    )


@router.get(
    "/me",
    summary="Get current user profile",
    description="Returns the profile of the currently authenticated user.",
)
async def get_me(current_user: User = Depends(get_current_user)) -> dict:
    """Return the current user's profile."""
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "name": current_user.name,
        "avatar_url": current_user.avatar_url,
        "created_at": current_user.created_at.isoformat(),
    }
