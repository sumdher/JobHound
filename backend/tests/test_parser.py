"""
Tests for the NL application parser service.
Verifies that parse_application correctly extracts structured data
from varied free-form input using a mocked LLM provider.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.parser import _extract_json, parse_application


# ---------------------------------------------------------------------------
# _extract_json unit tests
# ---------------------------------------------------------------------------


def test_extract_json_direct():
    """Plain JSON string is parsed correctly."""
    raw = '{"company": "Acme", "job_title": "Engineer"}'
    result = _extract_json(raw)
    assert result["company"] == "Acme"


def test_extract_json_markdown_block():
    """JSON wrapped in a markdown code block is extracted."""
    raw = '```json\n{"company": "Beta Corp", "job_title": "Dev"}\n```'
    result = _extract_json(raw)
    assert result["company"] == "Beta Corp"


def test_extract_json_embedded():
    """JSON object embedded in surrounding text is found."""
    raw = 'Here is the data: {"company": "Gamma", "job_title": "PM"} end.'
    result = _extract_json(raw)
    assert result["company"] == "Gamma"


def test_extract_json_raises_on_garbage():
    """Raises ValueError when no JSON can be found."""
    with pytest.raises(ValueError, match="Could not extract JSON"):
        _extract_json("this is not json at all")


# ---------------------------------------------------------------------------
# parse_application integration tests (mocked LLM)
# ---------------------------------------------------------------------------

EXAMPLE_INPUTS = [
    # 1. Full details
    (
        "Applied to Stripe for a Senior Backend Engineer role. Remote. Found on LinkedIn. "
        "€110k-€130k/year. Applied today.",
        {
            "company": "Stripe",
            "job_title": "Senior Backend Engineer",
            "work_mode": "remote",
            "source": "linkedin",
            "salary_min": 11000000,
            "salary_max": 13000000,
            "salary_currency": "EUR",
        },
    ),
    # 2. Minimal info
    (
        "Sent CV to Shopify for a DevOps position.",
        {
            "company": "Shopify",
            "job_title": "DevOps",
        },
    ),
    # 3. On-site with referral
    (
        "Referred by Jane to apply at Acme Inc for a Data Scientist role, on-site in Berlin. "
        "£90k yearly. They look interesting because of the ML work.",
        {
            "company": "Acme Inc",
            "job_title": "Data Scientist",
            "source": "referral",
            "work_mode": "onsite",
            "location": "Berlin",
        },
    ),
]


@pytest.mark.parametrize("text,expected_fields", EXAMPLE_INPUTS)
@pytest.mark.asyncio
async def test_parse_application_extracts_fields(text: str, expected_fields: dict):
    """parse_application should extract the expected fields from each example input."""
    # Build a mock LLM response that contains the expected fields as JSON
    mock_response = json.dumps({**expected_fields, "uncertain_fields": []})

    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(return_value=mock_response)

    with patch("app.services.parser.get_llm_provider", return_value=mock_provider):
        result = await parse_application(text)

    for key, expected_value in expected_fields.items():
        assert result.get(key) == expected_value, (
            f"Field '{key}': expected {expected_value!r}, got {result.get(key)!r}"
        )


@pytest.mark.asyncio
async def test_parse_application_defaults_date():
    """If date_applied is not in LLM response, it defaults to today."""
    from datetime import date

    mock_response = json.dumps({"company": "Test Co", "job_title": "Eng", "uncertain_fields": []})
    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(return_value=mock_response)

    with patch("app.services.parser.get_llm_provider", return_value=mock_provider):
        result = await parse_application("Applied to Test Co")

    assert result["date_applied"] == date.today().isoformat()
    assert "date_applied" in result["uncertain_fields"]


@pytest.mark.asyncio
async def test_parse_application_handles_bad_json():
    """parse_application returns empty dict (with defaults) when LLM returns garbage."""
    mock_provider = MagicMock()
    mock_provider.complete = AsyncMock(return_value="Sorry, I cannot help with that.")

    with patch("app.services.parser.get_llm_provider", return_value=mock_provider):
        result = await parse_application("Something")

    # Should not raise; should return at least date_applied
    assert "date_applied" in result
