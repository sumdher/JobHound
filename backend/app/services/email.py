"""
Email service for JobHound.
Sends approval request emails to the admin when a new user registers.
Uses the Resend HTTP API via httpx for non-blocking, secure email delivery.
"""

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class EmailDeliveryError(RuntimeError):
    """Raised when an approval request email cannot be delivered."""


def _api_key_suffix(api_key: str | None) -> str | None:
    """Return only the final characters of an API key for safe logging."""
    if not api_key:
        return None
    return api_key[-4:] if len(api_key) >= 4 else api_key


def _email_log_context(from_addr: str | None = None) -> dict[str, str | bool | None]:
    """Return email-related runtime configuration safe for structured logs."""
    return {
        "admin_email": settings.admin_email or None,
        "resend_from_email": from_addr
        or settings.resend_from_email
        or "JobHound <onboarding@resend.dev>",
        "app_url": settings.app_url,
        "resend_api_key_configured": bool(settings.resend_api_key),
        "resend_api_key_suffix": _api_key_suffix(settings.resend_api_key),
    }


def log_email_runtime_config() -> None:
    """Emit safe startup visibility for the active email configuration."""
    logger.info("Email runtime configuration loaded", **_email_log_context())


async def send_approval_request_email(
    user_email: str,
    user_name: str | None,
    approve_url: str,
    reject_url: str,
) -> None:
    """Send a new-user approval request to the admin email."""
    if not settings.admin_email:
        logger.error(
            "Approval request email misconfigured",
            reason="admin_email_missing",
            **_email_log_context(),
        )
        raise EmailDeliveryError(
            "Approval request email is not configured because ADMIN_EMAIL is missing"
        )
    if not settings.resend_api_key:
        logger.error(
            "Approval request email misconfigured",
            reason="resend_api_key_missing",
            **_email_log_context(),
        )
        raise EmailDeliveryError(
            "Approval request email is not configured because RESEND_API_KEY is missing"
        )

    from_addr = settings.resend_from_email or "JobHound <onboarding@resend.dev>"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                RESEND_API_URL,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={
                    "from": from_addr,
                    "to": [settings.admin_email],
                    "subject": f"[JobHound] Access request from {user_email}",
                    "html": _approval_email_html(user_email, user_name, approve_url, reject_url),
                },
            )
            resp.raise_for_status()
        logger.info(
            "Approval request email sent",
            to=settings.admin_email,
            requested_by=user_email,
            **_email_log_context(from_addr),
        )
    except httpx.HTTPStatusError as exc:
        response_text = exc.response.text.strip() or None
        logger.error(
            "Resend rejected approval request email",
            requested_by=user_email,
            status_code=exc.response.status_code,
            response_body=response_text[:2000] if response_text else None,
            **_email_log_context(from_addr),
        )
        raise EmailDeliveryError(
            f"Resend API returned HTTP {exc.response.status_code} for approval request email"
        ) from exc
    except httpx.HTTPError as exc:
        logger.error(
            "HTTP error while sending approval request email",
            requested_by=user_email,
            error=str(exc),
            **_email_log_context(from_addr),
        )
        raise EmailDeliveryError(
            "HTTP error while sending approval request email"
        ) from exc
    except Exception as exc:
        logger.error(
            "Unexpected error while sending approval request email",
            requested_by=user_email,
            error=str(exc),
            **_email_log_context(from_addr),
        )
        raise EmailDeliveryError(
            "Unexpected error while sending approval request email"
        ) from exc


def _approval_email_html(
    user_email: str,
    user_name: str | None,
    approve_url: str,
    reject_url: str,
) -> str:
    name = user_name or user_email
    return f"""<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; color: #111827; max-width: 600px; margin: 0 auto; padding: 32px;">
  <h2 style="color: #3b82f6; margin-bottom: 8px;">JobHound — New Access Request</h2>
  <p style="color: #6b7280;">A new user is requesting access:</p>
  <table style="border-collapse: collapse; margin: 16px 0; width: 100%;">
    <tr>
      <td style="padding: 6px 16px 6px 0; color: #9ca3af; width: 80px;">Name</td>
      <td style="padding: 6px 0;"><strong>{name}</strong></td>
    </tr>
    <tr>
      <td style="padding: 6px 16px 6px 0; color: #9ca3af;">Email</td>
      <td style="padding: 6px 0;"><strong>{user_email}</strong></td>
    </tr>
  </table>
  <div style="margin: 28px 0;">
    <a href="{approve_url}"
       style="background: #22c55e; color: white; padding: 12px 28px; border-radius: 8px;
              text-decoration: none; font-weight: 600; margin-right: 12px; display: inline-block;">
      ✓ Approve Access
    </a>
    <a href="{reject_url}"
       style="background: #ef4444; color: white; padding: 12px 28px; border-radius: 8px;
              text-decoration: none; font-weight: 600; display: inline-block;">
      ✗ Reject
    </a>
  </div>
  <p style="color: #9ca3af; font-size: 12px; margin-top: 32px;">
    These links expire in 72 hours. Sent by JobHound.
  </p>
</body>
</html>"""
