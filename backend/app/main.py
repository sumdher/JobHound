"""
JobHound FastAPI application entry point.
Configures middleware, routers, lifespan events, and health check.
"""

from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: startup and shutdown logic."""
    logger.info("JobHound backend starting up", llm_provider=settings.llm_provider)
    yield
    logger.info("JobHound backend shutting down")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="JobHound API",
        description="AI-powered job application tracker with NL parsing, RAG chat, and analytics.",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers
    from app.api import auth, applications, analytics, chat, skills

    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(applications.router, prefix="/api/applications", tags=["applications"])
    app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
    app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
    app.include_router(skills.router, prefix="/api/skills", tags=["skills"])

    @app.get("/health", tags=["health"])
    async def health_check() -> dict[str, str]:
        """Health check endpoint for Docker and load balancers."""
        return {"status": "ok", "service": "jobhound-backend"}

    return app


app = create_app()
