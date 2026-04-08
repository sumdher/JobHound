"""
Pydantic v2 schemas for chat-related API requests and responses.
Covers LLM chat messages and per-request provider configuration overrides.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ChatRequest(BaseModel):
    """Request body for the chat endpoint."""

    message: str = Field(..., description="The user's chat message.")

    # Optional per-request LLM provider overrides.
    provider: Optional[str] = Field(
        default=None,
        description="Override the global LLM_PROVIDER setting for this request.",
    )
    model: Optional[str] = Field(
        default=None,
        description="Override the model name for this request.",
    )
    temperature: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=2.0,
        description="Sampling temperature (0.0–2.0). Overrides the provider default.",
    )
    max_tokens: Optional[int] = Field(
        default=None,
        gt=0,
        description="Maximum tokens to generate. Overrides the provider default.",
    )
    stream: bool = Field(
        default=False,
        description="Whether to stream the response token-by-token.",
    )


class ChatMessageResponse(BaseModel):
    """A single persisted chat message returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role: str = Field(..., description="Message role: 'user' | 'assistant' | 'system'.")
    content: str
    metadata_: Optional[dict[str, Any]] = Field(
        default=None,
        description="Arbitrary metadata stored alongside the message (e.g. token counts).",
    )
    created_at: datetime
