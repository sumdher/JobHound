"""
User settings API.
  GET  /api/user/settings       — return stored LLM settings for the current user
  PUT  /api/user/settings       — update LLM settings (api_key is NEVER stored)
  GET  /api/user/ollama-models  — list models available in the local Ollama instance
"""

import httpx
import structlog
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings as app_settings
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User

router = APIRouter()
logger = structlog.get_logger(__name__)

_DEFAULT_SETTINGS = {"provider": "ollama", "model": app_settings.ollama_model}


class LLMSettings(BaseModel):
    provider: str
    model: str
    # base_url only for non-ollama providers (e.g. nebius)
    base_url: str | None = None


@router.get("/settings", response_model=LLMSettings)
async def get_settings(current_user: User = Depends(get_current_user)) -> LLMSettings:
    """Return the user's stored LLM settings, falling back to server defaults."""
    stored = current_user.llm_settings or {}
    return LLMSettings(
        provider=stored.get("provider", _DEFAULT_SETTINGS["provider"]),
        model=stored.get("model", _DEFAULT_SETTINGS["model"]),
        base_url=stored.get("base_url"),
    )


@router.put("/settings", response_model=LLMSettings)
async def update_settings(
    body: LLMSettings,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LLMSettings:
    """Persist the user's LLM settings. API keys are never stored server-side."""
    current_user.llm_settings = body.model_dump(exclude_none=True)
    await db.commit()
    logger.info("LLM settings updated", user=current_user.email, provider=body.provider)
    return body


@router.get("/ollama-models")
async def get_ollama_models(
    _current_user: User = Depends(get_current_user),
) -> dict:
    """Return the list of models pulled in the local Ollama instance."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{app_settings.ollama_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"models": models}
    except Exception as e:
        logger.warning("Could not reach Ollama", error=str(e))
        return {"models": [], "error": "Ollama not reachable"}
