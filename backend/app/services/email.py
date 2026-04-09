"""
Email service for JobHound.
Sends approval request emails to the admin when a new user registers.
Uses smtplib wrapped in asyncio.to_thread for non-blocking operation.
"""

import asyncio
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import structlog

from app.config import settings

logger = structlog.get_logger(__name__)


async def send_approval_request_email(
    user_email: str,
    user_name: str | None,
    approve_url: str,
    reject_url: str,
) -> None:
    """Send a new-user approval request to the admin email (non-blocking)."""
    if not settings.admin_email or not settings.smtp_host:
        logger.warning(
            "Email not configured — skipping approval request email",
            missing="admin_email" if not settings.admin_email else "smtp_host",
        )
        return

    try:
        await asyncio.to_thread(
            _send_smtp,
            to=settings.admin_email,
            subject=f"[JobHound] Access request from {user_email}",
            html=_approval_email_html(user_email, user_name, approve_url, reject_url),
        )
    except Exception as exc:
        logger.error("Failed to send approval request email", error=str(exc))


def _send_smtp(to: str, subject: str, html: str) -> None:
    """Send an email synchronously via SMTP (run inside asyncio.to_thread)."""
    from_addr = settings.smtp_from or settings.smtp_user
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(from_addr, [to], msg.as_string())

    logger.info("Approval request email sent", to=to)


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
  <div style="margin: 28px 0; display: flex; gap: 12px;">
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
