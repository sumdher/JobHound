"""
Natural language application input parser.
Uses the LLM to extract structured job application data from free-form text.
Handles JSON parsing errors gracefully and defaults uncertain fields.
"""

import json
import re
from datetime import date
from pathlib import Path

import structlog

from app.services.llm.base import LLMConfig, Message
from app.services.llm.factory import get_llm_provider

logger = structlog.get_logger(__name__)

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def _load_prompt(name: str) -> str:
    """Load a prompt template from the prompts directory."""
    return (PROMPTS_DIR / name).read_text()


def _extract_json(text: str) -> dict:
    """Extract JSON object from LLM response, handling markdown code blocks."""
    text = text.strip()

    # Try direct parse first
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    # Strip markdown code block
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if match:
        try:
            result = json.loads(match.group(1).strip())
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

    # Find first {...} block
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            result = json.loads(match.group(0))
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not extract JSON from LLM response: {text[:300]}")


async def parse_application(text: str, config: LLMConfig | None = None) -> dict:
    """
    Parse free-form text into a structured application dict.

    Returns a dict matching ApplicationCreate schema plus:
      - uncertain_fields: list[str] — fields the LLM flagged as uncertain
      - skills: list[str] — extracted skills (if job description included)
    """
    prompt_template = _load_prompt("parse_application.txt")
    prompt = prompt_template.replace("{text}", text)

    provider = get_llm_provider(config)
    messages = [
        Message(
            role="system",
            content=(
                "You are a precise data extraction assistant. "
                "Always respond with valid JSON only, no explanation."
            ),
        ),
        Message(role="user", content=prompt),
    ]

    response = await provider.complete(messages, config)

    try:
        result = _extract_json(response)
    except ValueError as e:
        logger.warning("JSON extraction failed, returning empty parse", error=str(e))
        result = {}

    # Ensure required structure
    if not result.get("date_applied"):
        result["date_applied"] = date.today().isoformat()
        if "date_applied" not in result.get("uncertain_fields", []):
            result.setdefault("uncertain_fields", []).append("date_applied")

    result.setdefault("uncertain_fields", [])
    result.setdefault("salary_currency", "EUR")
    result.setdefault("salary_period", "yearly")

    logger.info(
        "Application parsed",
        company=result.get("company"),
        job_title=result.get("job_title"),
    )
    return result
