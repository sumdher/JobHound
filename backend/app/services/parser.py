"""
Natural language application input parser.
Uses the LLM to extract structured job application data from free-form text,
then runs a second pass to extract skills from the same text.
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
    return (PROMPTS_DIR / name).read_text()


def _extract_json_dict(text: str) -> dict:
    """Extract a JSON object from LLM response, handling markdown code blocks."""
    text = text.strip()
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if match:
        try:
            result = json.loads(match.group(1).strip())
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            result = json.loads(match.group(0))
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not extract JSON dict from LLM response: {text[:300]}")


def _extract_json_array(text: str) -> list[str]:
    """Extract a JSON array of strings from LLM response."""
    text = text.strip()

    # Direct parse
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return [str(s).strip().lower() for s in result if s]
    except json.JSONDecodeError:
        pass

    # Markdown code block
    match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if match:
        try:
            result = json.loads(match.group(1).strip())
            if isinstance(result, list):
                return [str(s).strip().lower() for s in result if s]
        except json.JSONDecodeError:
            pass

    # First [...] block
    match = re.search(r"\[[\s\S]*?\]", text)
    if match:
        try:
            result = json.loads(match.group(0))
            if isinstance(result, list):
                return [str(s).strip().lower() for s in result if s]
        except json.JSONDecodeError:
            pass

    logger.warning("Could not extract skills JSON array", preview=text[:200])
    return []


async def parse_application(text: str, config: LLMConfig | None = None) -> dict:
    """
    Parse free-form text into a structured application dict.

    Runs two LLM calls:
      1. Field extraction (company, title, dates, salary, etc.)
      2. Skills extraction (technical skills list)

    Returns a dict matching ApplicationCreate schema plus:
      - uncertain_fields: list[str]
      - skills: list[str]
    """
    provider = get_llm_provider(config)

    # ── 1. Field extraction ───────────────────────────────────────────────────
    parse_prompt = _load_prompt("parse_application.txt").replace("{text}", text)
    parse_messages = [
        Message(
            role="system",
            content=(
                "You are a precise data extraction assistant. "
                "Always respond with valid JSON only, no explanation, no markdown."
            ),
        ),
        Message(role="user", content=parse_prompt),
    ]
    parse_response = await provider.complete(parse_messages, config)

    try:
        result = _extract_json_dict(parse_response)
    except ValueError as e:
        logger.warning("Field JSON extraction failed, returning empty parse", error=str(e))
        result = {}

    # ── 2. Skills extraction ──────────────────────────────────────────────────
    skills_prompt = _load_prompt("extract_skills.txt").replace("{job_description}", text)
    skills_messages = [
        Message(
            role="system",
            content=(
                "You are a skill extraction assistant. "
                "Always respond with a valid JSON array only, no explanation, no markdown."
            ),
        ),
        Message(role="user", content=skills_prompt),
    ]
    skills_response = await provider.complete(skills_messages, config)
    skills = _extract_json_array(skills_response)

    # ── Defaults and cleanup ──────────────────────────────────────────────────
    if not result.get("date_applied"):
        result["date_applied"] = date.today().isoformat()
        result.setdefault("uncertain_fields", []).append("date_applied")

    result.setdefault("uncertain_fields", [])
    result.setdefault("salary_currency", "EUR")
    result.setdefault("salary_period", "yearly")
    result["skills"] = skills

    logger.info(
        "Application parsed",
        company=result.get("company"),
        job_title=result.get("job_title"),
        skills_count=len(skills),
    )
    return result
