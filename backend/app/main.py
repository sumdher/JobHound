"""
JobHound FastAPI application entry point.
Configures middleware, routers, lifespan events, and health check.
"""

from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy import text

from app.config import settings
from app.database import engine
from app.limiter import limiter
from app.models import chat_session, cv_analysis  # noqa: F401
from app.services.email import log_email_runtime_config

logger = structlog.get_logger(__name__)


async def _ensure_runtime_schema_compatibility() -> None:
    """Patch forward-compatible columns that hot-reloaded code may expect."""
    async with engine.begin() as conn:
        await conn.execute(
            text("ALTER TABLE cv_analyses ADD COLUMN IF NOT EXISTS job_description TEXT")
        )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: startup and shutdown logic."""
    await _ensure_runtime_schema_compatibility()
    logger.info("JobHound backend starting up", llm_provider=settings.llm_provider)
    log_email_runtime_config()
    yield
    logger.info("JobHound backend shutting down")


class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds standard security headers to every response."""

    async def dispatch(self, request: Request, call_next: object) -> Response:
        response: Response = await call_next(request)  # type: ignore[operator]
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="JobHound API",
        description="AI-powered job application tracker with NL parsing, RAG chat, and analytics.",
        version="0.1.0",
        # Swagger / ReDoc only in debug mode — never expose in production
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        lifespan=lifespan,
    )

    # Rate limiting
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.add_middleware(SlowAPIMiddleware)

    # Security headers
    app.add_middleware(_SecurityHeadersMiddleware)

    # CORS — explicit methods and headers; wildcards with allow_credentials=True
    # would allow any cross-origin site to make credentialed requests.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )

    # Routers
    from app.api import admin, auth, applications, analytics, chat, skills, user_settings, cv

    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
    app.include_router(applications.router, prefix="/api/applications", tags=["applications"])
    app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
    app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
    app.include_router(skills.router, prefix="/api/skills", tags=["skills"])
    app.include_router(user_settings.router, prefix="/api/user", tags=["user"])
    app.include_router(cv.router, prefix="/api/user/cv", tags=["cv"])

    @app.get("/health", tags=["health"])
    async def health_check() -> dict[str, str]:
        """Health check endpoint for Docker and load balancers."""
        return {"status": "ok", "service": "jobhound-backend"}

    return app


app = create_app()
