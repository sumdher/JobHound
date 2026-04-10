"""
Pydantic v2 schemas for job application CRUD operations.
Covers create, update, response, list, parsing, and status history shapes.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Status history
# ---------------------------------------------------------------------------


class StatusHistoryResponse(BaseModel):
    """A single status-transition record for an application."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    from_status: Optional[str] = None
    to_status: str
    changed_at: datetime
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Application base / shared fields
# ---------------------------------------------------------------------------


class ApplicationBase(BaseModel):
    """Fields shared across create and response schemas."""

    company: Optional[str] = None
    job_title: Optional[str] = None
    date_applied: Optional[date] = None
    source: Optional[str] = None
    status: str = Field(default="applied")
    location: Optional[str] = None
    work_mode: Optional[str] = None
    whats_in_it_for_me: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: str = Field(default="EUR")
    salary_period: str = Field(default="yearly")
    cv_link: Optional[str] = None
    cl_link: Optional[str] = None
    job_url: Optional[str] = None
    notes: Optional[str] = None
    rejection_reason: Optional[str] = None
    raw_input: Optional[str] = None


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


class ApplicationCreate(ApplicationBase):
    """Payload for creating a new application. company and job_title are required."""

    company: str
    job_title: str
    skills: list[str] = Field(default_factory=list)
    job_description: Optional[str] = Field(
        default=None,
        description="Raw job description text used to generate embeddings.",
    )


# ---------------------------------------------------------------------------
# Update (all fields optional for PATCH-style partial updates)
# ---------------------------------------------------------------------------


class ApplicationUpdate(BaseModel):
    """Payload for partially updating an existing application."""

    company: Optional[str] = None
    job_title: Optional[str] = None
    date_applied: Optional[date] = None
    source: Optional[str] = None
    status: Optional[str] = None
    location: Optional[str] = None
    work_mode: Optional[str] = None
    whats_in_it_for_me: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    salary_currency: Optional[str] = None
    salary_period: Optional[str] = None
    cv_link: Optional[str] = None
    cl_link: Optional[str] = None
    job_url: Optional[str] = None
    notes: Optional[str] = None
    rejection_reason: Optional[str] = None
    raw_input: Optional[str] = None
    skills: Optional[list[str]] = None
    job_description: Optional[str] = None


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------


class ApplicationResponse(ApplicationBase):
    """Full application shape returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    skills: list[str] = Field(default_factory=list)
    status_history: list[StatusHistoryResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# List / paginated response
# ---------------------------------------------------------------------------


class ApplicationListResponse(BaseModel):
    """Paginated list of applications."""

    items: list[ApplicationResponse]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Parse
# ---------------------------------------------------------------------------


class ParseRequest(BaseModel):
    """Request body for the parse-from-text endpoint."""

    text: str
    # Optional LLM config — mirrors the Settings page provider/model selection
    provider: str | None = None
    model: str | None = None
    api_key: str | None = Field(default=None, alias="apiKey")
    base_url: str | None = Field(default=None, alias="baseUrl")

    model_config = {"populate_by_name": True}


class ParseResponse(BaseModel):
    """Result of parsing a free-text job description."""

    parsed: dict
    uncertain_fields: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
