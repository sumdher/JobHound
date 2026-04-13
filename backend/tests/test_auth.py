"""Focused tests for authentication error handling."""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.config import settings
from app.models.user import User
from app.services.email import EmailDeliveryError


@pytest.mark.asyncio
async def test_google_auth_returns_500_and_rolls_back_new_user_when_email_fails(
    client,
    db_session,
    monkeypatch,
):
    """New pending users should not be persisted when approval email delivery fails."""
    monkeypatch.setattr(settings, "google_client_id", "test-google-client-id")
    monkeypatch.setattr(settings, "admin_email", "admin@example.com")
    monkeypatch.setattr(settings, "app_url", "https://jobhound.example.com")

    google_identity = {
        "email": "new.user@example.com",
        "name": "New User",
        "picture": "https://example.com/avatar.png",
    }

    with (
        patch("app.api.auth.id_token.verify_oauth2_token", return_value=google_identity),
        patch(
            "app.api.auth.send_approval_request_email",
            new=AsyncMock(side_effect=EmailDeliveryError("Resend API returned HTTP 403")),
        ),
    ):
        response = await client.post(
            "/api/auth/google",
            json={"id_token": "test-google-id-token"},
        )

    assert response.status_code == 500
    assert response.json() == {
        "detail": (
            "Account could not be created because the approval request email failed "
            "to send. Please try again later."
        )
    }

    persisted_user = (
        await db_session.execute(select(User).where(User.email == google_identity["email"]))
    ).scalar_one_or_none()
    assert persisted_user is None
