"""
Pydantic v2 schemas for analytics API responses.
Each class maps to a specific analytics endpoint or chart widget in the frontend.
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class TimeSeriesPoint(BaseModel):
    """A single data point for a time-series chart (applications over time)."""

    period: date = Field(..., description="The date/period bucket (e.g. week start date).")
    count: int = Field(..., ge=0, description="Number of applications in this period.")


class StatusFunnelItem(BaseModel):
    """A single status stage with its application count for funnel visualisation."""

    status: str = Field(..., description="Application status label (e.g. 'applied', 'interview').")
    count: int = Field(..., ge=0, description="Number of applications in this status.")
    percentage: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Percentage of total applications represented by this status.",
    )


class SkillFrequency(BaseModel):
    """Frequency of a skill across all job applications."""

    skill: str = Field(..., description="Skill name as extracted from job descriptions.")
    count: int = Field(..., ge=0, description="Number of applications mentioning this skill.")


class SourceEffectiveness(BaseModel):
    """Effectiveness metrics for a single application source (e.g. LinkedIn, Referral)."""

    source: str = Field(..., description="The source channel (e.g. 'LinkedIn', 'direct').")
    total: int = Field(..., ge=0, description="Total applications from this source.")
    interviews: int = Field(..., ge=0, description="Applications that reached interview stage.")
    offers: int = Field(..., ge=0, description="Applications that resulted in an offer.")
    conversion_rate: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Offer conversion rate as a percentage.",
    )


class SalaryDistribution(BaseModel):
    """Salary range bucket for histogram / distribution chart."""

    range_label: str = Field(
        ...,
        description="Human-readable salary range label (e.g. '50k–60k').",
    )
    min_value: int = Field(..., description="Lower bound of the salary range (inclusive).")
    max_value: int = Field(..., description="Upper bound of the salary range (exclusive).")
    count: int = Field(..., ge=0, description="Number of applications within this range.")
    currency: str = Field(default="EUR", description="Currency code for the salary values.")


class ResponseTimeItem(BaseModel):
    """Average response time (days) from application to first reply, per company or period."""

    label: str = Field(..., description="Company name or time period label.")
    avg_days: float = Field(
        ...,
        ge=0.0,
        description="Average number of days to receive a response.",
    )
    sample_size: int = Field(
        ...,
        ge=0,
        description="Number of applications used to compute the average.",
    )


class StatCards(BaseModel):
    """Aggregate statistics displayed on the analytics dashboard summary cards."""

    total_applications: int = Field(..., ge=0, description="Total number of applications.")
    active_applications: int = Field(
        ...,
        ge=0,
        description="Applications that are still in-progress (not rejected/accepted).",
    )
    interviews_scheduled: int = Field(
        ..., ge=0, description="Applications currently at interview stage."
    )
    offers_received: int = Field(..., ge=0, description="Applications that resulted in an offer.")
    rejection_rate: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Percentage of closed applications that were rejections.",
    )
    avg_response_days: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Average days to receive any response across all applications.",
    )
    applications_this_week: int = Field(
        ..., ge=0, description="Applications submitted in the current calendar week."
    )
    applications_this_month: int = Field(
        ..., ge=0, description="Applications submitted in the current calendar month."
    )
